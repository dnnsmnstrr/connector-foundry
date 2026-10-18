import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { releaseManifest } from "../../scripts/release-manifest.mjs";

const {
  ASSETS,
  MAC_SWAP_SCRIPT,
  MANIFEST_URL,
  assetCandidates,
  checkManifest,
  downloadUrl,
  isNewer,
  macBundlePath,
  pickAsset,
  releaseUrl,
} = createRequire(import.meta.url)("../../desktop/update-manifest.cjs");

// The desktop updater's Electron-free half (desktop/update-manifest.cjs),
// the release job's manifest writer (scripts/release-manifest.mjs), and
// desktop.yml, whose artifact names the updater's table must match.

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

test("each computer gets its own build, translated Intel apps the native one", () => {
  assert.deepEqual(assetCandidates({ platform: "darwin", arch: "arm64" }), [
    "Connector-Foundry-mac-apple-silicon.zip",
  ]);
  assert.deepEqual(assetCandidates({ platform: "darwin", arch: "x64" }), ["Connector-Foundry-mac-intel.zip"]);
  assert.deepEqual(assetCandidates({ platform: "darwin", arch: "x64", translated: true }), [
    "Connector-Foundry-mac-apple-silicon.zip",
    "Connector-Foundry-mac-intel.zip",
  ]);
  assert.deepEqual(assetCandidates({ platform: "win32", arch: "x64" }), [
    "Connector-Foundry-windows-x64-setup.exe",
  ]);
  // Windows on ARM: its own build when the release has one, else x64 emulated.
  for (const system of [
    { platform: "win32", arch: "arm64" },
    { platform: "win32", arch: "x64", translated: true },
  ])
    assert.deepEqual(assetCandidates(system), [
      "Connector-Foundry-windows-arm64-setup.exe",
      "Connector-Foundry-windows-x64-setup.exe",
    ]);
  assert.deepEqual(assetCandidates({ platform: "linux", arch: "x64" }), []);
  assert.deepEqual(assetCandidates({ platform: "win32", arch: "ia32" }), []);
});

test("a manifest is checked like any file from the network", () => {
  const good = {
    version: "0.5.0",
    files: {
      "Connector-Foundry-mac-apple-silicon.zip": { sha256: "A".repeat(64), size: 123 },
      "Connector-Foundry-windows-x64-setup.exe": { sha256: "b".repeat(64), size: 456 },
      // Names the table doesn't know, and malformed entries, are dropped.
      "../../evil.zip": { sha256: "c".repeat(64), size: 1 },
      "Connector-Foundry-mac-intel.zip": { sha256: "not hex", size: 1 },
      "Connector-Foundry-windows-arm64-setup.exe": { sha256: "d".repeat(64), size: -1 },
    },
  };
  assert.deepEqual(checkManifest(good), {
    version: "0.5.0",
    files: {
      "Connector-Foundry-mac-apple-silicon.zip": { sha256: "a".repeat(64), size: 123 },
      "Connector-Foundry-windows-x64-setup.exe": { sha256: "b".repeat(64), size: 456 },
    },
  });
  // Inherited properties are not files.
  const inherited = Object.create({ "Connector-Foundry-mac-intel.zip": { sha256: "e".repeat(64), size: 1 } });
  assert.deepEqual(checkManifest({ version: "1.0.0", files: inherited }).files, {});
  for (const bad of [null, [], "0.5.0", { files: {} }, { version: "0.5.0" }, { version: "0.5.0", files: [] }])
    assert.throws(() => checkManifest(bad));
  for (const version of ["0.5", "v0.5.0", "0.5.0-beta.1", "01.2.3", "1.2.3.4", " 1.2.3", 1])
    assert.throws(() => checkManifest({ version, files: {} }), /version/, String(version));
});

test("versions compare as numbers, and nothing malformed is ever newer", () => {
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.4.1", "0.4.0"), true);
  assert.equal(isNewer("0.4.0", "0.4.0"), false);
  assert.equal(isNewer("0.3.9", "0.4.0"), false);
  assert.equal(isNewer("9.9.9-rc", "0.4.0"), false);
  assert.equal(isNewer("0.5.0", "garbage"), false);
});

test("the first candidate the release has is picked, with its checksum", () => {
  const manifest = checkManifest({
    version: "0.5.0",
    files: { "Connector-Foundry-windows-x64-setup.exe": { sha256: "f".repeat(64), size: 9 } },
  });
  assert.deepEqual(pickAsset(manifest, assetCandidates({ platform: "win32", arch: "arm64" })), {
    name: "Connector-Foundry-windows-x64-setup.exe",
    sha256: "f".repeat(64),
    size: 9,
  });
  assert.equal(pickAsset(manifest, assetCandidates({ platform: "darwin", arch: "arm64" })), null);
});

test("addresses are built from the version and the table, never taken from the manifest", () => {
  assert.equal(
    MANIFEST_URL,
    "https://github.com/dnnsmnstrr/connector-foundry/releases/latest/download/latest.json",
  );
  assert.equal(
    downloadUrl("0.5.0", "Connector-Foundry-mac-intel.zip"),
    "https://github.com/dnnsmnstrr/connector-foundry/releases/download/v0.5.0/Connector-Foundry-mac-intel.zip",
  );
  assert.throws(() => downloadUrl("0.5.0", "../other.zip"));
  assert.throws(() => downloadUrl("latest", "Connector-Foundry-mac-intel.zip"));
  assert.equal(releaseUrl("0.5.0"), "https://github.com/dnnsmnstrr/connector-foundry/releases/tag/v0.5.0");
  assert.equal(releaseUrl("0.5.0/../../x"), null);
});

test("the bundle is found from the executable inside it", () => {
  assert.equal(
    macBundlePath("/Applications/Connector Foundry.app/Contents/MacOS/Connector Foundry"),
    path.resolve("/Applications/Connector Foundry.app"),
  );
  assert.equal(macBundlePath("/usr/local/bin/electron"), null);
});

/**
 * Runs the macOS swap script the way updates.cjs does, against a process
 * that exits after a moment, and resolves once the script is done.
 */
async function swap(app, next, stage) {
  const waiting = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
  const script = spawn("/bin/sh", [
    "-c",
    MAC_SWAP_SCRIPT,
    "sh",
    String(waiting.pid),
    app,
    next,
    stage,
    "0",
    "",
  ]);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    script.once("exit", resolve);
  });
  // It waited for the process to be gone before touching anything.
  assert.equal(waiting.exitCode, 0);
  assert.ok(Date.now() - started >= 250, "the script waited for the app to quit");
  return code;
}

test(
  "the macOS script swaps the bundle once the app has quit, and puts the old one back if it can't",
  { skip: process.platform === "win32" && "a POSIX shell script" },
  async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "foundry-swap-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    // Spaces in every path, as "Connector Foundry.app" has.
    const app = path.join(dir, "Apps dir", "Connector Foundry.app");
    const stage = path.join(dir, "stage dir");
    const next = path.join(stage, "unpacked", "Connector Foundry.app");
    await mkdir(app, { recursive: true });
    await mkdir(next, { recursive: true });
    await writeFile(path.join(app, "version"), "0.4.0");
    await writeFile(path.join(next, "version"), "0.5.0");
    assert.equal(await swap(app, next, stage), 0);
    assert.equal(await readFile(path.join(app, "version"), "utf8"), "0.5.0");
    assert.equal(existsSync(stage), false, "the staging folder, old bundle and all, is gone");

    // Nothing to move in: the installed bundle stays as it was.
    await mkdir(stage, { recursive: true });
    assert.equal(await swap(app, path.join(stage, "missing.app"), stage), 0);
    assert.equal(await readFile(path.join(app, "version"), "utf8"), "0.5.0");
  },
);

test("the release job's manifest lists the update files present, as the app reads them", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "foundry-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "Connector-Foundry-mac-apple-silicon.zip"), "mac arm");
  await writeFile(path.join(dir, "Connector-Foundry-windows-x64-setup.exe"), "windows x64!");
  // Not update files: the DMG and the checksums.
  await writeFile(path.join(dir, "Connector-Foundry-mac-apple-silicon.dmg"), "dmg");
  await writeFile(path.join(dir, "SHA256SUMS.txt"), "sums");
  const manifest = await releaseManifest(dir, "0.5.0");
  assert.deepEqual(manifest, {
    version: "0.5.0",
    files: {
      "Connector-Foundry-mac-apple-silicon.zip": { sha256: sha("mac arm"), size: 7 },
      "Connector-Foundry-windows-x64-setup.exe": { sha256: sha("windows x64!"), size: 12 },
    },
  });
  assert.deepEqual(checkManifest(JSON.parse(JSON.stringify(manifest))), manifest);
  await assert.rejects(releaseManifest(dir, "v0.5.0"), /version/);
  await assert.rejects(releaseManifest(path.join(dir, "empty"), "0.5.0"), /No update files/);
});

test("every build desktop.yml makes has its update file in the updater's table, and no more", async () => {
  const workflow = yaml.load(await readFile(path.join(repoRoot, ".github/workflows/desktop.yml"), "utf8"));
  const builds = workflow.jobs.build.strategy.matrix.include;
  const expected = Object.fromEntries(
    builds.map((b) => [
      `${b.platform === "mac" ? "darwin" : "win32"}-${b.arch}`,
      `${b.artifact}.${b.platform === "mac" ? "zip" : "exe"}`,
    ]),
  );
  assert.deepEqual({ ...ASSETS }, expected);
  // The release job checks out the manifest writer and the table it reads.
  const checkout = workflow.jobs.release.steps.find((s) => s.with?.["sparse-checkout"]);
  for (const file of checkout.with["sparse-checkout"].trim().split("\n"))
    assert.ok(existsSync(path.join(repoRoot, file.trim())), file);
  assert.ok(checkout.with["sparse-checkout"].includes("web/scripts/release-manifest.mjs"));
  assert.ok(checkout.with["sparse-checkout"].includes("web/desktop/update-manifest.cjs"));
});
