// Interface updates: the web half of a release, which an installed app
// loads in place of the copy it was built with, without reinstalling.
// Electron-free, so tests/unit/desktop-web-bundle.test.js runs it in Node.
//
// A bundle is the build's dist/ in a ZIP (Connector-Foundry-web.zip, made
// by scripts/web-bundle.mjs), with a bundle.json naming its version and
// the shell version it was built for (desktop/shell.cjs). The updater
// (updates.cjs) checks the ZIP's SHA-256 against latest.json, unpacks it
// here into the profile's web/<version>/, and main.cjs serves the newest
// one that fits this shell and is newer than the app's own dist/.
//
// The reader is written out rather than taken from a package: the
// packaged app ships no node_modules (electron-builder.yml), and a ZIP
// that reaches it is checked like any file from the network even after
// its checksum matched. Only what scripts/web-bundle.mjs writes is
// accepted: stored or deflated entries, no ZIP64, no encryption, plain
// relative names, each once.

const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const zlib = require("node:zlib");
const { VERSION, isNewer } = require("./update-manifest.cjs");

const BUNDLE_INFO = "bundle.json";
// What a bundle must have to be worth loading: the page the shell opens
// (paths.cjs's APP_PAGE).
const BUNDLE_PAGE = path.join("app", "index.html");
// dist/ is about 23 MB in some 300 files; these are a broken or hostile
// archive, not a bigger app.
const MAX_ENTRIES = 20_000;
const MAX_TOTAL = 512 * 1024 * 1024;

const inflateRaw = promisify(zlib.inflateRaw);

/** @param {string} message */
function bad(message) {
  return new Error(`The interface update is malformed: ${message}.`);
}

/**
 * Whether an entry's name is a plain relative path: no root, drive,
 * backslash or NUL, and no empty, "." or ".." segment.
 * @param {string} name
 */
function safeName(name) {
  if (!name || name.length > 512 || /[\0\\:]/.test(name) || name.startsWith("/")) return false;
  return name.split("/").every((part) => part && part !== "." && part !== "..");
}

/**
 * The files in a ZIP, inflated and checked against their CRC-32s.
 * Directory entries are skipped; the files' paths imply them.
 * @param {Buffer} zip
 * @returns {Promise<{ name: string, data: Buffer }[]>}
 */
async function readZip(zip) {
  // The end-of-central-directory record: the last 22 bytes, unless a
  // comment follows it.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw bad("no end record");
  const count = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const start = zip.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES || start + size > end) throw bad("its directory is out of bounds");
  /** @type {{ name: string, data: Buffer }[]} */
  const files = [];
  const seen = new Set();
  let total = 0;
  let at = start;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) throw bad("a directory entry is broken");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const unpacked = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at = next;
    if (flags & 1) throw bad("an entry is encrypted");
    if (method !== 0 && method !== 8) throw bad("an entry is compressed in an unknown way");
    if (packed === 0xffffffff || unpacked === 0xffffffff || offset === 0xffffffff) throw bad("it is ZIP64");
    const directory = name.endsWith("/");
    const relative = directory ? name.slice(0, -1) : name;
    if (!safeName(relative)) throw bad(`the name ${JSON.stringify(name)}`);
    // Case-folded: macOS and Windows file systems would write two such
    // entries to one file.
    const key = relative.toLowerCase();
    if (seen.has(key)) throw bad(`${name} is in it twice`);
    seen.add(key);
    if (directory) continue;
    total += unpacked;
    if (total > MAX_TOTAL) throw bad("it unpacks too large");
    if (offset + 30 > start || zip.readUInt32LE(offset) !== 0x04034b50) throw bad(`${name} has no header`);
    const from = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    if (from + packed > start) throw bad(`${name} is out of bounds`);
    const raw = zip.subarray(from, from + packed);
    const data =
      method === 0 ? Buffer.from(raw) : await inflateRaw(raw, { maxOutputLength: Math.max(1, unpacked) });
    if (data.length !== unpacked || zlib.crc32(data) !== crc) throw bad(`${name} doesn't match its checksum`);
    files.push({ name: relative, data });
  }
  return files;
}

/**
 * A bundle folder's bundle.json, checked, or null.
 * @param {string} dir
 * @returns {{ version: string, shell: number } | null}
 */
function bundleInfo(dir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, BUNDLE_INFO), "utf8"));
  } catch {
    return null;
  }
  const { version, shell } = raw ?? {};
  if (typeof version !== "string" || !VERSION.test(version) || !Number.isSafeInteger(shell) || shell < 1)
    return null;
  return { version, shell };
}

/**
 * Unpacks a downloaded bundle into `webDir`/<version>/, if it is the
 * version and shell the release said. A half-written folder never has the
 * version's name: it is unpacked beside it and renamed when complete.
 * @param {Buffer} zip
 * @param {string} webDir
 * @param {{ version: string, shell: number }} expected
 * @returns {Promise<string>} the bundle's folder
 */
async function unpackBundle(zip, webDir, expected) {
  if (!VERSION.test(expected.version)) throw new Error("Not a release version.");
  const files = await readZip(zip);
  const root = path.join(webDir, expected.version);
  const partial = `${root}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });
  try {
    for (const { name, data } of files) {
      const file = path.resolve(partial, ...name.split("/"));
      if (!file.startsWith(`${partial}${path.sep}`)) throw bad(`the name ${JSON.stringify(name)}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    }
    const info = bundleInfo(partial);
    if (!info || info.version !== expected.version || info.shell !== expected.shell)
      throw new Error("The interface update isn't the version the release names, so it was thrown away.");
    if (!fs.existsSync(path.join(partial, BUNDLE_PAGE))) throw bad("it has no app page");
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(partial, root);
    return root;
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }
}

/**
 * The newest unpacked bundle this app can load: built for its shell,
 * newer than its own dist/, and not one that failed to start.
 * @param {string} webDir
 * @param {{ shell: number, newerThan: string, skip?: string | null }} options
 * @returns {{ version: string, root: string } | null}
 */
function findBundle(webDir, { shell, newerThan, skip = null }) {
  let names;
  try {
    names = fs.readdirSync(webDir);
  } catch {
    return null;
  }
  /** @type {{ version: string, root: string } | null} */
  let best = null;
  for (const name of names) {
    if (!VERSION.test(name) || name === skip || !isNewer(name, newerThan)) continue;
    if (best && !isNewer(name, best.version)) continue;
    const root = path.join(webDir, name);
    const info = bundleInfo(root);
    if (info?.version !== name || info.shell !== shell || !fs.existsSync(path.join(root, BUNDLE_PAGE)))
      continue;
    best = { version: name, root };
  }
  return best;
}

/**
 * Removes every bundle, and every half-unpacked one, but those in `keep`.
 * @param {string} webDir
 * @param {string[]} keep version names
 */
function removeBundles(webDir, keep) {
  let names;
  try {
    names = fs.readdirSync(webDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!keep.includes(name)) fs.rmSync(path.join(webDir, name), { recursive: true, force: true });
  }
}

module.exports = { BUNDLE_INFO, BUNDLE_PAGE, bundleInfo, findBundle, readZip, removeBundles, unpackBundle };
