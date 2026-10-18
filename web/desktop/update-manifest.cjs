// What the desktop app's updater (updates.cjs) knows without Electron:
// where the releases are, which file of a release is this computer's, what
// a release's manifest (latest.json) must hold, and the script that swaps
// the app bundle on macOS. The release job writes the manifest from the
// same table (scripts/release-manifest.mjs), and
// tests/unit/desktop-updates.test.js holds the table to desktop.yml's
// artifact names: a build renamed there and not here would never update.
//
// Nothing in a manifest is used as a URL or a path. The app builds every
// address from the repository, the release's version and a name from this
// table; the manifest only says which version is the newest and what each
// file's size and SHA-256 are.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const REPO = "dnnsmnstrr/connector-foundry";
const MANIFEST_NAME = "latest.json";
// GitHub's "latest release" link redirects to the newest release that is
// neither a draft nor a pre-release, so a tag pushed by mistake as a
// pre-release never reaches anyone's app.
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/${MANIFEST_NAME}`;
// What the macOS ZIP unpacks to: electron-builder names the bundle after
// productName (electron-builder.yml).
const MAC_APP_NAME = "Connector Foundry.app";
const BUNDLE_ID = "com.connectorfoundry.desktop";

// Each build's update file. The macOS ZIP holds the same app as the DMG
// and unpacks without mounting anything; the Windows installer runs
// silently over the installed app.
const ASSETS = Object.freeze({
  "darwin-arm64": "Connector-Foundry-mac-apple-silicon.zip",
  "darwin-x64": "Connector-Foundry-mac-intel.zip",
  "win32-x64": "Connector-Foundry-windows-x64-setup.exe",
  "win32-arm64": "Connector-Foundry-windows-arm64-setup.exe",
});

// Three numbers, as the release tags are (v0.4.0). Pre-releases never
// reach the manifest's link, so anything else is a malformed manifest.
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const SHA256 = /^[0-9a-f]{64}$/i;
// The builds are about 120 MB; a size far past that is a broken manifest,
// not a bigger app.
const MAX_SIZE = 1024 * 1024 * 1024;

/**
 * The update files that would do for this computer, best first. An Intel
 * build running translated on an ARM machine (Rosetta, or Windows' x64
 * emulation) moves to the native build. Windows on ARM falls back to the
 * x64 installer, which runs there emulated, because its own build is
 * experimental and may be missing from a release.
 * @param {{ platform: string, arch: string, translated?: boolean }} system
 * @returns {string[]}
 */
function assetCandidates({ platform, arch, translated = false }) {
  const arm = arch === "arm64" || translated;
  if (platform === "darwin") {
    if (arch === "arm64") return [ASSETS["darwin-arm64"]];
    if (arch === "x64") return arm ? [ASSETS["darwin-arm64"], ASSETS["darwin-x64"]] : [ASSETS["darwin-x64"]];
  }
  if (platform === "win32") {
    if (arm && (arch === "arm64" || arch === "x64")) return [ASSETS["win32-arm64"], ASSETS["win32-x64"]];
    if (arch === "x64") return [ASSETS["win32-x64"]];
  }
  return [];
}

/**
 * A manifest as fetched, checked like any file from the network: the
 * version, and size and SHA-256 of the files this table knows. Files with
 * other names, or with a malformed entry, are left out.
 * @param {unknown} raw
 * @returns {{ version: string, files: Record<string, { sha256: string, size: number }> }}
 */
function checkManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("The update manifest is malformed.");
  const { version, files } = /** @type {any} */ (raw);
  if (typeof version !== "string" || !VERSION.test(version))
    throw new Error("The update manifest has no valid version.");
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new Error("The update manifest lists no files.");
  /** @type {Record<string, { sha256: string, size: number }>} */
  const checked = {};
  for (const name of Object.values(ASSETS)) {
    if (!Object.hasOwn(files, name)) continue;
    const file = files[name];
    if (
      file &&
      typeof file.sha256 === "string" &&
      SHA256.test(file.sha256) &&
      Number.isSafeInteger(file.size) &&
      file.size > 0 &&
      file.size <= MAX_SIZE
    )
      checked[name] = { sha256: file.sha256.toLowerCase(), size: file.size };
  }
  return { version, files: checked };
}

/**
 * Whether version `a` is newer than `b`; false for anything malformed, so
 * a broken version never looks like an update.
 * @param {string} a
 * @param {string} b
 */
function isNewer(a, b) {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
  }
  return false;
}

/**
 * The first of `candidates` the manifest has, with its checksum and size.
 * @param {ReturnType<typeof checkManifest>} manifest
 * @param {string[]} candidates
 * @returns {{ name: string, sha256: string, size: number } | null}
 */
function pickAsset(manifest, candidates) {
  for (const name of candidates) {
    const file = manifest.files[name];
    if (file) return { name, ...file };
  }
  return null;
}

/**
 * Where a release's file is, pinned to its tag: a release published while
 * the download runs can't swap the file under it.
 * @param {string} version
 * @param {string} name one of ASSETS
 */
function downloadUrl(version, name) {
  if (!VERSION.test(version) || !Object.values(ASSETS).includes(name))
    throw new Error("Unknown update file.");
  return `https://github.com/${REPO}/releases/download/v${version}/${name}`;
}

/** @param {string} version */
function releaseUrl(version) {
  return VERSION.test(version) ? `https://github.com/${REPO}/releases/tag/v${version}` : null;
}

/**
 * The .app bundle an executable is in (…/X.app/Contents/MacOS/X), or null.
 * @param {string} executable
 */
function macBundlePath(executable) {
  const bundle = path.resolve(executable, "..", "..", "..");
  return bundle.endsWith(".app") ? bundle : null;
}

/**
 * The SHA-256 of a file, in hex.
 * @param {string} file
 */
async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

// Swaps the app bundle once the app has quit, run detached by /bin/sh
// with its arguments positional, so no path is ever spliced into the
// script: $1 the app's process id, $2 the installed bundle, $3 the new
// bundle, $4 the staging folder (removed afterwards, with the old bundle
// moved into it), $5 "1" to open the app again, $6 the profile folder it
// was started with by --user-data-dir, if any, so the app opens on the
// same one (empty: the default). The app's renderer and GPU
// helpers live inside its bundle and start from there, so the bundle may
// not change while any of them can still launch: the script waits for the
// process to be gone. If the new bundle can't be moved in, the old one goes
// back; either way the app opens again if asked, and the next launch tells
// from its version whether the update took (updates.cjs).
const MAC_SWAP_SCRIPT = `
pid="$1"; app="$2"; next="$3"; stage="$4"; relaunch="$5"; profile="$6"
tries=0
while kill -0 "$pid" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 600 ]; then exit 1; fi
  sleep 0.1
done
if mv "$app" "$stage/previous.app"; then
  if mv "$next" "$app"; then
    rm -rf "$stage"
  else
    mv "$stage/previous.app" "$app"
  fi
fi
if [ "$relaunch" = 1 ]; then
  if [ -n "$profile" ]; then open "$app" --args "--user-data-dir=$profile"; else open "$app"; fi
fi
`;

module.exports = {
  ASSETS,
  BUNDLE_ID,
  MAC_APP_NAME,
  MAC_SWAP_SCRIPT,
  MANIFEST_NAME,
  MANIFEST_URL,
  REPO,
  VERSION,
  assetCandidates,
  checkManifest,
  downloadUrl,
  isNewer,
  macBundlePath,
  pickAsset,
  releaseUrl,
  sha256File,
};
