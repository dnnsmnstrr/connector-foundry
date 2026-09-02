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

This build of `openscad-wasm` can only run `callMain` once per instance (a second call aborts
with an opaque WASM trap), and can't run two instances concurrently either — both confirmed by
testing, not assumed. So `openscad-worker.js` spins up a fresh instance per render and serialises
every request through one FIFO queue; see the worker's header comment for the full story,
including a separate, still-unresolved WASM resource limit that shows up for some bolted/snap
joint combinations in the Bench (`src/lib/assembly.js`'s `attachChildScad()` has that one).

## Bench (`src/Bench.jsx`)

The visual editor: one root part, direct children snapped onto its slots, each with a joint type
— see the root README's "Bench" section for what it does. A few implementation notes that don't
belong there:

- `src/lib/assembly.js`'s `compileToScad()` generates one `.scad` source per assembly state,
  through the *same* worker/render pipeline as everything else (a second request shape,
  `{ scadSource, part }`, alongside the single-part `{ scadFile, module, params }` one) — the
  Bench never has its own bespoke renderer.
- Slot markers are real 3D objects in the scene (`src/components/StlViewer.jsx`'s `markers`
  prop), raycast-clickable; a named-anchor position is always in the part's centered local frame
  (BOSL2's `attachable()` convention), so placing one in world space and mapping it back needs a
  small, consistent conversion — see Bench.jsx's `centeredToWorld()`.
- **STL import** (`src/lib/importedPart.js`, `src/lib/meshValidate.js`): an uploaded mesh is
  parsed with three.js's `STLLoader`, welded and topology-checked (`meshValidate.js` — mirrors
  the watertightness/winding checks `tests/test_manifold.py` runs via trimesh on the Python side;
  reimplemented in JS because the Bench has no Python available, not because the criteria
  differ), then — if it passes — becomes an `attachable()` wrapper module generated inline in the
  compiled assembly source, importing the validated (not raw) STL bytes via OpenSCAD's own
  `import()`. Slots the user clicks become `named_anchor()`s on that wrapper, same as any
  catalogue part's. The uploaded/repaired bytes travel to the worker as a `Map` in the render
  request (`importedFiles`), written into the WASM filesystem right next to the generated
  `.scad` before it compiles.

## User overrides (`src/lib/userOverrides.js`)

The browser side of the CLI's `foundry defaults`/`foundry settings` — see the root README's
"User overrides" section for the resolution order (catalogue default -> saved override ->
instance value) and why it's one resolver per side rather than two that could disagree. A few
things specific to the web implementation:

- Backed by `localStorage`, not a file, but the same Customizer-JSON shape as the CLI's saved
  files (`fileFormatVersion`/`parameterSets`, one `"user-default"` preset) so the two stay
  conceptually interchangeable. Every read/write is wrapped in `try`/`catch` — a private window,
  cleared site data, or some embedding contexts throw or come back empty, and that has to degrade
  to "no saved overrides" rather than break the app.
- `sync-scad.mjs` also writes `public/global-defaults.json`, extracted from
  `lib/constants.scad`'s simple top-level literals (skips anything computed) — so the Settings
  modal has a real catalogue-default number for FIT_CLEARANCE to diff and reset against instead
  of a second hand-typed copy of `0.15` living in JS.
- A global override rides to the worker as a `globalOverrides` map on the render request and
  comes out the other end as real `-D NAME=value` flags (`openscad-worker.js`) — the same
  mechanism `cli/foundry.py`'s `run_openscad()` uses, and it overrides a constant set via
  `include` the same way on both: confirmed with a native `openscad -D FIT_CLEARANCE=...` run
  before relying on it here, not assumed. Only affects a part that actually reads
  `FIT_CLEARANCE` — Gridfinity/GoPro/openGrid wrap a vendored module with its own fit logic and
  won't move.

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
