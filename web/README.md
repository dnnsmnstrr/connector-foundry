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

The visual editor: a root part plus a tree of parts snapped onto open slots, each connection with
its own joint type — see the root README's "Bench" section for what it does, including how
stacking (attaching onto something that's itself attached) works and why it's only offered where
a part actually has anchors left over. A few implementation notes that don't belong there:

- `src/lib/assembly.js` holds the tree: `{ root: {id:"root", partId, params}, nodes: [...] }`,
  where every node but root carries a `parentId` naming what it's attached to — "root" or another
  node's id, to any depth. `getNode()`/`childrenOf()`/`occupiedSlotNames()` all take that id the
  same way for root and any child, which is what lets `Bench.jsx`'s `slotsForNode()` and
  `NodeTree` treat every node identically regardless of depth.
- `compileToScad()` generates one `.scad` source per assembly state, through the *same*
  worker/render pipeline as everything else (a second request shape, `{ scadSource, part }`,
  alongside the single-part `{ scadFile, module, params }` one) — the Bench never has its own
  bespoke renderer. It recurses depth-first now instead of the old single flat pass, nesting each
  node's `attach()` call around whatever's attached to it; `bodyTagOf()`/`bodyTags()` generalise
  "one printable body per fused subtree" to any depth the same way.
- Slot markers are real 3D objects in the scene (`src/components/StlViewer.jsx`'s `markers`
  prop), raycast-clickable, but **root-only**: a named-anchor position is in the part's own
  centered local frame, and root is the only node BOSL2 places with no rotation, so converting
  that to a world position is a plain height/2 shift (`Bench.jsx`'s `centeredToWorld()`). A
  non-root node's own axes don't line up with world space in general, because `attach()` flips the
  child to make its anchor antiparallel to the parent's — reproducing that transform in JS just to
  place a marker is a correctness trap for no real gain, so a deeper node's open slots are listed
  as plain "+ Attach: `<name>`" buttons in the sidebar (`slotsForNode()`) instead of guessed-at 3D
  points. The rendered/exported geometry is unaffected either way, since that goes through real
  BOSL2, not this shortcut.
- Every node's own standalone extents (needed to enumerate its slots) come from rendering its
  part alone with its own params — the same computation for root and any descendant, since a
  part's own size never depends on where it sits in the tree. Catalogue.yaml's `anchors` field
  (`[bot, xpos, xneg, ypos, yneg]`) is what makes a multi-anchor part like Basics plate/post
  enumerable this way without parsing its `.scad`: each name is just the center of that face of
  the part's own rendered bounding box (`src/lib/slots.js`'s `FACE_ANCHOR_LOCAL`) — no per-part
  formula to restate.
- Every node — root or any depth of child — gets a parameter editor in the sidebar
  (`NodeParamsPanel`), the exact same catalogue-default diff/reset/save-as-default flow as Library
  mode's params panel (`src/components/ParamField.jsx`, shared between the two).
- **STL import** (`src/lib/importedPart.js`, `src/lib/meshValidate.js`): an uploaded mesh is
  parsed with three.js's `STLLoader`, welded and topology-checked (`meshValidate.js` — mirrors
  the watertightness/winding checks `tests/test_manifold.py` runs via trimesh on the Python side;
  reimplemented in JS because the Bench has no Python available, not because the criteria
  differ), then — if it passes — becomes an `attachable()` wrapper module generated inline in the
  compiled assembly source, importing the validated (not raw) STL bytes via OpenSCAD's own
  `import()`. A click on the mesh doesn't place a slot at the raw hit point: `src/lib/faceCluster.js`
  flood-fills out from the hit triangle across every connected, coplanar neighbor (tight angle and
  coplanarity tolerances) to find the whole flat face under the cursor, then reports its 2D-bbox
  center and normal — `StlViewer.jsx`'s raycast handler runs this and hands the result to
  `onSurfacePick`. That center becomes a `named_anchor()` on the generated wrapper, same as any
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
