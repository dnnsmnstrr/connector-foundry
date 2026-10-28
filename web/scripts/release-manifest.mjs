import { stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The release's latest.json, which the desktop app's updater reads
// (desktop/updates.cjs): the version, the shell version its interface
// update was built for (desktop/shell.cjs, as checked out at the tag), and
// the size and SHA-256 of each update file the release has. desktop.yml's release job runs it over the
// downloaded build artifacts, before they are published:
//
//   node web/scripts/release-manifest.mjs <dir> <version>
//
// The file names come from the updater's own table, so the two can't
// disagree; a build missing from <dir> (Windows on ARM, which may fail
// without stopping a release) is left out, and the apps it would have
// updated fall back or wait (update-manifest.cjs's assetCandidates()).

const require = createRequire(import.meta.url);
const {
  MANIFEST_NAME,
  UPDATE_FILES,
  VERSION,
  checkManifest,
  sha256File,
} = require("../desktop/update-manifest.cjs");
const { SHELL_VERSION } = require("../desktop/shell.cjs");

/**
 * The manifest for the update files in `dir`.
 * @param {string} dir
 * @param {string} version without the tag's "v"
 */
export async function releaseManifest(dir, version) {
  if (!VERSION.test(version)) throw new Error(`Not a release version: ${version}`);
  /** @type {Record<string, { sha256: string, size: number }>} */
  const files = {};
  for (const name of UPDATE_FILES) {
    const file = path.join(dir, name);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }
    files[name] = { sha256: await sha256File(file), size: info.size };
  }
  if (Object.keys(files).length === 0) throw new Error(`No update files in ${dir}`);
  const manifest = { version, shell: SHELL_VERSION, files };
  // What the app will accept, or the release fails here rather than in
  // everyone's app.
  checkManifest(manifest);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, version] = process.argv.slice(2);
  if (!dir || !version) {
    console.error("usage: node release-manifest.mjs <dir> <version>");
    process.exit(2);
  }
  const manifest = await releaseManifest(dir, version);
  await writeFile(path.join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${MANIFEST_NAME}: ${version}, ${Object.keys(manifest.files).join(", ")}`);
}
