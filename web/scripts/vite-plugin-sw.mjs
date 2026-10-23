// Emits the app's service worker (src/sw.js → <outDir>/sw.js, at the
// base, so its scope covers the workers under assets/ too — src/sw.js says
// why) with
// its build id filled in, and defines `__PUBLIC_VERSIONS__` for the app's
// code.
//
// The build id — the commit on CI (GITHUB_SHA's first twelve characters),
// a timestamp locally — names the worker's cache (`cf-<id>`), so a new
// build's activation can tell the previous build's cache apart and
// migrate its hashed assets.
//
// `__PUBLIC_VERSIONS__` maps an unhashed public file to a hash of its
// content, and lib/publicAsset.js appends it to the file's URL
// (`scad-bundle.json?v=<hash>`), which the worker treats as immutable.
// Only the .scad bundle has one: it is 0.7 MB on the wire and changes
// only when the sources do, so a deploy that touched nothing but the app's
// code costs a returning phone nothing for it — a version per build would
// re-download it after every deploy. catalogue.json and
// global-defaults.json are 11 KB together and fetched network-first, with
// their plain URLs (the browser tests mock them by that URL). The hash is
// read at config time, after `prebuild` has run sync-scad; under the dev
// server the map is empty — no worker, and the bundle the watcher
// rewrites would outdate any hash taken at start. `define` is merged into
// the resolved config, which Vite hands to the build-time worker pass as
// well (the render worker fetches the bundle), so this plugin is listed
// under `plugins` only — in `worker.plugins` too, its generateBundle would
// run again in the worker pass and emit sw.js a second time.
//
// src/sw.js is not a Vite entry: it is a classic script read as text and
// emitted as an asset, untouched except for the token, since bundling
// could add an `import` or a helper the service worker scope cannot run.
// There is no `apply: "build"`: generateBundle only runs in a build
// anyway, and the `define` is needed in dev too, where
// `__PUBLIC_VERSIONS__` would otherwise be an undefined identifier.
//
// The manifest (public/app/manifest.webmanifest) needs none of this: its
// icon URLs are relative ("../icons/icon-192.png") and resolve against the
// manifest's own URL, so the one file works under both bases.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(WEB, "src", "sw.js");
const PUBLIC = path.join(WEB, "public");

// The public files whose URL carries their content's hash (see above).
export const VERSIONED_PUBLIC_FILES = Object.freeze(["scad-bundle.json"]);

/**
 * `{ name: hash }` for the versioned public files that exist in `dir`: the
 * first ten hex digits of each one's SHA-256. A file that is missing (no
 * sync-scad yet) is left out, and its URL stays plain.
 * @param {string} [dir]
 * @returns {Record<string, string>}
 */
export function publicVersions(dir = PUBLIC) {
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of VERSIONED_PUBLIC_FILES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    versions[name] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10);
  }
  return versions;
}

/** The placeholder in src/sw.js, written there as `const BUILD_ID = "__BUILD_ID__";`. */
export const BUILD_ID_TOKEN = "__BUILD_ID__";

/**
 * This build's id: the commit on CI, a base-36 timestamp elsewhere.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {() => number} [now]
 */
export function buildId(env = process.env, now = Date.now) {
  return (env.GITHUB_SHA ?? "").slice(0, 12) || now().toString(36);
}

/**
 * The worker's source with the token replaced. The token must be there
 * exactly once: a renamed or duplicated one would ship a worker whose
 * cache is named after the placeholder, which every build would share.
 * @param {string} source
 * @param {string} id
 */
export function withBuildId(source, id) {
  const quoted = JSON.stringify(BUILD_ID_TOKEN);
  const at = source.indexOf(quoted);
  if (at === -1 || source.indexOf(quoted, at + 1) !== -1) {
    throw new Error(`vite-plugin-sw: expected ${quoted} exactly once in ${SOURCE}`);
  }
  return source.replace(quoted, JSON.stringify(id));
}

/**
 * @param {{ id?: string, publicDir?: string }} [options] the build id
 *   (computed once from the environment when not given) and where the
 *   public files are; tests pass their own
 */
export default function serviceWorkerPlugin({ id = buildId(), publicDir = PUBLIC } = {}) {
  return {
    name: "foundry-service-worker",
    /**
     * @param {unknown} _config
     * @param {{ command: "build" | "serve" }} env
     */
    config(_config, env) {
      const versions = env?.command === "build" ? publicVersions(publicDir) : {};
      return { define: { __PUBLIC_VERSIONS__: JSON.stringify(versions) } };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: withBuildId(fs.readFileSync(SOURCE, "utf8"), id),
      });
    },
  };
}
