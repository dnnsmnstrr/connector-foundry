import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
import { webBundle } from "../../scripts/web-bundle.mjs";

// Interface updates, end to end (desktop/updates.cjs, web-bundle.cjs): a
// packaged app finds a release built for its shell, downloads only its web
// bundle, and "Reload to update" shows it; the next launch serves it too.
// Then a bundle whose page never starts: the app goes back to its own
// interface by itself. Needs a packaged build (DESKTOP_EXECUTABLE, which
// desktop.yml's jobs set), since a development run takes no interface
// updates; the bundles are made from dist/, with a marker in the app's
// page to tell them from the app's own.

const require = createRequire(import.meta.url);
const { MANIFEST_URL, WEB_ASSET, downloadUrl } = require("../../desktop/update-manifest.cjs");
const { SHELL_VERSION } = require("../../desktop/shell.cjs");

const executable = process.env.DESKTOP_EXECUTABLE ? path.resolve(process.env.DESKTOP_EXECUTABLE) : null;
const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const skip =
  (!executable && "set DESKTOP_EXECUTABLE to a packaged build") ||
  (!existsSync(path.join(dist, "app", "index.html")) && "build dist/ first");

/** @param {string} version  @param {number} by */
const bump = (version, by) => {
  const [a, b, c] = version.split(".").map(Number);
  return `${a}.${b}.${c + by}`;
};

/**
 * The app's page with a marker naming `version`, for a bundle of it.
 * @param {string} version
 */
async function markedPage(version) {
  const page = await readFile(path.join(dist, "app", "index.html"), "utf8");
  return page.replace("<head>", `<head><meta name="foundry-test-interface" content="${version}">`);
}

/** @param {import("@playwright/test").Page} page */
async function appIsUp(page) {
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeVisible({
    timeout: 90_000,
  });
}

/** @param {import("@playwright/test").Page} page */
const marker = (page) =>
  page.evaluate(
    () => document.querySelector('meta[name="foundry-test-interface"]')?.getAttribute("content") ?? null,
  );

/** @param {string} profile */
const launch = (profile) =>
  electron.launch({
    executablePath: /** @type {string} */ (executable),
    args: [`--user-data-dir=${profile}`],
  });

/** @param {string} profile */
const readSettings = async (profile) =>
  JSON.parse(await readFile(path.join(profile, "updates.json"), "utf8"));

test(
  "an interface update loads with a reload, and one that never starts gives way to the app's own",
  { timeout: 300_000, skip },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "foundry-web-update-"));
    const profile = path.join(directory, "profile");
    const release = path.join(directory, "release");
    await mkdir(profile, { recursive: true });
    await mkdir(release, { recursive: true });
    // No automatic checks: the test checks by hand, against its own release.
    await writeFile(path.join(profile, "updates.json"), JSON.stringify({ autoCheck: false }));
    let app;
    try {
      app = await launch(profile);
      let page = await app.firstWindow();
      await appIsUp(page);
      assert.equal(await marker(page), null);
      const running = await app.evaluate(({ app }) => app.getVersion());
      const next = bump(running, 1);

      // The release: latest.json for this shell, and the bundle beside it.
      const zip = await webBundle(dist, { version: next }, { "app/index.html": await markedPage(next) });
      const zipFile = path.join(release, WEB_ASSET);
      await writeFile(zipFile, zip);
      const manifestFile = path.join(release, "latest.json");
      await writeFile(
        manifestFile,
        JSON.stringify({
          version: next,
          shell: SHELL_VERSION,
          files: {
            [WEB_ASSET]: { sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length },
          },
        }),
      );
      // GitHub, played by the main process, as in update.test.mjs.
      await app.evaluate(
        ({ protocol, net }, release) => {
          globalThis.requests = [];
          protocol.handle("https", (request) => {
            globalThis.requests.push(request.url);
            if (request.url === release.manifestUrl) return net.fetch(release.manifestFile);
            if (request.url === release.zipUrl) return net.fetch(release.zipFile);
            return new Response("not found", { status: 404 });
          });
        },
        {
          manifestUrl: MANIFEST_URL,
          manifestFile: pathToFileURL(manifestFile).href,
          zipUrl: downloadUrl(next, WEB_ASSET),
          zipFile: pathToFileURL(zipFile).href,
        },
      );

      await page.keyboard.press("s");
      const settings = page.getByRole("dialog", { name: "Settings" });
      await settings.getByRole("button", { name: "Check for updates" }).click();
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      const reload = page.locator(".mode-tabs").getByRole("button", { name: "Reload to update" });
      await expect(reload).toBeVisible({ timeout: 60_000 });
      const ready = await page.evaluate(() => window.foundryDesktop.updates.status());
      assert.equal(ready.state, "ready", JSON.stringify(ready));
      assert.equal(ready.reload, true);
      // The bundle alone: no installer, no app ZIP.
      assert.deepEqual(await app.evaluate(() => globalThis.requests), [
        MANIFEST_URL,
        downloadUrl(next, WEB_ASSET),
      ]);

      await reload.click();
      await expect.poll(() => marker(page).catch(() => null), { timeout: 30_000 }).toBe(next);
      await appIsUp(page);
      const loaded = await page.evaluate(() => window.foundryDesktop.updates.status());
      assert.equal(loaded.version, running);
      assert.equal(loaded.web, next);
      assert.equal(loaded.state, "up-to-date");
      // The page said it started, so the bundle is kept.
      await expect.poll(async () => (await readSettings(profile)).webOk).toBe(next);
      await app.close();

      // The next launch serves it from the start.
      app = await launch(profile);
      page = await app.firstWindow();
      await appIsUp(page);
      assert.equal(await marker(page), next);
      await app.close();

      // A newer bundle whose page never starts, as if it had downloaded:
      // after WEB_START_MS the window goes back to the app's own interface.
      const broken = bump(running, 2);
      const { unpackBundle } = require("../../desktop/web-bundle.cjs");
      await unpackBundle(
        await webBundle(
          dist,
          { version: broken },
          { "app/index.html": "<!doctype html><title>broken</title>" },
        ),
        path.join(profile, "web"),
        { version: broken, shell: SHELL_VERSION },
      );
      app = await launch(profile);
      page = await app.firstWindow();
      await expect(page).toHaveTitle("broken", { timeout: 30_000 });
      await appIsUp(page);
      assert.equal(await marker(page), null);
      const fellBack = await page.evaluate(() => window.foundryDesktop.updates.status());
      assert.equal(fellBack.state, "error", JSON.stringify(fellBack));
      assert.equal(fellBack.web, running);
      assert.match(fellBack.error, /didn't start/);
      assert.equal((await readSettings(profile)).badWeb, broken);
      assert.ok(!existsSync(path.join(profile, "web", broken)));
    } finally {
      await app?.close().catch(() => {});
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  },
);
