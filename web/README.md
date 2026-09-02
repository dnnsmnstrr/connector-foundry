# Connector Foundry — web

Browser picker for the catalogue: choose a part, tweak its parameters, and export an STL —
entirely client-side. It compiles the *same* `.scad` sources under `parts/` and `lib/` that the
CLI uses, via [`openscad-wasm`](https://www.npmjs.com/package/openscad-wasm) (Manifold backend)
running in a Web Worker.

## How it works

1. `npm run sync-scad` (runs automatically before `dev`/`build`) bundles every `.scad` file under
   `vendor/BOSL2`, `lib`, `parts`, and `assemblies` into `public/scad-bundle.json`, and copies
   `catalogue.yaml` into `public/`. This is the only "build step" that touches the OpenSCAD
   sources — the app never transpiles or reimplements them.
2. `src/App.jsx` reads `catalogue.yaml` for the part list, default parameters, and confidence
   labels, and renders a picker + parameter form from it — same schema the CLI reads.
3. `src/worker/openscad-worker.js` fetches `scad-bundle.json` once, writes it into the WASM
   virtual filesystem at `/repo/...` (mirroring the real repo layout, since every `.scad` file
   uses relative `include`s), then on each render request writes a one-line stub —
   `include </repo/parts/.../x.scad>; module_name(args);` — and calls OpenSCAD with
   `--backend=Manifold`.
4. The resulting STL bytes come back to the main thread and render via `three.js`
   (`src/components/StlViewer.jsx`), or download directly.
5. `src/lib/openscad-client.js` keeps each result for five minutes, keyed on the exact
   (file, module, parameters) triple, so switching back to a part — or to parameters tried a
   moment ago — is instant instead of a fresh multi-second compile. Stale entries are dropped,
   and the cache is capped at 64 MB of meshes.

## Local dev

```bash
npm install
npm run dev
```

## Licensing note

`openscad-wasm` bundles OpenSCAD itself (GPL-2.0) compiled to WebAssembly. It's used here as an
external tool the browser fetches and runs, the same way the CLI shells out to the `openscad`
binary — no OpenSCAD source is copied into this repository. See the root `README.md` for the
project's own MIT license.
