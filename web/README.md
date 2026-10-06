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
   A binary a part `import()`s (the `parts/deckmate/*.stl` meshes) rides along base64-encoded
   under the bundle's `assets` key and is mounted at the same repo-relative path, so the part's
   relative `import()` resolves in the browser exactly as it does on disk.
2. `src/hooks/useCatalogue.js` reads `catalogue.yaml` for the part list, default parameters, and
   confidence labels; `src/Library.jsx` renders a picker + parameter form from it — same schema
   the CLI reads.
3. `src/worker/openscad-worker.js` fetches `scad-bundle.json` once and decodes it to bytes once
   (a fresh WASM instance is needed per render — see below — and writing the sources into it as
   strings would re-encode 5 MB of UTF-8 every time). Each render request then mounts those bytes
   into the new instance's virtual filesystem at `/repo/...` (mirroring the real repo layout, since
   every `.scad` file uses relative `include`s), writes a one-line stub —
   `include </repo/parts/.../x.scad>; module_name(args);` — and calls OpenSCAD with
   `--backend=Manifold`.
4. The resulting STL bytes — binary STL, a fifth the size of OpenSCAD's default ASCII export and
   far quicker to parse — come back to the main thread and render via `three.js`
   (`src/components/StlViewer.jsx`), or download directly.
5. `src/lib/openscad-client.js` keeps each result for five minutes, keyed on the exact
   (file, module, parameters) triple, so switching back to a part — or to parameters tried a
   moment ago — is instant instead of a fresh multi-second compile. Stale entries are dropped,
   and the cache is capped at 64 MB of meshes.

This build of `openscad-wasm` can only run `callMain` once per instance (a second call aborts
with an opaque WASM trap), and can't run two instances concurrently either — both confirmed by
testing, not assumed. So `openscad-worker.js` spins up a fresh instance per render and serialises
work defensively in the worker; `openscad-client.js` now owns the cancellable FIFO
and sends only one job at a time. Only the instance is fresh: the compiled WebAssembly module
is reused across them (`scripts/vite-plugin-openscad-wasm-memo.mjs` — the package would otherwise
decode and recompile its inlined 10 MB `.wasm` on every render, 40–105 ms a time). See the
worker's header comment for the full story.

**Known limit — nesting depth.** This `openscad-wasm` build runs out of thread stack about 70
nested module levels down: a chain of 69 BOSL2 attachables renders, 70 traps, with the symptom
varying by what the overflow lands on (`memory access out of bounds`, `table index out of bounds`,
`original is not a function`). Measured on 2026-10-06 in Chrome's worker and in Node alike, with
`$parent_modules` echoed from an instrumented BOSL2 `attachable()` to count the levels. It is the
one cause behind every Bench render failure the READMEs blame on bolted/snap/pin joints
(`src/lib/assembly.js`'s `emitJointChild()`, `Bench.jsx`'s `friendlyRenderError()`): each
`attach()` / joint flange / rounded cuboid adds levels, and the deep parts (openGrid's snap, the
openConnect and MultiConnect snaps) start near the limit — `lib/opengrid.scad`'s header says what
was done so those two render here at all (65 levels), and why they will not survive being a
Bench child. There is no knob for it: the stack size is fixed when the WASM is linked, and no
newer `openscad-wasm` exists on npm.

If the worker itself dies (a script error, a message that can't be deserialised), every render
waiting on it is rejected with a message saying so and the worker is discarded, so the next
render starts a fresh one — a request whose worker is gone would otherwise hang forever.

## Module layout

Shared UI pieces live in `src/components/`; everything with no React in it lives in `src/lib/`.

| Module | What |
| --- | --- |
| `src/App.jsx` | Shell: nav, mode switch, Settings, the shared sidebar preference, the render-in-progress indicator |
| `src/hooks/useRenderActivity.js` | How many OpenSCAD renders are in flight app-wide (subscribes to `openscad-client.js`'s `inFlight` map) |
| `src/hooks/useSystemOrder.js`, `useHiddenLibrary.js` | The saved system-heading order and the hidden systems/parts, live (both subscribe to `uiPrefs.js`) so every part list reorders and thins out as Settings changes them |
| `src/Library.jsx`, `src/Bench.jsx`, `src/Holes.jsx` | The three modes — see the sections below |
| `src/components/PartBrowser.jsx` | Search box + grouped part list, used by Library's sidebar and both Bench pickers; headings follow the order set in Settings. Lists `catalogueUtils.js`'s `listedParts()`: the catalogue minus entries marked `hidden` (bitbeam/pin, bitbeam/axle) and minus what the user hid in Settings — all of which stay in the parts map for lookups by id |
| `src/components/ParamsEditor.jsx` | One part's parameter fields plus reset / save-as-default / clear, used by Library and every Bench node |
| `src/components/Modal.jsx`, `SettingsModal.jsx`, `ParamField.jsx`, `SidebarToggle.jsx`, `StlViewer.jsx`, `FileDropzone.jsx` | The rest of the shared UI; `FileDropzone` is the STL/STEP/3MF picker — a dashed drop target with the real file input stretched invisibly over it, so a click opens the chooser natively and a dropped file goes to the same handler |
| `src/components/bench/` | Bench-only: `ImportFlow` (STL/STEP/3MF upload, body picker, slot placement), `NodeTree` (the "Attached" tree), `PresetsPanel` (saved setups + config import), `JointSelect` |
| `src/lib/assembly.js` | The Bench's tree model and `.scad` codegen |
| `src/components/holes/` | Holes-only: `ScrewIcon` (a preset as a cross-section SVG — a screw in its hole, or a connector head seated in its slot), `PresetPicker` (the grouped icon grid), `HoleSpecFields` (diameter / depth / head pocket fields, or a slot's lock side, clearances, channel length and direction) |
| `src/lib/screwHoles.js`, `screwPresets.js`, `snapCandidates.js`, `holesSession.js`, `hooks/useHolesSession.js` | The Holes tab: its document and `difference()` codegen (screw holes, and openConnect / MultiConnect slots cut by `lib/openconnect.scad` and `lib/multiconnect.scad`); the fastener and slot presets; the face-feature snap points; the live document as module state |
| `src/lib/benchConfig.js`, `benchPresets.js`, `hooks/useBenchPresets.js` | A bench setup as a file (serialise / check / hydrate), and the localStorage-backed named list of those documents |
| `src/lib/benchSession.js`, `benchUrlState.js`, `hooks/useBenchSession.js` | The live bench as module state (outlives the Bench component), and its mirror in the URL hash + sessionStorage so a reload restores it |
| `src/lib/benchLayout.js` | Which slots a node still offers, and where each 3D marker goes |
| `src/lib/slots.js` | Slot enumeration for a catalogue part (mirror of `lib/slots.scad`) |
| `src/lib/importedPart.js`, `meshValidate.js`, `faceCluster.js`, `meshTopology.js` | STL/STEP/3MF import: the part record, the validate/repair gate, face-center snapping, and the edge/adjacency builders those two share |
| `src/lib/stepMesh.js`, `stepImport.js`, `src/worker/step-worker.js` | STEP import: file detection, tessellation settings and body/geometry conversion (pure, Node-testable); the promise wrapper; OpenCASCADE WASM (`occt-import-js`) in its own worker |
| `src/lib/threeMfMesh.js` | 3MF import: detection, the file's unit (read from the zip, since three.js's `ThreeMFLoader` parses it but never applies it), and the loader's Group flattened into the same bodies a STEP tessellates to, scaled to millimetres |
| `src/lib/openscad-client.js`, `src/worker/openscad-worker.js` | The render pipeline: promise wrapper + cache on the main thread, OpenSCAD WASM in the worker |
| `src/lib/scadLiteral.js` | The one OpenSCAD-literal formatter (codegen and worker both use it; mirrors `cli/foundry.py`'s `openscad_value()`) |
| `src/lib/userOverrides.js`, `uiPrefs.js` | localStorage-backed state: saved parameter overrides (and `resolveParams()` / `resolveAttachedParams()`, the catalogue-default → saved-override → instance merge, the latter with the catalogue's `attached_defaults` for a part the Bench attaches to another); sidebar collapsed, "Bench follows Library", system-heading order, hidden systems and parts |
| `src/lib/meshExtents.js`, `download.js`, `publicAsset.js`, `catalogueUtils.js` | Small helpers: memoised STL bounding boxes, "save this file", fetching the generated `public/` assets, grouping/search/slugs and the system-order resolution |

## Shell (`src/App.jsx`)

The nav bar, Settings modal, and the shared "sidebar collapsed?" preference both Library's and the
Bench's own `<aside>` read — these live at the `App` level since they're not specific to either
screen.

- Keyboard shortcuts: `1`/`2`/`3` switch Library/Bench/Holes, `s` opens Settings, `[` toggles the sidebar,
  `Escape` closes Settings. One `keydown` listener (`App`'s own `useEffect`) handles all of these;
  `isEditableTarget()` (`src/lib/isEditableTarget.js`, shared with the Bench's own keys) skips every
  single-key shortcut (not `Escape`, which is expected to work
  from inside a focused field the same way a native `<dialog>` does) whenever the event's target is
  a text input, `<select>`, or anything `contentEditable` — so typing "s" in the search box types
  an "s", it doesn't open Settings. The Bench's own modals (attach-a-part, STL/STEP import) close on
  `Escape` too, but that's a second, local listener in `Bench.jsx` — that state is local to Bench,
  so App doesn't need to reach into it. `src/components/Modal.jsx` is a native `<dialog>` opened
  with `showModal()`, so the browser also fires its own `cancel` on Escape (routed to the same
  `onClose`), keeps Tab inside the dialog, makes the page behind it inert, and returns focus to
  the opener on close; the `title` prop is what the dialog is `aria-labelledby`.
- Narrow screens (`max-width: 768px` in `styles.css`): the two-column shell stacks into one
  scrolling column — sidebar (capped at 45% of the viewport, scrolls inside itself) on top, then
  the header, the 3D viewer at a fixed viewport fraction (the canvas sizes itself from its mount,
  so it needs a real height), then the parameter form. The `[` shortcut hints and the "Settings"
  word hide; `SidebarToggle` shows text instead of a chevron. A `(pointer: coarse)` block gives
  every primary control a 44px hit area and skips `PartBrowser`'s `autoFocus` so the keyboard
  doesn't pop over the list.
- Switching to the Bench goes through one `switchToBench()` (the tab and the `2` shortcut alike).
  With the "Switching to the Bench opens the Library's selected part" setting on (off by default,
  `uiPrefs.js`), it seeds an *empty* Bench with Library's current part and parameters exactly as
  the "Open in Bench" button does — Library reports its selection up via `onSelectionChange`, App
  keeps it in a ref. A bench that's already started is never replaced by a switch; the button asks
  first (`window.confirm`) when there is one to lose. It's a no-op from inside the Bench, so `2`
  there never resets an assembly. The same ref goes back down as Library's `initialSelection` when
  it remounts, so switching to the Bench and back lands on the part (and parameter edits) that
  were showing, not on the first part in the catalogue.
- **The bench survives the mode switch and a reload.** The tree and the imported meshes live in
  `src/lib/benchSession.js` (module state, read through `hooks/useBenchSession.js`), not in
  `Bench.jsx`'s own `useState` — the Bench unmounts whenever Library is up and used to take the
  setup with it. On remount its render is a cache hit in `openscad-client.js`. App also mirrors
  the tree into the URL hash (`src/lib/benchUrlState.js`): `#mode=bench&bench=<payload>`, the
  payload being the tree as compact JSON (benchConfig.js's `root`/`nodes` shape, defaults left out)
  in URL-safe base64 — a few hundred bytes for a typical bench — written with
  `history.replaceState`: at once for a mode switch, 300 ms after the last edit for the tree, so
  the address bar follows the bench without piling up history entries or rewriting per keystroke;
  the plain URL means Library with no bench. Imported STL meshes are
  far too big for a URL, so they go to `sessionStorage` (same embedded shape as a config file),
  which survives a reload of *that tab* only. On load, App restores the bench from the hash before
  rendering either mode (a `restored` gate also holds the mirror back, or it would overwrite the
  hash it's about to read), through the same `hydrateBenchConfig()` a file goes through — checks,
  fresh ids, meshes rebuilt. A link that can't be restored (truncated, or naming a mesh only the
  original tab had) leaves an empty session carrying a `notice` that the Bench's start screen
  shows in place of the config error, pointing at the config export, which does carry the meshes.
  A `hashchange` after that (a bench link pasted into this tab's address bar — a same-document
  navigation, so the app doesn't restart) restores again and switches to the hash's mode;
  `replaceState` never fires `hashchange`, so every such event is external by construction.
- Settings → "Part list" sets the order of the system headings in every `PartBrowser` (Library
  sidebar, start-a-bench, attach-to-slot). Default is catalogue order — `catalogue.yaml` is kept
  in the intended default order (Gridfinity, openGrid, GoPro, DeckMate, BitBeam, Basics, 2020
  Extrusion), so nothing here restates it. A saved order (`uiPrefs.js`, one JSON array) is
  resolved against the live catalogue by `catalogueUtils.js`'s `resolveSystemOrder()`: systems it
  does not name are appended in catalogue order, names that no longer exist are dropped. The lists
  read it through `useSystemOrder()` (a `useSyncExternalStore` over `uiPrefs.js`), so the sidebar
  behind the open dialog reorders as ▲/▼ are pressed; "Reset to catalogue order" removes the key.
  The same rows curate the list: a box per system and, folded under it, one per part
  (`uiPrefs.js`'s `{ systems, parts }` under one key, read live through `useHiddenLibrary()`).
  `catalogueUtils.js`'s `listedParts()` is the one filter every `PartBrowser` applies — catalogue
  `hidden` entries, hidden systems, hidden part ids — and nothing else consults it: the parts map
  the Bench, configs, and links resolve ids against is the full catalogue, so hiding a part never
  breaks a bench that uses it. A hidden system hides parts added to it later too (its part boxes
  are disabled while it's hidden, and untouched, so showing it again restores the per-part
  choices). Library's first-visit default is the first *listed* part, not `parts[0]`.
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
  node's id, to any depth, but at most `MAX_ATTACHED` (three) nodes in all: `addChild()` refuses a
  fourth, `benchConfig.js`'s checks reject a file or link carrying more, and the Bench stops
  offering markers and "+ Attach" buttons once a bench is full.
  `getNode()`/`childrenOf()`/`occupiedSlotNames()` all take that id the
  same way for root and any child, which is what lets `src/lib/benchLayout.js`'s `slotsForNode()`
  and `components/bench/NodeTree.jsx` treat every node identically regardless of depth.
- The "screwed" joint (`emitScrewedChild()`) is the one joint whose shape depends on the two parts:
  a generated `deckmate_screw_flange()` goes on whichever side has no screw holes of its own
  (catalogue `screw_pattern`), fused to that side's body, or on neither side when both carry the
  pattern. `jointsFor()` decides where the joint is offered (a node's dropdown), and the attach
  dialog narrows the part list to patterned parts when "screwed" is picked under a plain parent.
  A patterned part's `mount`/`bot` anchors sit at the pattern's reference point, not the box
  center — catalogue `mount_offset`, which `slots.js` applies to those two markers. The field is
  either a fixed `[x, y]` or, for an offset that depends on the part's parameters, a per-axis
  `{param, scale, unless}` that `slots.js`'s `mountOffset(part, params)` evaluates against the
  node's params over the catalogue defaults — the GoPro female's `mount` sits over its middle
  prong, `nut_depth / 2` off the plate's center, and back at the center when `symmetric` pads the
  other leg to match. `cli/foundry.py`'s `mount_offset()` is the same rule, and
  `tests/test_anchors.py` renders every variant of such a part to hold both to the geometry.
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
- Rotation is one number per node, `spin` (degrees, wrapped to `[0, 360)` by `normalizeSpin()`),
  emitted as BOSL2's `attach(..., spin=)` on the child's *own* attach call — the one naming
  `childAnchor` — and never on a flange's (`spinArg()`/`mateArgs()` in `assembly.js`). BOSL2 applies
  it as `rot(v=<parent anchor direction>, a=spin)` right after translating to the anchor, i.e. a
  turn in place about the mating axis, so the Bench can store a plain angle and hand it through.
  `updateChildSpin()` sets it, `rotateChild()` adds ±90 to it (the ↺/↻ buttons in
  `components/bench/SpinButtons.jsx`, used both floating over the scene and inline in `NodeTree`).
- The sideways shift is `shift` on a node (`[x, y]` mm, `normalizeShift()`/`updateChildShift()`),
  emitted as a `translate([x, y, 0])` between the child's `attach()` and its own module call
  (`shiftArg()`). `attach()` leaves its children in the slot's frame — translated to the anchor,
  spun, oriented, sunk by the overlap — so a translate there with z=0 slides the part across the
  mating face along the slot's own x/y, turned with the spin. `translate()` is transparent to
  BOSL2's special variables, so the child's `$attach_to` alignment and a `hide_this()`/`tag_this()`
  in front of it both still land on the part call. `benchLayout.js`'s `shiftWorldXY()` is the same
  displacement in world terms for an upward-facing slot (the slot's axes are world x/y and the
  spin a turn about z), used to move a stacked node's "bot" marker and, in `benchPick.js`, its box
  along with it; on a downward slot the box is padded by the magnitude instead, like the mount
  offset.
- The bench's name (`assembly.name`, `setAssemblyName()`/`benchName()`) is what its exports are
  called: `src/lib/benchName.js`'s `exportFilename(name, bodyTag, ext)` gives `<name>_<tag>.stl`,
  `<name>.scad`, `<name>.bench.json`, with `safeStem()` turning the characters a file system
  refuses into dashes. `Bench.jsx`'s `withName()` runs an export straight away when the bench is
  named and otherwise parks it (`pendingExport`) behind `components/bench/NameBenchModal.jsx`,
  which proposes `defaultBenchName()` — each distinct part in tree order, catalogue ids with the
  slash turned into a dash, imported meshes by file stem, joined with `_`
  (`gridfinity-base_gopro-female`) — and, on confirm, names the bench and lets the export go. The
  sidebar's Name field edits the same thing; it is kept as typed (trimming on every keystroke
  would eat the space between two words) and read trimmed everywhere.
- Selection is `Bench.jsx`'s `selectedNodeId` (never root). A click on the rendered mesh goes
  through `StlViewer`'s `onModelClick` (the hit point, or null for empty space; a drag isn't a click
  — `CLICK_SLOP_PX`) and `src/lib/benchPick.js` decides which part that point is on:
  `nodeWorldBoxes()` gives a world AABB per node that can be placed on the same footing as the
  markers (root, plus any catalogue part mated vertically — root's top grid, a `bot` stack, a ±Z
  imported anchor — footprint rotated by its spin, padded by `mount_offset`), and `pickNodeAt()`
  takes the smallest box containing the point, so the part sitting on top wins over the base it's
  on. Nodes without a box (imported, side-mounted) select from the sidebar only. The same box
  drives `StlViewer`'s `highlightBox` outline (a `Box3Helper`) and, via `boxTopCenter()`, the
  `overlayAnchor` the floating controls are pinned to — `StlViewer` re-projects that anchor every
  frame it draws and moves the overlay `<div>` with a transform, docking it at the bottom when there
  is no anchor.
- Moving a part is `assembly.js`'s `moveChild()`: a new `parentId`/`slotName` on the node, nothing
  else — its subtree comes along for free since every descendant is positioned relative to it. It
  hands the assembly back unchanged for anything that isn't a move (target taken, target on the
  node's own subtree, root), so callers don't pre-check. `Bench.jsx` wraps it in `moveNode()`, which
  also drops a "screwed" joint to fused when the new parent gives it no pattern to screw into. Two
  ways in: "Move" on the floating panel (or `M`) sets `moveMode`, and the next `onMarkerClick` is
  a destination instead of an attach (`handleMarkerClick()`); while armed, the markers shown are
  filtered to valid destinations (`shownMarkers` — the part's own open "bot" and its descendants'
  are left out). Arrow keys skip the arming: `nudgeSelected()` asks `benchLayout.js`'s
  `slotInDirection()` for the next open root slot in that direction — a 90° cone in root's own x/y
  frame, straightest-ahead first (so the next slot along a grid row, past any taken ones), nearest
  second — and only for a root child, since a stacked node's parent offers exactly one slot.
  Directions are root's axes, not the screen's; a camera-relative mapping would need `StlViewer`
  to expose its camera, which nothing else needs yet. Every selection change goes through
  `selectNode()` so an armed move never outlives the part it was armed for.
- Crop is one optional field on the assembly, `cropTo` (a node id, root included; `setCropTo()`,
  cleared by `removeChild()` when the node goes, carried by configs and the URL, dropped on load if
  it names a node the document doesn't have). `compileToScad()` then emits the tree *twice* inside
  an `intersection()`: the assembly as before, and a mask — `linear_extrude() fill() projection()
  show_only("crop")` around a second copy in which that one node's module call is prefixed
  `tag_this("crop")` and nothing else is. `fill()` (OpenSCAD 2024+, present in the WASM build)
  drops the holes from the shadow so only the outer outline crops — a BitBeam plate's grid must not
  be punched through the base under it. BOSL2 attachables keep positioning their children while
  hidden (the same fact the per-body `hide_this()` export relies on), so the tagged part lands
  exactly where the assembly puts it, and its shadow on world XY is the outline; `tag_this()`
  tags the one call only — the part's own geometry inherits it, its `attach()`'d children get the
  previous tag back — so neither a stacked part nor a joint's flanges are part of the outline. The
  mask copy is emitted with `ctx.plain`, i.e. no `if (part == …)` dispatch anywhere, so it is the
  same for every `-D part=` export (a `let(part = "all")` wrapper was tried and loses to `-D`,
  which made a single-body export come out empty). Every emitter now takes a `ctx`
  (`{ assembly, partsById, tagged, plain }`) instead of `(assembly, partsById)`. Safe because no
  part module in this repo, and none of the vendored libraries, use BOSL2 tags themselves.
- The Bench's keys are one `window` `keydown` listener for the component's lifetime that calls
  whatever handler the latest render left in `keyHandlerRef` (so it sees current state without
  re-subscribing per render): `Escape` backs out one layer at a time (import flow, attach picker,
  move mode, selection); `Delete`/`Backspace` removes the selected part, `M` toggles move mode,
  arrows nudge — all three only with no modal up and the key not aimed at a field
  (`src/lib/isEditableTarget.js`, the same check `App.jsx`'s shell shortcuts use).
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
  any node's marker the same way. A stacked node's open "bot" is also an "+ Attach on top" button
  on its row in the sidebar (`NodeTree.jsx`) — the same `attachAt(nodeId, "bot")` the marker
  click resolves to, reachable without aiming at a sphere (or with a keyboard). The
  rendered/exported geometry is unaffected either way, since that goes through real BOSL2, not
  this shortcut.
- A grid part attached from the picker is sized to the surface it lands on: `Bench.jsx`'s
  `attachChild()` asks `benchLayout.js`'s `slotFootprint()` how much of the parent's footprint is
  available centered on the chosen slot (the parent's extent minus twice the slot's offset — the
  whole part at the center slot, less at an off-center one so nothing overhangs) and
  `slots.js`'s `fitGridCounts()` turns that into the largest `count_params` that fit: a 5x5
  BitBeam plate on a single Gridfinity base, 3x3 on an openGrid snap, a 1x1 openGrid board on a
  Gridfinity base. Only `count_params` grids are fitted (nothing in the catalogue says which of a
  Basics plate's `w`/`d` are its footprint), only for a vertical mating slot (a top-grid `mount*`,
  a `bot`, or an imported anchor whose normal is near ±Z), and a count the user's saved default
  for that part pins is left alone.
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
  meant to be combinable. `bitbeam/plate` is the first part to actually use all three at
  once: its top grid and side rows both come from `side_slots.faces`' `enabled_param`/`count_param`
  pointing back at the part's own `side_holes`/`grid_y`-style params, so turning the side holes
  off or resizing the grid changes what's clickable in the Bench the same render it changes the
  geometry — see catalogue.yaml's `side_slots` schema comment for the field shapes.
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
- **STEP import** (`src/lib/stepMesh.js`, `src/lib/stepImport.js`, `src/worker/step-worker.js`):
  a STEP file (by `.step`/`.stp` extension, or by its `ISO-10303-21;` header whatever it is
  called) is B-rep, so it is tessellated first and only then joins the STL path below. The reader
  is `occt-import-js` — OpenCASCADE's STEP reader and mesher compiled to WebAssembly, the same
  OCCT `tools/refcache.py` drives through `cascadio` for `make verify` — running in its own Web
  Worker (`step-worker.js`) so a multi-second tessellation never blocks the UI. Unlike
  `openscad-wasm` it can be called repeatedly, so one instance is kept for the worker's life and
  the 7.6 MB `.wasm` (a separate Vite asset, found via `locateFile`) is fetched once, on the first
  STEP import, never at startup. Output is always in millimetres regardless of the file's declared
  unit (`linearUnit`); the deflections are `STEP_TESSELLATION` in `stepMesh.js` — 0.05 mm chord
  error, 0.2 rad angular — coarser than `refcache.py`'s metrology settings because here triangle
  count is Bench render time. `bodiesFromOcct()` turns each OCCT mesh (a STEP body) into the same
  non-indexed triangle soup `STLLoader` produces, with the body's own extents and triangle count.
  A file with one body goes straight to validation; with several, `ImportFlow` shows a body picker
  (`bodyLabels()` — the file's names, or "Body N", disambiguated when a name repeats) with "all
  bodies as one mesh" as the default, since the validate gate refuses more than one disconnected
  solid and an assembly file would otherwise just be rejected. Whichever is chosen,
  `geometryFromBodies()` is handed to the same `validateAndRepair()` as an STL, the part record
  gets the same `stlBytes`, and a config embeds the same STL — the STEP file itself is never kept.
  `stepImport.js` keeps the render worker's contract: requests matched by id, and a worker that
  dies rejects everything pending and is replaced on the next import.
- **3MF import** (`src/lib/threeMfMesh.js`): a 3MF (by `.3mf` extension, or by the zip signature any
  3MF starts with) is opened with three.js's `ThreeMFLoader` on the main thread — it is XML in a zip,
  no WebAssembly, and reads in milliseconds — which resolves components and build transforms into a
  Group of meshes. `bodiesFromGroup()` flattens that into the same bodies list a STEP file gives
  (one per mesh, in world space, named after the object), so a multi-object 3MF goes through the same
  body picker. The one thing the loader leaves out is the model's `unit`: it reads the attribute and
  never scales by it, so `modelUnitOf()` pulls it from the zip itself and `unitScale()` converts
  (inch → 25.4, centimeter → 10, …) before validation. Colours, materials and print-ticket data
  are dropped; a Bench part is one solid.
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

## Holes (`src/Holes.jsx`)

The third tab drills screw holes into a model: a catalogue part (its parameters under the
sidebar's "Part parameters" toggle, the same `ParamsEditor` as everywhere else; a mesh source gets
the toggle too, saying it has none), a mesh
imported as STL/STEP/3MF (`ImportFlow` in its `mode="mesh"`, which stops right after the validate gate;
`importedPart.js`'s `groundedMesh()` then re-centers it on the grid with its bottom at z = 0, since a
Holes source is imported raw rather than through the Bench's centering wrapper; its "Part parameters"
toggle offers one setting, **Flip upside down** — `groundedMesh()`'s `flip`, a half turn about X before
grounding, with `screwHoles.js`'s `flipHoles()` moving the holes already placed to the same spots on the
turned-over part),
or the current bench rendered as one mesh. See the root README's "Holes" section for what it does;
the implementation notes:

- The document (`src/lib/screwHoles.js`) is `{ source, holes, name, nextSpec, nextPresetId }`:
  `source` is `{ kind: "catalogue", partId, params }` or `{ kind: "mesh", name, stlBytes, extents }`;
  each hole is `{ id, point, normal, spec, presetId }`, the point *on the surface* in the model's
  own frame and the face's outward normal, so the hole is cut along `-normal`. `spec.kind` is
  `"screw"` (diameter, depth (0 = through), head (`none` / `counterbore` / `countersink` / `hex`),
  head diameter (across corners for hex), head depth (how far the pocket sinks; a countersink's
  extra sink on top of its cone) and sink angle), `"openconnect"` (lock side, side and depth
  clearance, spin) or `"multiconnect"` (channel length, on-ramp, detent, clearance, spin) — the
  slots carry only the choices upstream's geometry leaves open. `nextSpec` is what the next click drills — the sidebar's "New holes" editor
  edits it; with a hole selected the same editor edits that hole, and `nextSpec` follows along, so
  the screw picked or edited last is what the next holes get. It lives in
  `src/lib/holesSession.js` (module state, like `benchSession.js`) so a tab switch keeps it; it is
  not in the URL.
- `holesToScad()` emits `difference() { <base>; <one cutter per hole> }` — for a catalogue part the
  same `include` + module call the Library renders, for a mesh an `import()` of bytes mounted beside
  the file (the `importedFiles` contract `compileToScad()` uses). Each cutter is wrapped in a
  `multmatrix()` whose columns are an orthonormal frame with +Z along the hole's normal
  (`planeBasis()`, the same in-plane axes `faceCluster.js` picks), so every cutter is written once
  in a local frame where the surface is z = 0: the shank from `-depth` (or past the far side, for a
  through hole — the base's bounding-box diagonal) to 1 mm above the surface, a counterbore or hex
  pocket (`$fn = 6`) from `-headDepth` up, a countersink as a cone from the shank diameter out to
  the head diameter at the given angle under the sink. A connector slot is one call into the
  repo's own library instead — `oc_slot(...)` from `lib/openconnect.scad` (a wrapper over
  openGrid-projects' `openconnect_slot()`), `mc_slot(...)` from `lib/multiconnect.scad` — reached
  by a `use <../lib/…>` line the generated file carries only when a slot is on it, with the slit at
  z = 0 and the pocket below. Its in-plane axes are not arbitrary: `slotFrame()` makes the slot's
  +Y (the way the head travels to seat, "up" on the wall) the face's own up — the world's +Y
  projected onto the face, failing that +Z, failing that +X, so a slot on a plate lying flat runs
  along the plate's Y — turned by the spec's `spin` (degrees, counter-clockwise seen from outside
  the face). `flipHoles()` adds a half turn to a slot's spin, since the mesh flip sends the part's
  own Y the other way. The render goes through `renderPart()` as a
  `scadSource` request like a bench; with no holes the base is shown as it is (the part's own cached
  standalone render, or the mesh bytes) rather than compiled again.
- **Snapping** (`src/lib/snapCandidates.js`): the viewer reports raw hits (`StlViewer`'s
  `onSurfaceHit` / `onSurfaceHover`, the alternative to `onSurfacePick` for a caller that snaps
  itself) and `analyzeFace()` turns the hit triangle into the whole flat face around it via
  `faceCluster.js`'s flood fill (which now also returns the cluster's triangles), then chains the
  cluster's outline edges into loops. On a consistently wound mesh the outer loop runs CCW and hole
  loops CW, but the outline is picked by size so a mirrored mesh still has one. Loops are simplified
  to real corners (collinear runs merged); candidates are the face center, the center of each quadrant of
  the face's bounding box (four screws spread over a plate), the centroid of each hole loop (so a
  hole already in a catalogue part — a BitBeam plate's, a GoPro's — is a target, with its radius
  reported), and a point `inset` mm inside each corner, where a corner is the intersection of two
  consecutive long edges (longer than ~8% of the face) — so a filleted or chamfered plate gets the
  four points a sharp one would. Edge midpoints are not offered: a screw on the edge of a face is
  never where one goes. Quadrant centers and corner insets are kept only when they fall on the face
  and outside its holes. The face also carries **guide lines** (`face.guides`): its two center lines
  and four quarter lines, each clipped to the outline (`clipLine()` pairs a line's crossings with the
  polygon's edges into inside intervals, so a line that leaves an L-shaped face and comes back is two
  pieces). Where a center line crosses a quarter line is a snap point too (`intersection`), and a
  click near a line but near no point slides onto the line (`nearestGuide()`, rounded to the grid
  along it) — a hole anywhere along the center line, placed by eye but exactly centered. Two more
  kinds of guide: a **radial** from the center out through each corner inset to its corner, and the
  **center circle** — a bolt circle of the radius set in the sidebar ("Center radius", 0 for none,
  not drawn when wider than the face). Where the circle meets the center lines and the radials are
  snap points (`circle`), and a click near the circle slides onto it, rounded to whole degrees. The
  viewer draws them while the face is hovered (`StlViewer`'s `guides` prop: center lines solid,
  quarter lines and radials dashed, the circle as a 72-segment polyline, all lifted off the face),
  and a yellow marker follows the pointer along whichever guide it would snap to. The face the
  pointer last rested on keeps its lines and points after the pointer leaves the model
  (`guideFaceKey`, re-analysed with the current inset and radius — `analyzeFace()` hands back a
  fresh record when the settings change, so the memos redraw), so the two settings can be adjusted
  with the result in view. Another face takes the lines over only after the pointer has rested on it
  for a third of a second (`GUIDE_SWITCH_DELAY_MS`), or at once on a click, so a face crossed on the
  way to the sidebar doesn't take them with it; a re-render of the mesh clears it, since the
  triangles it is keyed on are renumbered. **Measurements:** with Option (Alt) held, the point the
  pointer is on — snapped, or on a line, or on the grid — gets its distances to the guide face's
  outline in the four directions of the face's frame and to its center (`edgeDistances()`: the
  outline crossings of the two axis lines through the point, outer loop only), drawn as bright
  dimension lines through `guides` and labelled through `StlViewer`'s new `labels` prop (texts
  re-projected every frame like the overlay); the face's size sits at its center. With the pointer
  off the model the selected hole is measured instead, when it lies on the guide face. Option-click
  used to mean free placement; that moved to Shift so a measured snap point can be clicked as
  snapped. Everything is
  cached per geometry (face by its lowest triangle index, every triangle mapped to it), so hovering
  across a face is a lookup. With snapping on, a click within `snapRadius` (4% of the model's
  largest extent, at least 1.5 mm) of a candidate takes it; otherwise the click rounds to a 0.5 mm
  grid in the face's own frame; Shift-click (or snapping off) uses the exact point. The analysed mesh
  is a welded copy (`mergeVertices` on positions only — the display geometry keeps the file's flat
  normals) in the same triangle order, so the viewer's `faceIndex` indexes it directly. Because it
  is the *rendered* mesh that is analysed, holes already drilled are themselves snap targets, and a
  click on one selects it instead of drilling through it (`placeAt()`).
- Markers: holes are flat rings (`StlViewer` `shape: "ring"` markers, oriented by the hole's
  normal and lifted 0.08 mm off the surface; `holeFootprintRadius()` sizes them — a slot's ring is
  its channel's half width), the hovered face's snap points small spheres, the one
  within reach and the selected hole in the selection yellow. A slot also gets its outline drawn
  through the `guides` prop (`slotOutline()`: the channel and pocket or round end, the entry
  dashed, and an arrow the way the head travels), since a ring says nothing about which way it
  points. Markers now take a `color`, and the
  viewer keeps the camera where it is when a new model has the same bounding sphere as the last —
  a hole drilled into a plate (or a Bench part turned in place) no longer resets the view.
- `src/lib/screwPresets.js` holds the fastener presets — ISO 4762 socket caps, ISO 10642
  countersunk, ISO 7380 button heads, heat-set inserts, thread-forming core holes, ISO 4032 nut
  traps, wood screws and their pilots, a plain hole and a dowel — each with the `spec` it cuts and
  a `screw` record (`style`, nominal, head diameter/height) that `components/holes/ScrewIcon.jsx`
  draws as a cross-section: the slab, the cut, the fastener seated in it, to the preset's own
  proportions — and the two connector groups (openConnect: lock left / both / none; MultiConnect:
  with on-ramp / open-ended / quick release), drawn as the keyhole section with the head seated in
  it on its snap, depths four times over since a 2.8 mm slot at its width's scale would be a
  hairline. A hole remembers the preset it was placed from and says "(edited)" once its spec
  differs (`specMatchesPreset()`).
- Keys: `3` switches here (App.jsx); inside the tab `Delete`/`Backspace` removes the selected hole
  and `Escape` deselects (or closes the import), same local-listener arrangement as the Bench.
  Exports are `<name>_holes.stl` / `<name>_holes.scad` via `benchName.js`'s `exportFilename()`,
  the name being the sidebar's field or the source's own stem (a mesh's file name minus its
  extension).

## Bench configs and presets (`src/lib/benchConfig.js`, `src/lib/benchPresets.js`)

A bench setup as a document — the Bench's "Download config" / "Import config…" buttons and its
"Presets" list are all one serialisation with two destinations (a file, or a named entry in
localStorage), so a preset can always become a file and a file a preset with no conversion.

- **Format**: JSON, `{ format: "connector-foundry/bench", version: 1, root, nodes, imports }`.
  `root` and `nodes` are `assembly.js`'s own shape (`partId`, `params`, `parentId`, `slotName`,
  `joint`, `childAnchor`, `overlap`, `spin`, and `shift` when there is one) rather than a second
  schema to keep in step. `name` is the bench's own name (`assembly.name`) — or the preset's, when
  saving one — and loading a document makes it the bench's. `imports` carries every imported STL
  the tree references — name, the user-placed anchors, and the validated mesh bytes
  base64-encoded — so the file is self-contained: a config that merely *named* an upload would be
  unloadable in any other browser. Files are named `<bench-name>.bench.json`, like every other
  export (see `src/lib/benchName.js` below); `version` is bumped on any incompatible change and an
  unknown version is refused with a message, not guessed at.
- **Loading is a checked hydration, not a `JSON.parse` into state** (`hydrateBenchConfig()`):
  the format tag, every field's shape, every part id against the live catalogue, every joint
  name, and every `parentId` (resolved parents-first, so node order in the file doesn't matter and
  an orphan or cycle is an error). Node ids and import ids are re-issued through the session's own
  allocators (`assembly.js`'s `allocateChildId()`, `importedPart.js`'s counter) — ids double as
  body tags and marker ids, so a loaded `c1` must not collide with the next part attached. Each
  imported mesh is rebuilt through the same `validateAndRepair()` gate an upload takes; the bytes
  are the repaired mesh `createImportedPart()` exported, so they pass, and the recomputed center is
  the frame the saved anchors are relative to. Nothing in Bench state changes unless the whole
  document hydrates, so a bad file leaves the current bench untouched. Slot *names* are the one
  thing not checked: which slots a part has depends on its rendered size and params (`slots.js`),
  so a stale one shows up as a render error, the same way a bad parameter does.
- **Presets** (`benchPresets.js`): one localStorage key holding `[{ name, savedAt, config }]`,
  sorted by name, case-insensitive replace on an existing name. Read through
  `useBenchPresets()` (a `useSyncExternalStore`, same pattern as the system order) so the start
  screen's list and the sidebar's agree the moment one is saved or deleted. Reads are best-effort
  like every other storage access here, but a *write* can fail for a reason the user needs to
  hear — an embedded mesh can push the document past the origin's ~5 MB quota — so `savePreset()`
  returns a message instead of failing silently, and the panel suggests the file export, which has
  no such limit.
- **UI** (`components/bench/PresetsPanel.jsx`): the same panel in two places. On the start screen
  the saved presets sit above the part picker (only once there are any, or a config import has an
  error to show) and "Import config…" is in the picker's toolbar beside "Import STL / STEP / 3MF…"
  (`ConfigImportButton`, a button fronting a hidden file input); in a running bench's sidebar the
  panel also has the name field + Save (reads "Replace" when the name is taken) and its own import
  button, and "Download config" joins the STL/.scad buttons under Export. Loading over an existing
  bench and deleting a preset each ask first via `window.confirm` — the only two places the app
  uses it.

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
  `FIT_CLEARANCE` — Gridfinity/GoPro/openGrid and the 2020 rail wrap a vendored module with its
  own geometry and won't move.

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

## Verification

```bash
npm test                       # render scheduler unit tests (Node.js 20+)
npx playwright install chromium
npm run test:browser            # builds and tests the production app in Chromium
```

The browser suite covers stale-download prevention, printer-setting changes,
worker recovery and cancellation, export preservation during edits, Bench tab/URL
restoration, and the existing config round trip with an embedded mesh. Most UI
cases use a controllable worker to exercise delays and failures deterministically.
A separate real `openscad-wasm` test checks the dimensions of Library and generated
Bench STL exports. CI runs both suites and retains browser traces on failure.

Render requests queue on the main thread, with only one job sent to the worker at
a time. Library and Bench previews subscribe with an `AbortSignal`; edits and
unmounting remove obsolete subscriptions. A job is interrupted only when nobody
still needs it, so explicit STL exports survive preview changes. **Cancel renders**
stops all current work, including exports. A two-minute per-job timeout replaces a
stuck worker and continues queued jobs; failed results are never cached. Bench
shows **Retry preview** after cancellation or a failure.

Library downloads require a successful render matching the selected part,
parameters, and printer overrides. An older mesh may remain visible while editing
or rendering, with downloading disabled until the current render succeeds.

The future plan for complete OpenSCAD exports is recorded in
[docs/IMPROVEMENTS.md](../docs/IMPROVEMENTS.md).
