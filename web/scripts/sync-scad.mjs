// Bundles every .scad source the browser needs (BOSL2 + lib + parts +
// assemblies) into one JSON blob, and copies catalogue.yaml alongside
// it, so the app can fetch its whole virtual filesystem in one request
// instead of one per file. Run before dev/build (see package.json), and
// re-run live by vite-plugin-scad-watch.mjs while `npm run dev` is up.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const WEB_PUBLIC = path.resolve(__dirname, "..", "public");
export const SOURCE_DIRS = ["vendor/BOSL2", "lib", "parts", "assemblies"];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".scad")) {
      out.push(full);
    }
  }
}

export function syncScad() {
  const bundle = {};
  for (const dir of SOURCE_DIRS) {
    const files = [];
    walk(path.join(REPO_ROOT, dir), files);
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      bundle[rel] = fs.readFileSync(file, "utf8");
    }
  }

  fs.mkdirSync(WEB_PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(WEB_PUBLIC, "scad-bundle.json"), JSON.stringify(bundle));
  fs.copyFileSync(path.join(REPO_ROOT, "catalogue.yaml"), path.join(WEB_PUBLIC, "catalogue.yaml"));

  return Object.keys(bundle).length;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const count = syncScad();
  console.log(`sync-scad: bundled ${count} .scad files, copied catalogue.yaml`);
}
