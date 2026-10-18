import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron, expect } from "@playwright/test";

// The Windows self-update, end to end: an installed app finds a newer
// release, downloads its installer, and "Restart to update" runs that
// installer silently over itself (desktop/updates.cjs). desktop.yml's
// Windows x64 job installs the app, builds a second installer of the same
// app one patch version up with its latest.json beside it, and points
// these at them:
//
//   DESKTOP_EXECUTABLE         the installed app (Connector Foundry.exe)
//   DESKTOP_UPDATE_INSTALLER   the newer Connector-Foundry-windows-x64-setup.exe
//
// Unset, the test is skipped: it replaces the installed app, and it writes
// to the default profile (below), so it belongs on a throwaway machine.

const require = createRequire(import.meta.url);
const { MANIFEST_NAME, MANIFEST_URL, downloadUrl, isNewer } = require("../../desktop/update-manifest.cjs");

const executable = process.env.DESKTOP_EXECUTABLE ? path.resolve(process.env.DESKTOP_EXECUTABLE) : null;
const installer = process.env.DESKTOP_UPDATE_INSTALLER
  ? path.resolve(process.env.DESKTOP_UPDATE_INSTALLER)
  : null;
const skip =
  (!installer && "set DESKTOP_UPDATE_INSTALLER (desktop.yml's Windows job does)") ||
  (process.platform !== "win32" && "the Windows update; macOS swaps the bundle instead (docs/MACOS.md)");

const execFileAsync = promisify(execFile);

/**
 * Runs a PowerShell script. Paths and names reach it through environment
 * variables, never spliced into the script.
 * @param {string} script
 * @param {Record<string, string>} [env]
 */
async function powershell(script, env = {}) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env: { ...process.env, ...env }, windowsHide: true },
  );
  return stdout.trim();
}

/**
 * The version the installed executable carries, as three numbers
 * (electron-builder stamps it with a fourth), or null while the installer
 * has it replaced.
 * @param {string} exe
 */
async function installedVersion(exe) {
  const version = await powershell(
    "(Get-Item -LiteralPath $env:FOUNDRY_EXE -ErrorAction Stop).VersionInfo.ProductVersion",
    { FOUNDRY_EXE: exe },
  ).catch(() => "");
  return version ? version.split(".").slice(0, 3).join(".") : null;
}

/**
 * The running processes with one of these executable names.
 * @param {string[]} names
 * @returns {Promise<{ ProcessId: number, Name: string, ExecutablePath: string | null, CommandLine: string | null }[]>}
 */
async function processes(names) {
  const json = await powershell(
    "$names = $env:FOUNDRY_NAMES -split '\\|'; " +
      "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | " +
      "Where-Object { $names -contains $_.Name } | " +
      "Select-Object ProcessId, Name, ExecutablePath, CommandLine)",
    { FOUNDRY_NAMES: names.join("|") },
  );
  return json ? JSON.parse(json) : [];
}

// What the installer left behind, for a failure's log: the processes, the
// uninstall entry it found the installation by, the Start menu shortcut
// it starts the app with.
async function diagnostics() {
  return powershell(
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Connector*' } | " +
      "Format-List ProcessId, Name, ExecutablePath, CommandLine | Out-String -Width 300; " +
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | " +
      "Where-Object DisplayName -like 'Connector Foundry*' | " +
      "Format-List DisplayName, DisplayVersion, InstallLocation, UninstallString | Out-String -Width 300; " +
      "Get-ChildItem (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs') -Filter 'Connector*' | " +
      "Format-Table FullName, LastWriteTime | Out-String -Width 300",
  ).catch((error) => `diagnostics failed: ${error.message}`);
}

/**
 * Writes JSON files into a folder, and returns how to put back what was
 * there before.
 * @param {string} dir
 * @param {Record<string, unknown>} files
 */
async function seed(dir, files) {
  await mkdir(dir, { recursive: true });
  /** @type {[string, Buffer | null][]} */
  const previous = [];
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(dir, name);
    previous.push([file, await readFile(file).catch(() => null)]);
    await writeFile(file, JSON.stringify(value));
  }
  return async () => {
    for (const [file, content] of previous) {
      if (content) await writeFile(file, content);
      else await rm(file, { force: true });
    }
  };
}

// A port nothing listens on now, for the relaunched app's MCP server.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * The version an app's MCP server reports, or null while nothing answers.
 * @param {number} port
 * @param {string} token
 */
async function mcpVersion(port, token) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "update-test", version: "0" },
        },
      }),
    });
    if (!response.ok) return null;
    return (await response.json()).result?.serverInfo?.version ?? null;
  } catch {
    return null;
  }
}

test(
  "an installed app updates itself to a newer release's installer and starts again",
  { timeout: 480_000, skip },
  async () => {
    assert.ok(executable, "DESKTOP_EXECUTABLE must name the installed app");
    const installDir = path.dirname(executable);
    const appName = path.basename(executable);
    const installerName = path.basename(installer);
    const manifestFile = path.join(path.dirname(installer), MANIFEST_NAME);
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    assert.ok(manifest.files?.[installerName], `${MANIFEST_NAME} lists no ${installerName}`);
    const version = manifest.version;
    const inInstall = (p) =>
      p.ExecutablePath?.toLowerCase().startsWith(`${installDir}${path.sep}`.toLowerCase());

    const directory = await mkdtemp(path.join(os.tmpdir(), "foundry-update-"));
    const profile = path.join(directory, "profile");
    const pendingFile = path.join(profile, "pending-update.json");
    await seed(profile, { "updates.json": { autoCheck: false } });
    let restoreDefaultProfile = async () => {};
    let app;
    try {
      app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`] });
      const page = await app.firstWindow();
      await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeVisible({
        timeout: 90_000,
      });
      const running = await app.evaluate(({ app }) => ({
        version: app.getVersion(),
        appData: app.getPath("appData"),
        name: app.getName(),
      }));
      assert.ok(isNewer(version, running.version), `${version} is not newer than ${running.version}`);

      // The installer starts the app again from its Start menu shortcut,
      // which knows nothing of --user-data-dir: the relaunch runs on the
      // default profile. Give that one what the test profile has, automatic
      // checks off (no real GitHub) and the MCP server on, to ask it its
      // version.
      const port = await freePort();
      const token = "e".repeat(64);
      restoreDefaultProfile = await seed(path.join(running.appData, running.name), {
        "updates.json": { autoCheck: false },
        "mcp.json": { enabled: true, port, token },
      });

      // GitHub, played by the main process: the updater fetches through
      // Chromium's network stack, which a protocol handler for https
      // intercepts. The release is the installer built for this test.
      await app.evaluate(
        ({ protocol, net }, release) => {
          globalThis.requests = [];
          protocol.handle("https", (request) => {
            globalThis.requests.push(request.url);
            if (request.url === release.manifestUrl) return net.fetch(release.manifestFile);
            if (request.url === release.installerUrl) return net.fetch(release.installerFile);
            return new Response("not found", { status: 404 });
          });
        },
        {
          manifestUrl: MANIFEST_URL,
          manifestFile: pathToFileURL(manifestFile).href,
          installerUrl: downloadUrl(version, installerName),
          installerFile: pathToFileURL(installer).href,
        },
      );

      await page.keyboard.press("s");
      const settings = page.getByRole("dialog", { name: "Settings" });
      await settings.getByRole("button", { name: "Check for updates" }).click();
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      // A download of the whole installer, checked against latest.json.
      const restart = page.locator(".mode-tabs").getByRole("button", { name: "Restart to update" });
      await expect(restart).toBeVisible({ timeout: 120_000 });
      const status = await page.evaluate(() => window.foundryDesktop.updates.status());
      assert.equal(status.state, "ready", JSON.stringify(status));
      assert.equal(status.latest, version);
      const requests = await app.evaluate(() => globalThis.requests);
      assert.deepEqual(
        requests.filter((url) => new URL(url).host === "github.com"),
        [MANIFEST_URL, downloadUrl(version, installerName)],
      );

      // On another tab than the first, to see the restart come back to it.
      // The empty Bench opens its part picker, a dialog over the nav.
      await page.keyboard.press("2");
      await expect(page.locator(".mode-tab.active")).toContainText("Bench");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).hash).toBe("#mode=bench");
      const url = page.url();
      const exited = new Promise((resolve) => {
        app.process().once("exit", resolve);
      });
      // The window may close before Playwright hears back from the click;
      // whether it worked shows in the app quitting.
      await restart.click().catch(() => {});
      await Promise.race([
        exited,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("the app did not quit to install")), 30_000).unref();
        }),
      ]);
      app = null;
      assert.deepEqual(JSON.parse(await readFile(pendingFile, "utf8")), { version, url });

      // The installer waits for the app to be gone (or ends it), removes
      // the old version with its uninstaller, puts the new one in the
      // folder the registry names, and starts it.
      await expect
        .poll(() => installedVersion(executable), {
          message: "the installed app's version",
          timeout: 180_000,
          intervals: [2_000],
        })
        .toBe(version);
      await expect
        .poll(async () => (await processes([installerName])).length, {
          message: "the installer to finish",
          timeout: 120_000,
          intervals: [1_000],
        })
        .toBe(0);
      // The relaunch: the main process (Chromium's helpers carry --type=),
      // started with the --updated switch the installer adds.
      await expect
        .poll(
          async () =>
            (await processes([appName])).some(
              (p) =>
                inInstall(p) && !p.CommandLine?.includes("--type=") && p.CommandLine?.includes("--updated"),
            ),
          { message: "the app to start again", timeout: 60_000, intervals: [1_000] },
        )
        .toBe(true);
      await expect
        .poll(() => mcpVersion(port, token), {
          message: "the relaunched app's MCP server",
          timeout: 60_000,
          intervals: [1_000],
        })
        .toBe(version);

      // Quit it, and open the new version on the test's profile: the
      // pending update it finds there is the one it is.
      for (const p of (await processes([appName])).filter(inInstall)) {
        try {
          process.kill(p.ProcessId);
        } catch {
          // Gone already: a helper of the main process just ended.
        }
      }
      await expect
        .poll(async () => (await processes([appName])).filter(inInstall).length, { timeout: 30_000 })
        .toBe(0);
      app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`] });
      const updated = await app.firstWindow();
      await expect(updated.locator(".mode-tab.active")).toContainText("Bench", { timeout: 60_000 });
      assert.equal(updated.url(), url);
      const after = await updated.evaluate(() => window.foundryDesktop.updates.status());
      assert.equal(after.version, version, JSON.stringify(after));
      assert.equal(after.justUpdated, version, JSON.stringify(after));
      assert.equal(after.error, null, JSON.stringify(after));
      await assert.rejects(readFile(pendingFile), { code: "ENOENT" });
    } catch (error) {
      console.log(await diagnostics());
      throw error;
    } finally {
      if (app && app.process().exitCode === null) await app.close();
      // Nothing of the app may keep running into the job's uninstall step.
      for (const p of (await processes([appName, installerName]).catch(() => [])).filter(
        (p) => p.Name === installerName || inInstall(p),
      )) {
        try {
          process.kill(p.ProcessId);
        } catch {
          // Gone already.
        }
      }
      await restoreDefaultProfile();
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
