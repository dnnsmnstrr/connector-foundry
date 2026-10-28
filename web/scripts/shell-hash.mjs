import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The desktop shell's fingerprint: everything the installed app runs that
// an interface update (the web bundle, desktop/web-bundle.cjs) can't
// replace. desktop/shell.cjs records it beside the shell's version, and
// tests/unit/desktop-shell.test.js fails when the two disagree, so a
// change to the shell can't reach a release without its version moving
// on. An app only loads interface updates built for its own shell version,
// so a moved-on version sends every installed app the full update.
//
//   node scripts/shell-hash.mjs          prints the fingerprint
//   node scripts/shell-hash.mjs --bump   moves the version on and records it

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL_FILE = path.join(web, "desktop", "shell.cjs");

/**
 * The SHA-256 over the shell's sources (desktop/*.cjs, but shell.cjs, which
 * holds the result), the packaging config, and the Electron version the
 * lockfile pins. Line endings are normalised: a Windows checkout with
 * autocrlf must hash the same.
 * @param {string} [dir] web/
 */
export async function shellHash(dir = web) {
  const hash = createHash("sha256");
  /** @param {string} name @param {string} text */
  const add = (name, text) => hash.update(`${name}\0${text.replace(/\r\n/g, "\n")}\0`);
  const desktop = path.join(dir, "desktop");
  const sources = (await readdir(desktop)).filter((name) => name.endsWith(".cjs") && name !== "shell.cjs");
  for (const name of sources.sort()) add(`desktop/${name}`, await readFile(path.join(desktop, name), "utf8"));
  add("electron-builder.yml", await readFile(path.join(dir, "electron-builder.yml"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(dir, "package-lock.json"), "utf8"));
  add("electron", String(lock.packages?.["node_modules/electron"]?.version));
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  add("main", String(pkg.main));
  return hash.digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hash = await shellHash();
  if (process.argv.includes("--bump")) {
    const source = await readFile(SHELL_FILE, "utf8");
    const version = Number(/SHELL_VERSION = (\d+);/.exec(source)?.[1]);
    if (!Number.isSafeInteger(version)) throw new Error(`No SHELL_VERSION in ${SHELL_FILE}`);
    await writeFile(
      SHELL_FILE,
      source
        .replace(/SHELL_VERSION = \d+;/, `SHELL_VERSION = ${version + 1};`)
        .replace(/SHELL_HASH = "[0-9a-f]*";/, `SHELL_HASH = "${hash}";`),
    );
    console.log(`shell ${version + 1}: ${hash}`);
  } else {
    console.log(hash);
  }
}
