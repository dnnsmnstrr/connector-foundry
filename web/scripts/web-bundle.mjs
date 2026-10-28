import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// The release's interface update, Connector-Foundry-web.zip: the build's
// dist/ with a bundle.json naming its version and the shell version it
// was built for (desktop/shell.cjs). An installed app with that shell
// version loads it instead of downloading the whole build
// (desktop/web-bundle.cjs reads it, desktop/updates.cjs fetches it).
// desktop.yml's Apple Silicon job makes it after the build:
//
//   node scripts/web-bundle.mjs dist release/Connector-Foundry-web.zip
//
// The ZIP is written here, in the plain form the app's reader accepts:
// stored or deflated entries in sorted order, no extra fields, and one
// fixed date, so the same dist/ makes the same file.

const require = createRequire(import.meta.url);
const { BUNDLE_INFO } = require("../desktop/web-bundle.cjs");
const { SHELL_VERSION } = require("../desktop/shell.cjs");
const { VERSION } = require("../desktop/update-manifest.cjs");

// 1980-01-01, the first date a ZIP can hold.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
// Bit 11: the names are UTF-8.
const UTF8 = 0x0800;

/**
 * A ZIP of `files`, in the order given.
 * @param {{ name: string, data: Buffer }[]} files
 */
export function writeZip(files) {
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const directory = [];
  let offset = 0;
  for (const { name, data } of files) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = zlib.crc32(data);
    const fileName = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, fileName, body);
    directory.push(central, fileName);
    offset += local.length + fileName.length + body.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

/**
 * Every file under `dir`, as ZIP names (forward slashes), sorted.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * The interface update for the build in `dist`.
 * @param {string} dist
 * @param {{ version: string, shell?: number }} info `shell` defaults to this checkout's
 * @param {Record<string, string | Buffer>} [replace] files to put in instead of dist's (tests)
 */
export async function webBundle(dist, { version, shell = SHELL_VERSION }, replace = {}) {
  if (!VERSION.test(version)) throw new Error(`Not a release version: ${version}`);
  const names = await listFiles(dist);
  for (const name of Object.keys(replace)) if (!names.includes(name)) names.push(name);
  const files = [{ name: BUNDLE_INFO, data: Buffer.from(`${JSON.stringify({ version, shell })}\n`) }];
  for (const name of names.filter((n) => n !== BUNDLE_INFO).sort()) {
    const data = Object.hasOwn(replace, name)
      ? Buffer.from(replace[name])
      : await readFile(path.join(dist, ...name.split("/")));
    files.push({ name, data });
  }
  return writeZip(files);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dist, out] = process.argv.slice(2);
  if (!dist || !out) {
    console.error("usage: node web-bundle.mjs <dist> <out.zip>");
    process.exit(2);
  }
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const zip = await webBundle(dist, { version });
  await writeFile(out, zip);
  console.log(
    `${path.basename(out)}: ${version}, shell ${SHELL_VERSION}, ${(zip.length / 1e6).toFixed(1)} MB`,
  );
}
