// Renders the landing page hero's parts (src/site/heroPairs.js) through
// the same openscad-wasm build the app's worker uses, and packs them into
// src/site/assets/hero-parts.bin (src/site/heroMeshes.js has the format).
//
// The result is committed, like the gallery renders in docs/img/: a few
// seconds of rendering per part has no place in every build, and a hero
// a release behind a part's latest geometry harms nobody. Run it after
// changing a hero part or the pair list:
//
//   npm run sync-scad && node scripts/hero-parts.mjs
//
// Each pair is two meshes in the base part's frame: the base alone, and
// the attached part where the Bench would put it — rendered as the base
// with the part attached to its "mount" slot, everything but the
// attached part hidden with BOSL2's show_only(). The hero then only has
// to lift the attached part along Z to take the pair apart. A base that
// stands in several pairs is stored once (heroPairs.js's meshNames()).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenSCAD } from "openscad-wasm";
import { HERO_PAIRS, meshNames } from "../src/site/heroPairs.js";
import { encodeMeshes, indexStl } from "../src/site/heroMeshes.js";
import { callArgs, scadLiteral } from "../src/lib/scadLiteral.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, "..");
const OUT = path.join(WEB, "src", "site", "assets", "hero-parts.bin");
// Mounted where the worker mounts the bundle, with the stub in
// assemblies/ so the parts' relative includes resolve the same way.
const REPO_MOUNT = "/repo";
const MAIN = `${REPO_MOUNT}/assemblies/_hero.scad`;
const TAG = "hero_attached";

function readPublic(name) {
  const file = path.join(WEB, "public", name);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: run \`npm run sync-scad\` first`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const bundle = readPublic("scad-bundle.json");
const catalogue = readPublic("catalogue.json");
const encoder = new TextEncoder();
const bundleEntries = [
  ...Object.entries(bundle.files).map(([rel, text]) => [`${REPO_MOUNT}/${rel}`, encoder.encode(text)]),
  ...Object.entries(bundle.assets ?? {}).map(([rel, base64]) => [
    `${REPO_MOUNT}/${rel}`,
    new Uint8Array(Buffer.from(base64, "base64")),
  ]),
];

function catalogueEntry(id) {
  const part = catalogue.parts.find((p) => p.id === id);
  if (!part) throw new Error(`${id} is not in the catalogue`);
  return part;
}

// One fresh instance per render: this openscad-wasm build can run
// callMain only once per instance (see src/worker/openscad-worker.js).
async function render(source) {
  const errors = [];
  const instance = await createOpenSCAD({
    print: () => {},
    printErr: (text) => {
      if (/ERROR|WARNING/.test(text)) errors.push(text);
    },
  });
  const fsobj = instance.getInstance().FS;
  const made = new Set();
  for (const [file, bytes] of [...bundleEntries, [MAIN, encoder.encode(source)]]) {
    let dir = "";
    for (const segment of file.split("/").slice(1, -1)) {
      dir += `/${segment}`;
      if (made.has(dir)) continue;
      try {
        fsobj.mkdir(dir);
      } catch {
        // already there
      }
      made.add(dir);
    }
    fsobj.writeFile(file, bytes);
  }
  const rc = instance
    .getInstance()
    .callMain([MAIN, "-o", "/out.stl", "--export-format=binstl", "--backend=Manifold"]);
  // A warning is as bad as an error here: a missing import renders an
  // empty cut and still exits 0.
  if (rc !== 0 || errors.length) throw new Error(`render failed:\n${errors.join("\n")}\n${source}`);
  return indexStl(fsobj.readFile("/out.stl", { encoding: "binary" }));
}

const meshes = [];
const renderedBases = new Set();
for (const pair of HERO_PAIRS) {
  const names = meshNames(pair);
  const base = catalogueEntry(pair.base.part);
  const attached = catalogueEntry(pair.attached.part);
  const baseCall = `${base.module}(${callArgs({ ...base.defaults, ...pair.base.params })})`;
  const attachedParams = { ...attached.defaults, ...attached.attached_defaults, ...pair.attached.params };
  // The base on its own includes only its own file, as the Library
  // renders it — a file's top-level settings can change another part's
  // facets, and a base shared by two pairs must come out the same.
  const baseInclude = `include <../vendor/BOSL2/std.scad>\ninclude <../${base.file}>`;
  const started = Date.now();
  const baseMesh = renderedBases.has(names.base) ? null : await render(`${baseInclude}\n${baseCall};\n`);
  const attachedMesh = await render(
    `${baseInclude}\ninclude <../${attached.file}>\nshow_only(${scadLiteral(TAG)}) ${baseCall} ` +
      `attach(${scadLiteral("mount")}, ${scadLiteral("mount")}) tag(${scadLiteral(TAG)}) ` +
      `${attached.module}(${callArgs(attachedParams)});\n`,
  );
  if (baseMesh) {
    meshes.push({ name: names.base, ...baseMesh });
    renderedBases.add(names.base);
  }
  meshes.push({ name: names.attached, ...attachedMesh });
  const baseTriangles = baseMesh ? baseMesh.indices.length / 3 : "(shared)";
  console.log(
    `${pair.key}: ${baseTriangles} + ${attachedMesh.indices.length / 3} triangles ` +
      `(${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
}

const bytes = encodeMeshes(meshes);
fs.writeFileSync(OUT, bytes);
console.log(`wrote ${path.relative(WEB, OUT)} (${(bytes.length / 1024).toFixed(1)} KB)`);
