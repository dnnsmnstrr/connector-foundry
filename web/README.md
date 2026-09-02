# Connector Foundry — web

Browser picker for the catalogue: choose a part, tweak its parameters, and export an STL —
entirely client-side. It compiles the *same* `.scad` sources under `parts/` and `lib/` that the
CLI uses, via [`openscad-wasm`](https://www.npmjs.com/package/openscad-wasm) (Manifold backend)
running in a Web Worker.

## How it works

1. `npm run sync-scad` (runs automatically before `dev`/`build`) bundles every `.scad` file the
   parts reach into — `lib`, `parts`, `assemblies`, and the vendored upstreams (`SOURCE_DIRS` in
   `scripts/sync-scad.mjs`, narrowed to the subtrees actually used) — into `public/scad-bundle.json`,
   and copies `catalogue.yaml` into `public/`. This is the only "build step" that touches the
   OpenSCAD sources — the app never transpiles or reimplements them. A source directory with no
   `.scad` files in it (a submodule that was never checked out) is reported, since the symptom
   in the browser is otherwise just an unhelpful "can't open include" on the parts that need it.
2. `src/hooks/useCatalogue.js` reads `catalogue.yaml` for the part list, default parameters, and
   confidence labels; `src/Library.jsx` renders a picker + parameter form from it — same schema
   the CLI reads.
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
joint combinations in the Bench (`src/lib/assembly.js`'s `emitJointChild()` has that one).

If the worker itself dies (a script error, a message that can't be deserialised), every render
waiting on it is rejected with a message saying so and the worker is discarded, so the next
render starts a fresh one — a request whose worker is gone would otherwise hang forever.

## Module layout

Shared UI pieces live in `src/components/`; everything with no React in it lives in `src/lib/`.

| Module | What |
| --- | --- |
| `src/App.jsx` | Shell: nav, mode switch, Settings, the shared sidebar preference |
| `src/Library.jsx`, `src/Bench.jsx` | The two modes — see the sections below |
| `src/components/PartBrowser.jsx` | Search box + grouped part list, used by Library's sidebar and both Bench pickers |
| `src/components/ParamsEditor.jsx` | One part's parameter fields plus reset / save-as-default / clear, used by Library and every Bench node |
| `src/components/Modal.jsx`, `SettingsModal.jsx`, `ParamField.jsx`, `SidebarToggle.jsx`, `StlViewer.jsx` | The rest of the shared UI |
| `src/components/bench/` | Bench-only: `ImportFlow` (STL upload + slot placement), `NodeTree` (the "Attached" tree), `JointSelect` |
| `src/lib/assembly.js` | The Bench's tree model and `.scad` codegen |
| `src/lib/benchLayout.js` | Which slots a node still offers, and where each 3D marker goes |
| `src/lib/slots.js` | Slot enumeration for a catalogue part (mirror of `lib/slots.scad`) |
| `src/lib/importedPart.js`, `meshValidate.js`, `faceCluster.js`, `meshTopology.js` | STL import: the part record, the validate/repair gate, face-center snapping, and the edge/adjacency builders those two share |
| `src/lib/openscad-client.js`, `src/worker/openscad-worker.js` | The render pipeline: promise wrapper + cache on the main thread, OpenSCAD WASM in the worker |
| `src/lib/scadLiteral.js` | The one OpenSCAD-literal formatter (codegen and worker both use it; mirrors `cli/foundry.py`'s `openscad_value()`) |
| `src/lib/userOverrides.js`, `uiPrefs.js` | localStorage-backed state: saved parameter overrides, sidebar collapsed |
| `src/lib/meshExtents.js`, `download.js`, `publicAsset.js`, `catalogueUtils.js` | Small helpers: memoised STL bounding boxes, "save this file", fetching the generated `public/` assets, grouping/search/slugs |

## Shell (`src/App.jsx`)

The nav bar, Settings modal, and the shared "sidebar collapsed?" preference both Library's and the
Bench's own `<aside>` read — these live at the `App` level since they're not specific to either
screen.

- Keyboard shortcuts: `1`/`2` switch Library/Bench, `s` opens Settings, `[` toggles the sidebar,
  `Escape` closes Settings. One `keydown` listener (`App`'s own `useEffect`) handles all of these;
  `isEditableTarget()` skips every single-key shortcut (not `Escape`, which is expected to work
  from inside a focused field the same way a native `<dialog>` does) whenever the event's target is
  a text input, `<select>`, or anything `contentEditable` — so typing "s" in the search box types
  an "s", it doesn't open Settings. The Bench's own modals (attach-a-part, STL import) close on
  `Escape` too, but that's a second, local listener in `Bench.jsx` — that state is local to Bench,
  so App doesn't need to reach into it.
- Collapsible sidebar: one shared boolean (`src/lib/uiPrefs.js`, localStorage-backed the same
  best-effort way as `userOverrides.js`) rather than one per screen, so collapsing it in Library
  and switching to Bench doesn't spring it back open. `src/components/SidebarToggle.jsx` is the
  same button in both `<aside>`s; collapsing just skips rendering everything past it (`Library`'s
  and `Bench.jsx`'s `{!sidebarCollapsed && (...)}`) rather than hiding it with CSS, and
  `.app`/`.bench`'s grid column narrows to fit — no separate collapsed-vs-expanded layout to keep
  in sync.

## Bench (`src/Bench.jsx`)

The visual editor: a root part plus a tree of parts snapped onto open slots, each connection with
its own joint type — see the root README's "Bench" section for what it does, including how
stacking (attaching onto something that's itself attached) works and why it's only offered where
a part actually has anchors left over. A few implementation notes that don't belong there:

- `src/lib/assembly.js` holds the tree: `{ root: {id:"root", partId, params}, nodes: [...] }`,
  where every node but root carries a `parentId` naming what it's attached to — "root" or another
  node's id, to any depth. `getNode()`/`childrenOf()`/`occupiedSlotNames()` all take that id the
  same way for root and any child, which is what lets `src/lib/benchLayout.js`'s `slotsForNode()`
  and `components/bench/NodeTree.jsx` treat every node identically regardless of depth.
- `compileToScad()` generates one `.scad` source per assembly state, through the *same*
  worker/render pipeline as everything else (a second request shape, `{ scadSource, part }`,
  alongside the single-part `{ scadFile, module, params }` one) — the Bench never has its own
  bespoke renderer. It recurses depth-first, nesting each node's `attach()` call around whatever's
  attached to it; `bodyTags()` generalises "one printable body per fused subtree" to
  any depth, and — for a pin joint — one further tag for the pin itself
  (`"<childId>_pin"`, since the pin is its own third printable body, not integral to either
  flange; see the root README's "Joints" section). Getting an isolated body's export right for
  anything deeper than one level needed more than gating the whole tree with one `if (part == tag)`:
  BOSL2's `hide_this()` (an "invisible parent that still positions its children" — see its own doc
  comment in `vendor/BOSL2/attachments.scad`) only suppresses geometry ONE level at a time, so
  `emitChildren()`/`emitJointChild()`/`dispatchBlock()` thread an explicit `hide` flag through
  *every* module call between the root and whatever body is actually wanted, re-deciding
  shown-vs-hidden at each new tag boundary (root itself, and each joint child's own flangeB+part) —
  a fused child just inherits its parent's `hide` state unchanged, since it introduces no boundary
  of its own. Worth knowing if you're reading the generated `.scad`: it looks more repetitive than
  it needs to for any one specific export, because it has to stay correct for *any* tag chosen at
  render time via `-D part=...`, not just the one you happen to be looking at.
- Slot markers are real 3D objects in the scene (`src/components/StlViewer.jsx`'s `markers`
  prop), raycast-clickable — root's own open slots, plus one more per stacked node that still has
  its "bot" anchor open (`src/lib/benchLayout.js`'s `stackSlotFor()`; everything about where a
  marker goes lives in that module, as pure functions over the tree, the parts map and each node's
  own extents — `Bench.jsx` only wires state to them). A named-anchor position is in the part's
  own centered local frame; root is the only node BOSL2 places with no rotation, so its markers are
  a plain height/2 shift (`centeredToWorld()`). A non-root node's own axes don't line up with world
  space in general, because `attach()` flips the child to make its anchor antiparallel to the
  parent's — reproducing that rotation in JS to place an arbitrary marker would be a correctness
  trap. "bot" specifically sidesteps it: it sits on the part's local Z axis (x=0, y=0), directly
  opposite "mount" (the only anchor a catalogue part ever attaches through), and *any* 180° flip
  about a horizontal axis sends an on-axis point to the same place — `(0,0,h)` to `(0,0,-h)` — so
  which horizontal axis BOSL2 actually rotated about doesn't matter for this one point. That gives
  an exact world position (`exposedTopWorldPosition()`: the node's own attach point, plus its own
  height, recursed up the chain) without knowing BOSL2's rotation convention at all. It does *not*
  generalise to an off-axis anchor (a plate's `xpos`/`ypos`/etc, where the two candidate rotations
  disagree) — those stay sidebar-only for now (`slotsForNode()`, reached only for an imported
  part's arbitrary user-placed anchors, which have no "up" to reason about this way either). Marker
  ids are `"<parentId>::<slotName>"` so one click handler (`onMarkerClick`) resolves a click on
  any node's marker the same way. The rendered/exported geometry is unaffected either way, since
  that goes through real BOSL2, not this shortcut.
- Every node's own standalone extents (needed to place its own marker and enumerate its slots)
  come from rendering its part alone with its own params — the same computation for root and any
  descendant, since a part's own size never depends on where it sits in the tree. The render is
  cached in `openscad-client.js` and the bounding-box parse of its result is memoised per buffer
  (`src/lib/meshExtents.js`), so an assembly edit that changes nothing about a node costs two
  lookups for it, not a compile and a re-parse of its mesh. Catalogue.yaml's
  `anchors` field (`[bot, xpos, xneg, ypos, yneg]`) is what makes a multi-anchor part like Basics
  plate/post enumerable this way without parsing its `.scad`: each name is just the center of that
  face of the part's own rendered bounding box (`src/lib/slots.js`'s `FACE_ANCHOR_LOCAL`) — no
  per-part formula to restate. The Bench currently only *offers* `bot` for stacking (see the root
  README); the rest of the field, and `FACE_ANCHOR_LOCAL`'s other entries, stay there for root's
  own display and as the seam for whenever off-axis stacking is worth the marker-placement work.
- `slots.js`'s `enumerateSlots()` combines every slot source a part declares — a top grid
  (`slots`), single box-face anchors (`anchors`), and now a per-face row (`side_slots`) — instead
  of picking exactly one, matching catalogue.yaml's own schema comment that these were always
  meant to be combinable. `basics/pinhole_plate` is the first part to actually use all three at
  once: its top grid and side rows both come from `side_slots.faces`' `enabled_param`/`count_param`
  pointing back at the part's own `side_xpos`/`grid_y`-style params, so a disabled side or a
  resized grid changes what's clickable in the Bench the same render it changes the geometry —
  see catalogue.yaml's `side_slots` schema comment for the field shapes.
- Fetching every node's own standalone extents (the bullet above) is a `Promise.allSettled`, not
  `Promise.all`: one node's render hitting the same openscad-wasm resource limit
  `friendlyRenderError()` already has a message for shouldn't cost every *other* node its markers,
  or surface as an unhandled promise rejection — it's logged (`console.warn`) and that one node's
  slots just don't show, same as if nothing had asked for them yet. Relatedly,
  `openscad-client.js`'s worker message handler now actually forwards the worker's own
  `type: "log"` messages (the detailed OpenSCAD stderr behind a generic "check the parameters"
  failure) to `console.error` instead of silently dropping them — previously dead code, since
  those messages have no `id` to match a pending request against.
- Every node — root or any depth of child — gets a parameter editor in the sidebar: the same
  `src/components/ParamsEditor.jsx` Library mode's params panel is, so the catalogue-default
  diff/reset/save-as-default flow is one implementation, not two that agree.
- Each child carries an `overlap` field (mm, default 0) — the root README's "Offset" — that
  becomes BOSL2 `attach()`'s own `overlap=` on the *final* attach in that child's chain (the plain
  attach for a fused joint, or the child-onto-flangeB attach for bolted/snap — never the flanges'
  own placement, which stays exactly where the joint geometry expects it).
  `lib/assembly.js`'s `overlapArg()` flips the sign: BOSL2's own convention is positive-sinks-in,
  the Bench's is negative-sinks-in (reads more naturally as "push it in further" = "more negative"),
  and 0 is omitted from the generated `.scad` entirely rather than emitted as a no-op argument.
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
  catalogue part's. Since `clusterFace()` is deterministic per coplanar patch, clicking an
  already-slotted face again recomputes the same center regardless of which triangle in it was
  actually hit — `components/bench/ImportFlow.jsx`'s `placeSlot()` asks `importedPart.js`'s
  `findAnchorNear()` (within `DUPLICATE_SLOT_TOLERANCE_MM`) and re-selects the existing anchor
  instead of stacking a second marker on it. Both `meshValidate.js` and `faceCluster.js` build
  their edge/adjacency structures through `src/lib/meshTopology.js`, which keys edges on a packed
  number rather than a string; `faceCluster.js` also caches the adjacency per geometry, so only
  the first click on an imported mesh pays for building it. The uploaded/repaired bytes travel to
  the worker as a `Map` in the render request (`importedFiles`), written into the WASM filesystem
  right next to the generated `.scad` before it compiles.

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
