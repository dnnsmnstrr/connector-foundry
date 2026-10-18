# Connector Foundry — web

Browser picker for the catalogue: choose a part, tweak its parameters, and export an STL —
entirely client-side. It compiles the *same* `.scad` sources under `parts/` and `lib/` that the
CLI uses, via [`openscad-wasm`](https://www.npmjs.com/package/openscad-wasm) (Manifold backend)
running in a Web Worker.

## How it works

1. `npm run sync-scad` (runs automatically before `dev`/`build`) bundles every `.scad` file the
   parts reach into — `lib`, `parts`, `assemblies` (`ROOT_DIRS` in `scripts/sync-scad.mjs`), plus
   whatever those `include`/`use`, followed transitively into the vendored upstreams — into
   `public/scad-bundle.json`,
   and parses `catalogue.yaml` into `public/catalogue.json`. It also copies each part's gallery render
   (`docs/img/`, made by `foundry preview`) into `public/thumbnails/` for the command palette's
   part rows, and gives that part a `thumbnail` path in `catalogue.json` — a field the build
   derives, not a `catalogue.yaml` field, so the CLI and the schema test never see it. This is the only "build step" that touches the
   OpenSCAD sources — the app never transpiles or reimplements them.
   An included file that does not exist (a submodule that was never checked out) fails the
   sync — and so `dev`, `build` and CI — naming the files, since the symptom in the browser is
   otherwise just an unhelpful "can't open include" on the parts that need it, in a build that
   looked green. `SYNC_SCAD_ALLOW_MISSING=1` downgrades it to a warning; the dev server's file
   watcher only ever warns.
   A binary a part `import()`s (the `parts/deckmate/*.stl` meshes) rides along base64-encoded
   under the bundle's `assets` key and is mounted at the same repo-relative path, so the part's
   relative `import()` resolves in the browser exactly as it does on disk.
2. `src/hooks/useCatalogue.js` reads `catalogue.json` (the parsed `catalogue.yaml`) for the part list, default parameters, and
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

**Warm-up.** A fresh worker has to load its 13.8 MB script, fetch and decode the source bundle
and compile the WebAssembly module before it can render anything: in headless Chromium a render
posted to a fresh worker took 1040–1210 ms, the same render posted to a warmed one 495–600 ms.
So `openscad-client.js`'s `warmRenderer()` starts a worker and sends it `{ type: "warm" }` when
none exists and nothing is pending — once at boot (`main.jsx`, through `requestIdleCallback`
after the first paint, or a 1.5 s timeout where there is none, i.e. Safari; not from a
component, where StrictMode would run it twice, and not at import, which would leak a timer into
every unit test), and again after a stop that interrupted a render: an abort of the active job
that nobody needs any more, or the two-minute timeout. That second warm-up is queued as a
microtask, so a job still waiting gets the fresh worker from `pump()` first and the warm-up then
finds a worker and does nothing; through the real client, 100–1000 ms of idle after an abort
saved 119–545 ms of the next render, and one posted with no gap (a handle commit) costs nothing
measurable. Never after a worker failure (`fail()`: a worker that cannot load at all — an old
tab's hashed worker file gone after a deploy, a CSP block — would respawn in a loop) and never
after **Cancel renders**. The worker takes the warm message through the same FIFO as renders,
since two `createOpenSCAD()` calls at once corrupt shared state; `warmOnce()` loads the bundle,
creates and drops one instance (no `callMain`: a warm-up that ran `cube(1)` did not speed up the
next render) unless a render is already waiting for it, swallows every error, and answers
nothing. A warm-up is not a job — no id, no deadline, not in `inFlight` — so
`getRenderActivity()` never counts it, and the fake Workers in the unit and browser tests never
answer it (the unit tests' one keeps it apart from the renders, to count it).
An idle warmed worker holds a little less memory than the one every session that has rendered
keeps anyway (in Node, about 170 MB against 199 MB).

**Known limit — nesting depth.** This `openscad-wasm` build runs out of thread stack about 70
nested module levels down: a chain of 69 BOSL2 attachables renders, 70 traps, with the symptom
varying by what the overflow lands on (`memory access out of bounds`, `table index out of bounds`,
`original is not a function`). Measured on 2026-10-06 in Chrome's worker and in Node alike, with
`$parent_modules` echoed from an instrumented BOSL2 `attachable()` to count the levels. It is the
one cause behind every Bench render failure the READMEs blame on bolted/snap/pin joints
(`src/lib/assembly.js`'s `emitJointChild()`, `src/lib/renderError.js`'s `friendlyRenderError()`): each
`attach()` / joint flange / rounded cuboid adds levels, and the deep parts (openGrid's snap, the
openConnect and MultiConnect snaps) start near the limit — `lib/opengrid.scad`'s header says what
was done so those two render here at all (65 levels), and why they will not survive being a
Bench child. Their `body: screw` and the Holes tab's openGrid thread go through
`lib/ogthread.scad`, which rewrites upstream's thread for the same reason (upstream's screw is 94
levels deep; this one 52, the thread cutter alone 41). There is no knob for it: the stack size is fixed when the WASM is linked, and no
newer `openscad-wasm` exists on npm.

If the worker itself dies (a script error, a message that can't be deserialised), every render
waiting on it is rejected with a message saying so and the worker is discarded, so the next
render starts a fresh one — a request whose worker is gone would otherwise hang forever.

## The website: landing page, app and guides

The build has three kinds of page, all from this one Vite project (a multi-page build,
`appType: "mpa"`, so a mistyped path is a 404 rather than the landing page):

| Path | Page | Source |
| --- | --- | --- |
| `/` | The landing page | `index.html`, `src/site/landing.js` |
| `/app/` | The app | `app/index.html`, `src/main.jsx` |
| `/docs/`, `/docs/<guide>/` | The guides | the repository's `docs/*.md`, rendered by `scripts/build-docs.mjs` |

On GitHub Pages all three sit under `/connector-foundry/`. The app lived at the root until the
landing page took it, so `index.html` forwards any URL whose hash carries app state (a `=` in it:
`#mode=bench&bench=…`) to `app/` before anything paints — old bench links and bookmarks still open
the app. The desktop shell never shows the landing page: `desktop/paths.cjs` serves
`app/index.html` at `foundry://app/`, so its URL and every bench link written into it are as
before.

`scripts/vite-plugin-site.mjs` ties the pages together:

- It renders the guides (`build-docs.mjs`) whenever Vite starts, and again under `npm run dev`
  when one changes. Which guides are published, under what name and in what order is
  `DOC_GROUPS` in that script; the rest of `docs/` (packaging notes, deferred work) is linked on
  GitHub. A link between published guides points at the website's page, any other relative link
  at the file on GitHub, and headings get GitHub's ids, so a `#fragment` works on both. The
  generated `docs/` folder here is ignored by Git, like `public/`.
- It puts the shared header and footer (`src/site/partials/`) into every page that has
  `<!-- site:header -->` / `<!-- site:footer -->`, and fills `{{base}}` and `{{repo}}` in links
  (Vite rewrites asset URLs for the Pages base, but not `<a href>`).
- It fills the landing page's catalogue placeholders — the parts gallery, the system list, the
  counts, the version — from `public/catalogue.json` at build time, so the page lists exactly the
  parts the app does, with links that open each on the Bench (`benchUrlState.js`'s own
  `encodeTree()`). The same facts reach the page's scripts as `virtual:site-data` (typed in
  `src/site/site-data.d.ts`).

The landing page's demos run the app's own code rather than imitations of it: the Library demo
drives a real catalogue entry through `lib/resize.js` (its handles, snapping, bounds and drag
label are the Library's; only the render is pretend), and the palette demo ranks
`commandCatalog.js`'s commands with `commands.js`. The hero's 3D view shows real parts: four
pairs (`src/site/heroPairs.js`), each a base part with a part from another system attached to its
`"mount"` slot, rendered by `scripts/hero-parts.mjs` through openscad-wasm in Node into
`src/site/assets/hero-parts.bin` (about 60 KB; `src/site/heroMeshes.js` has the format). That file
is committed, like the gallery renders in `docs/img/`: after changing a hero part or the pair
list, run `npm run sync-scad && node scripts/hero-parts.mjs` (a unit test fails until you do).
three.js and the meshes load once the page is idle; without WebGL the page shows the parts'
gallery renders instead. Every demo starts only when it scrolls near, stops looping off screen,
and stays still under `prefers-reduced-motion`.

## Module layout

Shared UI pieces live in `src/components/`; everything with no React in it lives in `src/lib/`.

| Module | What |
| --- | --- |
| `src/App.jsx` | Shell: nav, mode switch, Settings, the keyboard-shortcuts sheet, the command palette and the shell's commands, the shared sidebar preference (its width written onto the layout by `ShellBody`) |
| `src/lib/commands.js` | The command palette's model, pure and Node-tested: what a command and a page are, the registry every source adds a getter to (`createCommandRegistry()`, the app's `commandRegistry`), and the ranking — word by word, prefix > initials ("oib") > word start > substring > scattered letters, the title over keywords, an exact alias first, recent commands only breaking ties (`rankCommands()`, `browseSections()`, `matchRanges()`) |
| `src/lib/commandCatalog.js` | The built-in commands' titles, sections, search keywords and key hints, as data (`BUILTIN_COMMANDS`; `builtin(id, binding)` binds behaviour to an id and tsc checks the id), the section order, `partCommand()` for a part's row, the repository and Layerling links and `linkActions()` (open, copy); a unit test holds every key hint to a row of the shortcuts sheet |
| `src/lib/commandHud.js` | "Link copied" and the like: one short message at a time, shown for a moment by App's `CommandHud` (a polite live region) after the palette has closed |
| `src/components/CommandPalette.jsx` | The palette (Mod+K) and the Bench's and Holes' part pickers: a native `<dialog>` near the top of the window, its search, sections, key hints, nested pages and an Actions page per command (see the Shell section) |
| `src/hooks/useCommands.js` | `useCommands(source, build)`: a component offers commands while mounted, its latest `build` called only when an open palette collects; `useCommandHome()`, what Mod+K opens on an empty tab (its own picker); `usePaletteShortcut()`, the Mod+K listener |
| `src/lib/hotkeys.js` | User hotkeys: `parseChord()` (Mod plus Shift or Alt plus a letter or digit), `chordOf()` a keydown (falling back to `e.code` where Option or Shift changes `e.key`), and `hotkeyProblem()` against the app's, the desktop menu's and the browser's chords (`RESERVED_CHORDS`) |
| `src/lib/userCommands.js`, `hooks/useUserCommands.js` | The user's own commands and their aliases and hotkeys for built-in ones — a validated store (`checkUserCommands()`, entry by entry), the action kinds (`ACTION_KINDS`: open a part with parameters in a tab, a bench preset, a hole type, a link, a tab, a built-in command), and the hook that lists them, puts the bindings on the registry and listens for the hotkeys; App.jsx runs each kind. No editor yet (see the Shell section) |
| `src/hooks/useRenderActivity.js`, `components/RenderActivity.jsx` | How many OpenSCAD renders are in flight app-wide (subscribes to `openscad-client.js`'s `inFlight` map), and the nav's "Rendering…" status and **Cancel renders** button built on it — a component of its own, so a render starting or finishing re-renders those two elements rather than App and the whole active mode |
| `src/lib/shortcuts.js`, `components/ShortcutsModal.jsx` | The keyboard-shortcuts sheet (`?`): every key, pointer gesture and the mouse/touch map as one table, with each platform's modifier names, checked by a unit test — a change to a key is a change to its row here |
| `src/lib/isEditableTarget.js` | The shortcut guards: `ignoresShortcut()` for single keys, `undoShortcut()` / `ignoresUndoShortcut()` for Cmd/Ctrl+Z, `pickerUndoKey()` for a part picker's search, `paletteShortcut()` for Mod+K and `ignoresHotkey()` for a user's hotkeys (see the Shell section) |
| `src/lib/history.js` | The undo/redo engine behind all three tabs: a stack of immutable snapshots, coalescing by key (a run of keystrokes in one field is one step), and a cached state for `useSyncExternalStore` |
| `src/lib/librarySession.js`, `hooks/useLibraryHistory.js`, `useBenchHistory.js`, `useHolesHistory.js` | The Library's undo history as module state (the Library unmounts on every mode switch; the Bench's and Holes' histories live in their own sessions), and each tab's history state — can undo, can redo, the steps' labels — for its buttons |
| `src/hooks/useUndoShortcuts.js`, `components/UndoRedoButtons.jsx` | Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y for the mounted tab (a part picker's search hands them to its tab itself, see the Shell section); the Undo/Redo icon pair every viewer toolbar and the empty Bench and Holes tabs show, its tooltip naming the step ("Undo resize W (⌘Z)") |
| `src/hooks/useSystemOrder.js`, `useHiddenLibrary.js` | The saved system-heading order and the hidden systems/parts, live (both subscribe to `uiPrefs.js`) so every part list reorders and thins out as Settings changes them |
| `src/Library.jsx`, `src/Bench.jsx`, `src/Holes.jsx` | The three modes — see the sections below |
| `src/hooks/useRender.js` | The preview render all three modes share: give it a key (a memoised object of the inputs, or null for nothing) and a `run(key, signal)`; it debounces, cancels the render for a replaced key through its `AbortSignal`, drops results that land after their key was replaced, and returns `{ result, key, status, error, setError, retry }` — `key` being the request the shown result came from, so a caller can tell a stale mesh from the current one (Library's download button, Holes' surface clicks) |
| `src/lib/renderError.js` | `friendlyRenderError()`: the WASM stack-limit symptoms (`WASM_STACK_SYMPTOMS`, see "Known limit — nesting depth") turned into a message saying what to change |
| `src/components/PartBrowser.jsx` | Search box + grouped part list, the Library's sidebar (the Bench's and Holes' pickers are command palette pages built from the same `catalogueUtils.js`'s `partSections()`); headings follow the order set in Settings. Lists `catalogueUtils.js`'s `listedParts()`: the catalogue minus entries marked `hidden` (bitbeam/pin, bitbeam/axle) and minus what the user hid in Settings — all of which stay in the parts map for lookups by id |
| `src/components/ParamsEditor.jsx` | One part's parameter fields plus reset / save-as-default / clear, used by Library and every Bench node |
| `src/components/StlViewer.jsx` | The three.js viewer every mode uses: the model, markers, guides, labels, the floating overlay, the resize handles and their ghost, the toolbar and the camera — see "3D viewer" below |
| `src/lib/viewerCamera.js` | The viewer's camera maths, pure and Node-tested: the Home/Top/Front/Right views, Fit, the `fitKey` re-fit policy, where a handle's grab target goes on screen, and how far the camera backs out to keep handles in reach |
| `src/lib/resize.js` | Resize handles for catalogue parts (Library, the Bench root): catalogue `resize` → axes and bounds, handles on a box, a drag / typed size / arrow step → the new parameters and the predicted box, the ghost's edges and label, ready-made handles for the viewer (mirrored by `tests/conftest.py`, see "3D viewer") |
| `src/lib/dragMath.js` | Where the pointer's ray meets a handle's line or plane, the 15° edge-on guard, and the screen-space fallback for a drag that goes edge-on |
| `src/components/Modal.jsx`, `SettingsModal.jsx`, `InfoTip.jsx`, `ParamField.jsx`, `SidebarToggle.jsx`, `FileDropzone.jsx` | The rest of the shared UI; `InfoTip` is the "?" beside a label whose detail shows on hover or keyboard focus (the Settings dialog keeps its labels short and puts the rest there); `FileDropzone` is the STL/STEP/3MF picker — a dashed drop target with the real file input stretched invisibly over it, so a click opens the chooser natively and a dropped file goes to the same handler (`hooks/useFileDrop.js`, shared with the command palette and the empty Bench and Holes tabs) |
| `src/components/bench/` | Bench-only: `ImportFlow` (STL/STEP/3MF upload, body picker, slot placement), `NodeTree` (the "Attached" tree), `PresetsPanel` (saved setups + config import), `JointSelect` |
| `src/lib/assembly.js` | The Bench's tree model and `.scad` codegen |
| `src/lib/benchResize.js` | The Bench root's resize handles (`resize.js` does the sizes): the children guard that never takes a slot from an attached part, the ghost, and whether a node's measured extents still belong to its parameters |
| `src/components/holes/` | Holes-only: `ScrewIcon` (a preset as a cross-section SVG — a screw in its hole, or a connector head seated in its slot), `PresetPicker` (the grouped icon grid), `HoleSpecFields` (diameter / depth / head pocket fields, or a slot's lock side, clearances, channel length and direction), `HoleRow` (one row of the hole list), `GridField` (the Snapping section's Grid select) |
| `src/lib/holeHandles.js` | The Holes tab's handles on the selected hole: a cutout resized from the opposite edge (Alt: from the centre), the move handle, the arrow-key nudge, the "still on its face?" check, the selection pill's anchor |
| `src/lib/holesRender.js`, `holesOverlay.js` | The Holes tab's render requests (the base alone, the base with its holes cut, the grounded mesh source), `cachedHoled()` (all of that straight from the render cache, so an undo shows with no render), the surface probe a moved hole is checked against, and what it draws over the model (hole rings, snap points, guide lines, the Option-held measurements) |
| `src/lib/screwHoles.js`, `screwPresets.js`, `snapCandidates.js`, `holesSession.js`, `hooks/useHolesSession.js` | The Holes tab: its document and `difference()` codegen (screw holes; openConnect / MultiConnect slots cut by `lib/openconnect.scad` and `lib/multiconnect.scad`; round and rectangular / pill cutouts; 2020 extrusion sockets cut by `lib/exsocket.scad`; BitBeam pin holes cut by `lib/pinhole.scad`; KLIPPT channels cut by `lib/klippt.scad`; DeckMate sockets cut by `lib/deckmate.scad`); the fastener, slot, shape and socket presets; the Repeat form's row / grid / circle patterns (`repeatHole()`, which places only the copies the caller's mesh probe accepts); the face-feature snap points; the live document as module state, with its undo history |
| `src/lib/benchConfig.js`, `benchPresets.js`, `hooks/useBenchPresets.js` | A bench setup as a file (serialise / check / hydrate), and the localStorage-backed named list of those documents |
| `src/lib/benchSession.js`, `benchUrlState.js`, `hooks/useBenchSession.js` | The live bench as module state (outlives the Bench component) with its undo history, and its mirror in the URL hash + sessionStorage so a reload restores it |
| `src/lib/benchLayout.js` | Which slots a node still offers, and where each 3D marker goes |
| `src/lib/benchOrientation.js` | The rotation BOSL2's `attach()` gives each node, chained from the root, and `uprightSpin()`: the starting spin that turns a part's `attached_up` axis up on a side face |
| `src/lib/slots.js` | Slot enumeration for a catalogue part (mirror of `lib/slots.scad`) |
| `src/lib/importedPart.js`, `meshValidate.js`, `faceCluster.js`, `meshTopology.js` | STL/STEP/3MF import: the part record, the validate/repair gate, face-center snapping, and the edge/adjacency builders those two share |
| `src/lib/stepMesh.js`, `stepImport.js`, `src/worker/step-worker.js` | STEP import: file detection, tessellation settings and body/geometry conversion (pure, Node-testable); the promise wrapper; OpenCASCADE WASM (`occt-import-js`) in its own worker |
| `src/lib/threeMfMesh.js` | 3MF import: detection, the file's unit (read from the zip, since three.js's `ThreeMFLoader` parses it but never applies it), and the loader's Group flattened into the same bodies a STEP tessellates to, scaled to millimetres |
| `src/lib/openscad-client.js`, `src/worker/openscad-worker.js` | The render pipeline: promise wrapper + cache + the worker warm-up (`warmRenderer()`) on the main thread, OpenSCAD WASM in the worker |
| `src/lib/scadLiteral.js` | The one OpenSCAD-literal formatter (codegen and worker both use it; mirrors `cli/foundry.py`'s `openscad_value()`) |
| `src/lib/userOverrides.js`, `uiPrefs.js` | localStorage-backed state: saved parameter overrides (and `resolveParams()` / `resolveAttachedParams()`, the catalogue-default → saved-override → instance merge, the latter with the catalogue's `attached_defaults` for a part the Bench attaches to another); sidebar collapsed, "Bench follows Library", system-heading order, hidden systems and parts, the sidebar's width (`hooks/useSidebarWidth.js` reads it live), the Grid that resize drags, handle and nudge steps and Holes placements snap to (`hooks/useGridSnap.js`; Off, 0.1–5 mm, default 0.5), the command palette's recent commands |
| `src/lib/meshExtents.js`, `download.js`, `publicAsset.js`, `catalogueUtils.js` | Small helpers: memoised STL bounding boxes (`meshBounds()`'s min and max — the box resize handles stand on — and `meshExtents()`'s size; binary STL read straight off a `DataView`), "save this file", fetching the generated `public/` assets, grouping/search/slugs and the system-order resolution |
| `index.html`, `src/site/landing.js`, `landing.css`, `site.css`, `common.js`, `partials/` | The website's landing page (see "The website" above): the hero's headline and pager, scroll-in, the gallery filter, the platform detection behind the download buttons; the styles every page of the site shares, and its header and footer |
| `src/site/hero.js`, `heroPairs.js`, `heroMeshes.js`, `assets/hero-parts.bin` | The hero's 3D view: the pairs, their meshes packed small (indexed, 16-bit), and the scene that drops each attached part onto its base's slot marker, turns the pair and follows the drag |
| `src/site/demos/` | The landing page's demos: `resize.js` (lib/resize.js on an isometric bin), `joints.js` (the five joints as cut-aways), `holes.js` (a plate's snap points and hole presets), `palette.js` (the app's commands, ranked by lib/commands.js), `terminal.js`, `gallery.js` |
| `src/site/docs.js`, `docs.css`, `scripts/build-docs.mjs` | The guides: Markdown from `../docs/` to pages with a guide list, "On this page" and previous/next; copy buttons and the list that follows the reader |
| `scripts/vite-plugin-site.mjs`, `scripts/hero-parts.mjs` | The pages as build inputs, the shared header and footer, the landing page's catalogue placeholders and `virtual:site-data`; rendering the hero's parts |

## Shell (`src/App.jsx`)

The nav bar, Settings modal, and the shared "sidebar collapsed?" preference both Library's and the
Bench's own `<aside>` read — these live at the `App` level since they're not specific to either
screen.

- Keyboard shortcuts: `1`/`2`/`3` switch Library/Bench/Holes, `s` opens Settings, `[` toggles the sidebar,
  `/` jumps to the Library's part search (switching mode and opening the sidebar as needed),
  `?` opens the shortcuts sheet (below), `Escape` closes Settings or the sheet; Mod+K (Cmd on a
  Mac, Ctrl elsewhere) is the command palette's, through a listener of its own (below). One `keydown`
  listener (`App`'s own `useEffect`, which ignores key repeats) handles all of these;
  `h` (the 3D viewer's "Helpers" button: hide the grid, markers, guides, labels and handles to see
  just the model) and `f` (Fit) are `StlViewer`'s own, since they act on that viewer's state;
  `isEditableTarget()` (`src/lib/isEditableTarget.js`, shared with the Bench's own keys) skips every
  single-key shortcut (not `Escape`, which is expected to work
  from inside a focused field the same way a native `<dialog>` does) whenever the event's target is
  a text input, `<select>`, or anything `contentEditable` — so typing "s" in the search box types
  an "s", it doesn't open Settings. The Bench's own dialogs (the STL/STEP import, the name asked
  before an export) close on `Escape` too, but that's a second, local listener in `Bench.jsx` —
  that state is local to Bench, so App doesn't need to reach into it. `src/components/Modal.jsx` is a native `<dialog>` opened
  with `showModal()`, so the browser also fires its own `cancel` on Escape (routed to the same
  `onClose`), keeps Tab inside the dialog, makes the page behind it inert, and returns focus to
  the opener on close; the `title` prop is what the dialog is `aria-labelledby`.
- **The shortcuts sheet.** `?` (or Keyboard shortcuts at the top right of Settings, which the
  sheet replaces, or the command palette) opens "Keyboard shortcuts"
  (`components/ShortcutsModal.jsx`); `?` again or `Escape` closes it. A search box beside its
  title has the focus and narrows it to the rows with every word typed — in their text, their keys as
  shown or by name ("alt" finds ⌥ Option on a Mac), or their section — with
  `shortcuts.js`'s `filterShortcutSections()`; typed into, `?` is a character there and `Escape`
  clears the search before it closes the sheet. Everything on it comes from
  one table, `src/lib/shortcuts.js` — the shell's keys, the Bench's and Holes' selection keys,
  the viewer's keys and handles, undo, and the mouse, trackpad and touch map — so a change to
  any listener is a change to its row there; its unit test checks every token has a label on
  both platforms and that the main keys are present. "Mod" is Cmd on a Mac and Ctrl elsewhere,
  decided by the same `isMacPlatform()` the undo keys use, so the sheet never names a key the
  listener ignores. `?` and `/` share a key on a US layout and are told apart by `e.key`, which
  is the character typed on every layout. The sheet has no button of its own in the nav: it
  pushed the Settings gear off a phone's edge while a render ran, and Settings, the palette and
  the key reach it everywhere.
  TinkerCAD's own single-letter keys are not copied: `h`, `s` and `m` keep this app's meanings
  (Helpers, Settings, the Bench's Move).
- **The command palette** (`components/CommandPalette.jsx`, Mod+K or the nav's Search button).
  Everything the app does, in one searchable list: the tabs, Settings and its quick settings
  (Grid step, Circle detail), help and links, every part (search-only: typed, not listed), and
  whatever the mounted tab and its 3D view offer — the Library's downloads, the Bench's attach,
  move, crop and exports, the Holes tab's 78 hole types, the views. Each source offers its own
  through `hooks/useCommands.js` where its state lives, so a command's closures are that
  component's current handlers and a tab that isn't mounted has none; the getter runs only when
  an open palette collects, never on a render. Built-in commands take their title, section,
  keywords and key hint from `lib/commandCatalog.js` by id, so the hints are held to the
  shortcuts sheet by a unit test. What is typed is ranked by `lib/commands.js` (every word must
  match; prefix, then initials — "oib" is Open in Bench — then word starts, substrings and
  scattered letters; an exact alias first); with nothing typed, the last commands run come first
  (`uiPrefs.js`'s recents, kept across reloads), then the sections in `SECTION_ORDER`. Keys:
  ↑/↓ (⌃N/⌃P on a Mac), Enter runs, Mod+Enter and Alt+Enter run a command's second and third
  actions (Open in Bench and Add holes, for a part; Copy link, for a link), → at the end of the
  search lists all of its actions — where the same three keys go by position, whichever action
  is highlighted — Escape clears the search, then goes back a list, then closes, Backspace on an
  empty search goes back. A link command (`commandCatalog.js`'s `linkActions()`: the repository,
  an issue, the desktop app, Layerling, a part's source, a user's link) opens on Enter and copies
  on Mod+Enter; a command that leaves nothing else to see says what it did for a moment at the
  foot of the window (`lib/commandHud.js`, "Link copied"). A command with a `page`
  opens a list of its own (Grid step…, View from…, Hole type…, Attach a part…); the stack holds
  ids and resolves them again on every render, so it never runs a stale closure.
  It is a native `<dialog>` with `showModal()`, so every key handler in the tabs already stands
  aside (`isBehindOpenDialog()`), and it stops each plain key from propagating as the View menu
  does. Running a command closes it first, in the same event: a file chooser or a new window keeps
  the user's activation, and whatever the command opens (Settings, the attach picker) mounts in
  the same commit the palette leaves — never two modal dialogs at once, which matters because
  `isBehindOpenDialog()` reads the first open one, not the topmost. Mod+K over another dialog
  does nothing (it is cancelled, so Chrome's Ctrl+K doesn't take it either). Links go through
  `window.open()`, which the desktop app hands to the system browser.
  The Bench's and Holes' **part pickers** are palette pages too — "Start a bench", "Drill screw
  holes" over an empty tab, "Attach to …" over the scene with the joint beside the search — built
  from `catalogueUtils.js`'s `partSections()` with each part's gallery thumbnail. A start picker
  opens whenever the tab is empty (first visit, Start over, Pick another model, an undo back to
  empty, a link to no bench): Escape puts it away *for that session snapshot*, leaving the empty
  tab with a "Choose a part… ⌘K" button, and Mod+K there reopens it (`useCommandHome()`). It
  steps aside for the import flow it opens and comes back when that is cancelled. Typed into,
  its search also ranks the app's commands under "Commands", so an empty tab still reaches the
  rest of the app; until something is typed, Cmd/Ctrl+Z in it is the tab's undo
  (`pickerUndoKey()`), so Start over then Cmd+Z brings the bench back at once.
  **A model file dropped** anywhere on a palette, backdrop included, goes to its root page's
  `drop` (`hooks/useFileDrop.js`, which also keeps the browser from opening a dropped file in
  place of the app): the start pickers and the attach picker open their import flow on it
  (`ImportFlow`'s `initialFile`, read as the flow opens), and the global palette hands it to the
  mounted tab (`useCommandDrop()`) — the Bench starts a new bench on it, Holes drills into it,
  each after asking when there is work to lose, and undoably; the Library takes none. The empty
  Bench and Holes tabs behind the pickers are drop targets too, with an Import button beside
  "Choose a part…".
  **User commands** (`lib/userCommands.js`) are the architecture for the user's own: a
  validated store under `connector-foundry.userCommands` of commands — an action `kind`
  (`open-part` with parameters and a target tab, `bench-preset`, `hole-preset`, `link`, `view`,
  `command`), a title, an alias, a hotkey — and of aliases and hotkeys for built-in commands
  (`bindings`). Every entry is checked on the way in and a bad one dropped with a reason: links
  http(s) only, parameters names and values the code generator can write, hotkeys Mod+Shift or
  Mod+Alt (Mod+Shift only off the Mac, where Ctrl+Alt is AltGr) and not reserved or taken
  (`lib/hotkeys.js`). `hooks/useUserCommands.js` lists them first, under "Your commands", and
  runs a hotkey as Enter would — outside any dialog, never on AltGr. There is no editor yet: a
  settings backup carries the key (as a JSON string, since the backup stores raw strings), so a
  hand-edited `.settings.json` is how they are made for now, e.g.
  `"connector-foundry.userCommands": "{\"version\":1,\"commands\":[{\"id\":\"bin\",\"title\":\"My bin\",\"hotkey\":\"Mod+Shift+L\",\"action\":{\"kind\":\"open-part\",\"partId\":\"gridfinity/bin\",\"params\":{\"gridx\":2},\"target\":\"library\"}}]}"`.
  A new kind is a `check` in `ACTION_KINDS` and a runner in App.jsx's `useUserCommands()` call.
- **Undo and redo.** Each tab has its own history, kept with its state so a tab switch keeps it:
  `lib/librarySession.js`, `lib/benchSession.js`, `lib/holesSession.js`, all on `lib/history.js`.
  A step is an immutable snapshot of the value *before* a change (the Library's part and
  parameters, the bench's tree and imported meshes, the Holes document), so a step costs a
  reference; meshes are never copied or serialised. A history keeps the last 100 steps
  (`createHistory()`'s `limit`) and lasts until a reload; only a bench link opened clears one
  (below). Modes record from event handlers, never inside a `setState` updater, which StrictMode
  runs twice. A field that reports every keystroke passes a coalescing key (`param:gx`,
  `params:<node>:<key>`, `spec:<ids>:<field>`, …): records with the same key within a second of
  each other are one step, and undo, redo and clear forget the key, so typing, undoing and
  typing again is a fresh step. Cmd+Z (Ctrl+Z off the Mac) undoes,
  Shift+Cmd/Ctrl+Z and, off the Mac, Ctrl+Y redo — `hooks/useUndoShortcuts.js`, one window
  listener per mounted tab, matching `e.key` lowercased and never `e.code` (on a German keyboard
  Z and Y swap places, and the key labelled Z is the one meant). `ignoresUndoShortcut()` leaves
  the keys to a text field's own undo (`isTextEntry()`: a text-like `<input>`, a `<textarea>`,
  anything `contentEditable` — not a checkbox or a select, which have no native undo, so Cmd+Z
  after ticking a parameter undoes the tick) unless the field is marked
  `data-native-undo="false"`, as a `DecimalInput` is while it shows a value the app put there (a
  step, the wheel) rather than typing; and to a dialog the event is not inside. Every matched,
  unignored key is `preventDefault()`ed, also with nothing to undo: in the desktop app the Edit
  menu's undo role is bound to the same keys, Chromium offers a key to the page before the menu,
  and a key the page let through goes on to `webContents.undo()`, which can revert typing in a
  field that has already lost focus. The Bench's and Holes' part pickers focus their search on
  arrival, after Start over or "Pick another model" too; until something is typed into it,
  Cmd/Ctrl+Z there is the tab's (the palette's `undo`, `pickerUndoKey()`), so Start over then
  Cmd+Z brings the bench back at once.
- **Sidebar width.** The sidebar's right edge is a drag handle (`src/components/SidebarResizer.jsx`,
  a `role="separator"`): drag it, or focus it and use ←/→ (16 px; Shift 64), Home/End; a
  double-click restores the default; the keys it handles stop there (`stopPropagation()`), so
  ←/→ on the focused sidebar edge never also step a selected Bench part to another slot. One
  width for all three modes, kept in `uiPrefs.js` (220–640 px, default 280, stored only when
  not the default) and written onto `.shell-body` as
  `--sidebar-width` by App's `ShellBody` — through a ref (`style.setProperty`, from a store
  subscription, in a layout effect so the first paint already has it), not React state: a drag
  changes it on every pointer move, and as App state each of those re-rendered the active mode
  for a value only the stylesheet reads. The grid column and the handle both read it through the
  same `clamp(220px, var(--sidebar-width), 60%)`, so a width saved on a big window still leaves the
  workspace 40% of a small one and the handle stays on the edge. The handle is a sibling of the
  `<aside>`, not a child, so it doesn't scroll away with the sidebar's content. The sidebar is a
  size container (`container: sidebar / inline-size`) and its rows are written to reflow on its
  own width rather than the viewport's: the Holes spec grid takes as many 7rem columns as fit
  (one at the narrowest, three dragged wide), and the Bench's label/control rows wrap the control
  under its label, right-aligned. Checked by measuring every element against the sidebar's
  content box at 220–636 px in all three modes, with every section open. Hidden on narrow screens,
  where the sidebar stacks above the workspace instead.
- Narrow screens (`max-width: 768px` in `styles.css`): the two-column shell stacks into one
  scrolling column — sidebar (capped at 45% of the viewport, scrolls inside itself) on top, then
  the header, the 3D viewer at a fixed viewport fraction (the canvas sizes itself from its mount,
  so it needs a real height), then the parameter form. The `[` shortcut hints and the "Settings"
  word hide; `SidebarToggle` shows text instead of a chevron. A `(pointer: coarse)` block gives
  every primary control a 44px hit area and skips `PartBrowser`'s and the command palette's
  autofocus so the keyboard doesn't pop over the list; the palette's key hints and footer go.
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
  original tab had) leaves an empty session carrying a `notice` that the Bench's start picker
  shows in place of the config error, pointing at the config export, which does carry the meshes.
  A `hashchange` after that (a bench link pasted into this tab's address bar — a same-document
  navigation, so the app doesn't restart) restores again and switches to the hash's mode;
  `replaceState` never fires `hashchange`, so every such event is external by construction.
  Neither restore is an undo step, and both clear the bench's history
  (`replaceBenchSession(…, { record: false })`, then `clearBenchHistory()`): a link opened is
  navigation to another bench, and undo would otherwise bring back the previous one and step
  through edits nobody made to this one. Replacements made inside the app — Open in Bench, a
  loaded config, Start over — are steps ("Undo open in bench").
- Settings → "Part list" sets the order of the system headings in every part list (Library
  sidebar, start-a-bench, attach-to-slot, Holes' start). Default is catalogue order — `catalogue.yaml` is kept
  in the intended default order (Gridfinity, openGrid, GoPro, DeckMate, BitBeam, Basics, 2020
  Extrusion), so nothing here restates it. A saved order (`uiPrefs.js`, one JSON array) is
  resolved against the live catalogue by `catalogueUtils.js`'s `resolveSystemOrder()`: systems it
  does not name are appended in catalogue order, names that no longer exist are dropped. The lists
  read it through `useSystemOrder()` (a `useSyncExternalStore` over `uiPrefs.js`), so the sidebar
  behind the open dialog reorders as ▲/▼ are pressed; "Reset to catalogue order" removes the key.
  The same rows curate the list: a box per system and, folded under it, one per part
  (`uiPrefs.js`'s `{ systems, parts }` under one key, read live through `useHiddenLibrary()`).
  `catalogueUtils.js`'s `listedParts()` is the one filter every part list applies — catalogue
  `hidden` entries, hidden systems, hidden part ids — and nothing else consults it: the parts map
  the Bench, configs, and links resolve ids against is the full catalogue, so hiding a part never
  breaks a bench that uses it. A hidden system hides parts added to it later too (its part boxes
  are disabled while it's hidden, and untouched, so showing it again restores the per-part
  choices). Library's first-visit default is the first *listed* part, not `parts[0]`.
- Settings → "Editing" → Grid is the one grid every tab snaps to (`uiPrefs.js`'s `gridSnap`: Off,
  0.1, 0.25, 0.5, 1, 2 or 5 mm, default 0.5 — the Holes tab's old fixed placement grid; TinkerCAD's
  is 1 mm, but that would have moved where every existing user's next hole lands): resize drags,
  arrow steps on a handle, and the Holes tab's placement, hole moves and nudges. The viewers' Grid
  selects and the Holes sidebar's set the same value, all read live through `useGridSnap()`, so
  none can disagree; a stored value that is not an option reads as the default, and the settings
  backup carries it like every other `connector-foundry.` key.
- Collapsible sidebar: one shared boolean (`src/lib/uiPrefs.js`, localStorage-backed the same
  best-effort way as `userOverrides.js`) rather than one per screen, so collapsing it in Library
  and switching to Bench doesn't spring it back open. `src/components/SidebarToggle.jsx` is the
  same button in both `<aside>`s; collapsing just skips rendering everything past it (`Library`'s
  and `Bench.jsx`'s `{!sidebarCollapsed && (...)}`) rather than hiding it with CSS, and
  `.app`/`.bench`'s grid column narrows to fit — no separate collapsed-vs-expanded layout to keep
  in sync.

## 3D viewer (`src/components/StlViewer.jsx`)

One viewer for all three modes; its header comment documents every prop. What follows is the
resize handles, the toolbar and the camera, which TinkerCAD users will look for, and where this
app differs from it on purpose: its geometry is parametric, and a render takes a while
(a Gridfinity bin going from 1 to 2 units: about 570 ms from release to the new mesh, with real
`openscad-wasm`).

- **Handles are DOM, not three.js.** Each is a `role="slider"` element in a `.viewer-handles`
  layer over the canvas, re-projected every frame the viewer draws. That gets keyboard focus, a
  Tab order, `aria-valuenow`/`-valuetext` for screen readers, CSS hover and focus, and a hit
  area measured in pixels whatever the zoom: 20 px (44 px on a coarse pointer) around an 11 px
  square. The positioned element is the hit area (its inline transform is rewritten every frame);
  the square inside it is what grows on hover. TinkerCAD's look: edge handles dark with a white
  border, corner and height handles white with a dark one, the accent on hover, focus and drag.
  A grab target is drawn 12 px out from the point it stands for along the handle's direction as
  the screen shows it (the height handle 18 px above the top face, on a stem; Holes' move handle
  on its point), plus however far the side of the body it stands on (`span`) reaches past the
  point that way — looking down on a tall bin, the footprint handles' targets sit outside the
  top rim, not on it or in the opening. That also keeps them off the slot markers at face
  centres.
- **A ghost, then one commit.** A drag never re-renders the part. `pointerdown` (primary
  pointer, button 0; `preventDefault()`, so the handle takes no focus and the arrow keys go on
  nudging the selection afterwards — though it does blur a field outside the viewer, as a press
  on the canvas would, so Cmd/Ctrl+Z after the drag undoes the drag, not the field's typing)
  captures the pointer and calls `onHandleStart`; each pointer move, at most once a frame, finds
  where the pointer's ray meets the handle's line or plane and asks the mode for a preview
  (`onHandlePreview`), which the viewer draws as the ghost outline (one `LineSegments`, no depth
  test, its buffer reused), a label, and the dragged handle and its mirror moved onto the ghost
  — every other handle hides. The point handed over
  is the handle's own point moved by the pointer's travel since the press, so a press anywhere on
  the target doesn't jump. On release the viewer flushes one last preview at the release point
  and commits that same point (`onHandleCommit`): the commit is exactly what the ghost showed.
  Travel under 5 px (10 px for a finger or a pen) was a click. `Escape` cancels; while a drag
  runs, a capture-phase key listener swallows every key but the modifiers, whose changes re-run
  the preview. A right- or middle-button press and the wheel over a handle go on to the canvas,
  so orbit, pan and zoom work from there; a second finger ends a handle drag without a commit and
  hands both fingers to OrbitControls as a pinch (`drags.handOff()`). A handle that goes away
  mid-drag (a render error, another part, Helpers) takes the drag, or its open size box, with
  it. `onHandleEnd(id, committed)` closes every gesture. The modes keep the ghost (`ghost` prop,
  labelled "… · rendering…") and stand the handles on the predicted box until the render lands,
  so a second drag can start before the first is done.
- **Symmetric and anchored.** Every catalogue part module is `anchor=BOTTOM` and centred in X
  and Y, so a render is always centred: Library and Bench parts grow on both sides in width and
  depth (TinkerCAD's Alt-drag) and upward in height, the mirror handle rides along, a small cross
  marks the centre during an X/Y drag, and the label says so ("W 126 mm · gx 3 (+21 each
  side)"). `handleMode="symmetric"` (the default) fades a footprint handle on the far side to
  35% and lets clicks through it while its mirror on the near side is up — never the focused
  one. `resize.js` makes one handle per axis a Tab stop (`x+`, `y+`, `z+`, `xy:x+`; the viewer
  leaves the rest `aria-hidden`), since the mirror does the same job; a corner, which drives two
  values, is never one. Holes passes `"anchored"`: each edge resizes from the opposite one, so
  all four are different jobs, all live and all Tab stops (`holeHandles.js`).
- **Near-parallel views.** A line constraint pointing within 15° of the view ray (the height
  handle from the Top view), or a plane within 15° of edge-on, maps a few pixels of pointer to
  hundreds of millimetres. `dragMath.js`'s intersections refuse inside that cone and the viewer
  hides a handle there (and one behind the camera). When perspective carries a running drag into
  the cone, the rest of it is read in screen space (`screenAxisDelta()`), from the last good
  point and the pointer position it was read at, with the scale floored at the cone edge's, so
  the reading never gets more sensitive than where the intersection stopped — without the floor,
  50 px of travel 1° off the axis read as 573 mm.
- **The size box** (TinkerCAD's "click a handle, type the size"). A click on an editable handle,
  or `Enter` on a focused one, opens a small form with one `DecimalInput`, prefilled with the
  size in mm and kept inside the viewer. `Enter` commits (`onHandleSet`), `Escape` cancels, and
  both stop there, so the Bench's and Holes' `Escape` doesn't also drop the selection; focus
  leaving it commits only while the window has focus; an emptied or unparseable field sets
  nothing, and nor does one closed still showing its prefill (the measured size rounded to three
  decimals, which would otherwise re-round the parameter: an undo step and a render nobody asked
  for); `Enter` or `Escape` gives focus back to the handle if it is a Tab stop. While it is
  open, a press on the canvas or on a handle closes it (committing what was typed, as leaving the
  field does) and does nothing else: no hole drilled, no part picked, no drag. A typed size is
  not snapped to the grid (a count still rounds to its step).
- **Keyboard.** On a focused handle ↑/→ grow and ↓/← shrink (`onHandleStep`); the mode applies
  Shift ×10 to free lengths only (ten Gridfinity units is 420 mm). The viewer takes the key
  (`preventDefault()` + `stopPropagation()`), so the Bench's and Holes' window arrow keys don't
  also move the selection, and leaves it alone with Cmd, Ctrl or Alt held. Steps take the mode's
  normal debounce and coalesce into one undo step. Hover or focus shows the handle's size
  (`valueText`) after 300 ms, beside it, flipped or moved so it stays inside the viewer and off
  the other handles.
- **The toolbar** (`.viewer-toolbar`, top right): the mode's `toolbar` (its Undo and Redo; the
  Bench's selected-root chip), a Grid select when `gridControl` is set (Library: a part with a
  free length to drag; Bench: a selected root with one; Holes: always) — `uiPrefs.js`'s grid,
  shared with Settings → Editing; it gives up focus after a pick, so the next arrow key isn't
  the select's — then Fit, View ▾ and Helpers. It wraps on a narrow viewer, and its controls are
  44 px on a coarse pointer. Fit (or `f`) frames `fitBox` — the Bench's selection — or the model,
  keeping the direction the camera looks from; View ▾ has Home (the framing a new model gets),
  Top, Front and Right, and Top looks down from a hair off vertical so OrbitControls keeps +Y
  up the screen; the wheel zooms toward the pointer (`zoomToCursor`); Helpers (`h`) also hides
  the handles, ghost, label and size box, and cancels a drag.
- **When the camera moves** (`viewerCamera.js`'s `refitMode()`). `fitKey` says what the model
  is of — Library: the part id; Bench: the root's part id; Holes: `catalogue:<id>`, or
  `mesh:<name>:<extents>` so another file with the same name re-frames while a flip doesn't. The
  first model, or a new key, gets the Home framing; a new model with the same key keeps the
  camera where the user put it and only backs out along the view, never in, if the new box no
  longer fits ±0.95 of the view — a part that shrank keeps the view. A caller that passes no
  `fitKey` keeps the old rule: re-fit when the model's centre or size moves more than 2%.
- **Handles stay in reach.** A resize can push handles under the toolbar, under the mode's
  buttons (Library's Download STL) or off the canvas before its render even lands. So when a new
  `handles` list shares an id with the last one and reaches more than 0.01 mm past it (the
  predicted box a commit stands them on), the viewer backs the camera out, never in, to the
  nearest distance (up to 20×) at which every handle that could be grabbed before still can —
  shown, its whole hit area 4 px inside the viewer, clear of the toolbar's controls and of every
  other child of the viewer's parent element — and so can the keyboard-focused one, with every
  handle point inside ±0.95, the margin a landed model gets, so the landing moves nothing more.
  Not during a drag, not for a shrink or a new selection (no shared id), not while the helpers
  are hidden, and not when the viewer itself is resized. So a mode lays its chrome over the
  viewer as siblings of `<StlViewer>`, stands its handles on the pending predicted box, and gives
  each subject its own ids (Holes prefixes them with the hole's id, so switching holes never
  moves the camera).
- **Stacking.** `.viewer-canvas` is `isolation: isolate`: the `children` overlay and the labels
  at 1, the handles at 2, the drag label at 3, the toolbar at 4, and the mode's chrome outside the
  canvas (`.viewer-actions`, `.bench-error`, the Holes snap chip) above all of it. The drag label
  is `.viewer-drag-label`, not `.viewer-label` (which `holes.spec.js` counts); it sits 26 px
  above its point, or below where above is off the viewer or would cover a shown handle, and
  stays 6 px inside the viewer. The overlay hides during a drag and while the size box is open,
  and is kept inside the viewer.
- **The catalogue's `resize` field** (its header in `catalogue.yaml` documents it; the CLI
  ignores it) says which parameter each axis's handles drive: per axis (`x`, `y`, `z`, or `xy`
  for a diameter) a `param`, its slope `per` (mm of outside size per unit: 42 for a Gridfinity
  cell), a `step` for a count, handle-only `min`/`max`, and a `when` for entries that apply to
  one option (the 2020 rail's `len` is X lying down, Z standing up). Only the slope is recorded;
  the current size is measured off the mesh (`meshBounds()`), so a bin's clearance or lip never
  needs writing down. `resize.js`'s `resizeAxes()` resolves the bounds — up from the larger of
  the catalogue minimum and the entry's `min`, else one step, else 0.1 mm of outside size; up to
  the smaller of the catalogue maximum and the entry's `max` — and `tests/conftest.py`'s
  `resize_bounds()` and `resize_applies()` (a `when` compared with JS `===`: a bool never equals
  a number) are its Python mirror: change both or neither. `tests/test_catalogue.py` holds every
  default and variant inside the range and on the step, and `tests/test_resize.py` renders each
  entry one step on — from the defaults, from the handle's lower bound where that isn't the
  default, and from every variant that sets an option — and holds the mesh to the ghost within
  0.05 mm (an `xy` diameter gets a faceting allowance on top: the polygon's box stops short of
  the circle by a different amount at each size). A gesture's bounds widen to
  take in its start value, so a part set past a handle bound in the sidebar doesn't jump when a
  drag starts; and one gesture moves at most 4× the size along the handle or the box's diagonal,
  whichever is larger, so a flick past the edge of the view can't commit a grid that takes
  minutes to render. A count rounds to its step; a free length (slope 1) snaps its value to the
  grid, so 40.3 goes to 41 on a 1 mm grid, not 41.3; any other free slope snaps the size change;
  grid Off rounds to 0.01.
- **Library** (`src/Library.jsx`) is the plainest use of all this. Its handles stand on
  `meshBounds()` of the mesh on screen when that mesh is for the current parameters, else on
  the box predicted from it (each resize axis grown by its slope times the change), so a
  focused handle keeps its element — and its focus — through the render it started, and through
  a sidebar edit. A drag, a typed size and an arrow step all commit through one
  `commitResize()`: an undo step ("resize W"), the changed values merged into the *current*
  parameters, and a pending ghost with the header's size shown muted until the render lands. A
  drag's or a typed size's render starts at once — `useRender`'s `delay` is 0 while the key's
  params are the very object the commit set — while arrow steps wait the usual 400 ms and
  coalesce as `handle:<id>`; a sidebar edit is keyed
  `param:<key>`, and a switch to another part is a step too. A size that fails to render swaps
  the handles for a "Couldn't render that size." note with an Undo. The Grid select shows when
  any of the part's axes is a free length.
- **Perf.** No hover raycasts while a mouse button is down (an orbit or pan); the device pixel
  ratio is capped at 2 and re-applied when it changes (another screen, browser zoom: a
  `matchMedia` on the current resolution, re-armed each time); markers and guides are compared
  by key and rebuilt only when they changed; the overlay effect asks for a frame only when its
  anchor moved or it is a new element. Retired marker groups are disposed a frame late — see the
  Holes section.

## Bench (`src/Bench.jsx`)

The visual editor: a root part plus a tree of parts snapped onto open slots, each connection with
its own joint type — see [docs/BENCH.md](../docs/BENCH.md) for what it does, including how
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
  `{param, offset, scale, unless}` that `slots.js`'s `mountOffset(part, params)` evaluates against
  the node's params over the catalogue defaults — the GoPro female's `mount` sits over its middle
  prong, `(outer_w - 3) / 2` off the plate's center, and back at the center when `symmetric` pads the
  other leg to match. `cli/foundry.py`'s `mount_offset()` is the same rule, and
  `tests/test_anchors.py` renders every variant of such a part to hold both to the geometry.
- `compileToScad()` generates one `.scad` source per assembly state, through the *same*
  worker/render pipeline as everything else (a second request shape, `{ scadSource, part }`,
  alongside the single-part `{ scadFile, module, params }` one) — the Bench never has its own
  bespoke renderer. It recurses depth-first, nesting each node's `attach()` call around whatever's
  attached to it; `bodyTags()` generalises "one printable body per fused subtree" to
  any depth, and — for a pin joint — one further tag for the pin itself
  (`"<childId>_pin"`, since the pin is its own third printable body, not integral to either
  flange; see [docs/JOINTS.md](../docs/JOINTS.md)). Getting an isolated body's export right for
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
  `components/SpinButtons.jsx`, used floating over the scene and, inside `components/RotationInput.jsx`, beside the sidebar's angle field — the Bench's Rotation and the Holes tab's slot Direction alike).
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
- Selection is `Bench.jsx`'s `selectedNodeId`, the root included. A click on the rendered mesh goes
  through `StlViewer`'s `onModelClick` (the hit point, or null for empty space; a drag isn't a click
  — `CLICK_SLOP_PX`) and `src/lib/benchPick.js` decides which part that point is on:
  `nodeWorldBoxes()` gives a world AABB per node that can be placed on the same footing as the
  markers (root, plus any catalogue part mated vertically — root's top grid, a `bot` stack, a ±Z
  imported anchor — footprint rotated by its spin, padded by `mount_offset`), and `pickNodeAt()`
  takes the smallest box containing the point, so the part sitting on top wins over the base it's
  on, and the root is what's left. Nodes without a box (imported, side-mounted) select from the
  sidebar only; the root also has a "Select root" toggle beside its name, outside the "Root
  parameters" `<summary>` (a button in a summary toggles its `<details>` too, and the browser
  tests open those by their summaries). A selection made in the scene opens that node's
  parameters and scrolls them into view (`revealParams()`, finding the `<details>` by its
  `data-node-params`; only the sidebar scrolls, so the stacked phone layout never scrolls the
  viewer away from the tap). The same box drives `StlViewer`'s `highlightBox` outline (a
  `Box3Helper`; for a selected root with handles, the box they stand on, so outline and handles
  never disagree while a resize renders), `fitBox` (Fit and `F` frame the selection) and, for an
  attached part, via `boxTopCenter()`, the `overlayAnchor` its floating controls are pinned to —
  `StlViewer` re-projects that anchor every frame it draws and moves the overlay `<div>` with a
  transform, docking it at the bottom when there is no anchor. The root's controls (its name, Crop,
  Deselect) go in the viewer's toolbar instead, as `.bench-root-chip`: pinned over its top face,
  they covered an open slot marker and its handles.
- The root is guarded wherever an attached part's action would do harm: `Delete`/`Backspace`,
  `M` and the arrows do nothing while it is selected, and `nodeActions.remove` refuses it —
  `removeChild(root)` would take every node with it, and the root has no slot to move or step to.
- **Root resize handles** (see "3D viewer" for the handles themselves). Only the root's for now:
  it is placed exactly — centred, unrotated — so its box is its faces, while an attached part's
  box is padded for spin, shift and mount offset, and handles on it would sit off the faces they
  stand for; a selected attached part shows "Resize in the sidebar" under its pill instead (see
  docs/IMPROVEMENTS.md), and so does a selected catalogue root whose entry has no `resize` (an
  imported mesh has no size parameters and says nothing). The box the handles stand on is for
  the root's current parameters only (a box from older ones would start a drag from the wrong
  size and run the guard below against the wrong slots): the measured extents, when they were
  rendered for these parameters (each entry keeps the parameters it was measured with); else the
  root's own render straight from the cache, when it is there but the measurement hasn't caught
  up (an undo back to a size rendered before, so a focused handle survives it); else the box a
  pending commit predicted; else none, and none on a failed render. A commit is
  `nodeActions.setParams(ROOT_ID, merged, { key, label: "resize W" })`. A drag or typed size
  renders at once (`immediateTree`: the root's own extents first, so the handles move onto the
  measured box, then one assembly render); arrow steps wait the 250 ms debounce and share the
  key `params:root:<param>` with typing in that sidebar field, and a run of them labels its
  ghost with the change since the run began. The pending ghost stays until the assembly render
  for that tree is current; if it fails, an Undo appears inside `.bench-error`, but only while
  the tree is still the one the commit made — after any other edit it would take back that edit
  instead.
- **The children guard** (`benchResize.js`'s `guardResize()`). An attached part names its slot
  (`mount_1_0`, `xpos_-0.5`) and the generated `.scad` attaches it by that name; slot names are
  centre-relative indices (`slots.js`), so a grid that shrinks loses its outer names and a
  count-parameter grid that changes parity renames every slot (2 cells: ±0.5; 3 cells: −1, 0,
  1) — BOSL2's "Unknown anchor" on the next render. So a handle only ever lands on a value that
  keeps every occupied slot name: from the value asked for, the nearest one further the same way,
  up to the handle's bound (2 → 3 cells on an openGrid board with parts on it becomes 2 → 4);
  failing that, the nearest back toward the start, never past it; if the start itself already
  misses a slot, the value asked for goes through and the render error shows, as before. Each
  driven axis is settled on its own, which is exact for every catalogue part today (slot names
  factor by axis). The drag label, and for an arrow step or a typed size the handle's
  `aria-valuetext` and readout, say what it did and why ("cells_x 4 — 3 would move attached
  parts"); that note belongs to the gesture and goes when the handle loses focus, another gesture
  starts, or the selection or the parameters change. Only the handles are guarded; a sidebar
  field is not (docs/IMPROVEMENTS.md).
- **Undo.** Every change goes through `benchSession.js`'s setters with a label for the Undo
  tooltip ("attach part", "delete part", "start over", "open in bench", …); the fields that report
  every keystroke pass a coalescing key — `params:<nodeId>:<key>` (from a diff of the old and new
  parameters; none when several changed, a reset), `name`, `overlap:<id>`, `shift:<id>`,
  `spin:<id>`. A step records only when the tree actually changed (a JSON compare; the meshes are
  compared by identity, never serialised), and an import is one step with the node that uses it:
  `setBenchImportedParts()` records under a key of its own that the `setBenchAssembly()` in the
  same task joins (the fold ends at the next microtask). Start over, a loaded config or preset and
  Open in Bench are steps (`replaceBenchSession()` records by default). After an undo or redo the
  pending ghost and guard note go, and so do the selection and an armed move if their node did.
  The start picker offers Undo/Redo whenever either is possible, and so does the empty tab behind it.
- **Rendering less.** `compileToScad()` is memoised per `{ assembly, partsById }` (a `WeakMap`
  on the immutable tree; a throw is kept and handed back as that render's error), which backs the
  assembly render's `cached` option: typing the bench's name (not in the source) or undoing back
  to a bench rendered before shows at once, with no "rendering" in between. A round of node
  extents that measures every node as before keeps the old state object (`mergeExtents()`), so
  the markers, boxes and slot lists built on it don't rebuild.
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
  move mode, selection) — the attach picker is a command palette page, which takes its own
  Escape first (clearing a typed search before it cancels); `Delete`/`Backspace` removes the selected part, `M` toggles move mode,
  arrows nudge — all three only with no modal up and the key not aimed at a field
  (`src/lib/isEditableTarget.js`, the same check `App.jsx`'s shell shortcuts use), and never for
  the root (above). The handler skips an event something nearer already took
  (`defaultPrevented`): a focused resize handle's arrows, the View menu's `Escape`.
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
  per-part formula to restate. The Bench currently only *offers* `bot` for stacking (see
  [docs/BENCH.md](../docs/BENCH.md)); the rest of the field, and `FACE_ANCHOR_LOCAL`'s other entries, stay there for root's
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
  `renderError.js`'s `friendlyRenderError()` already has a message for shouldn't cost every *other* node its markers,
  or surface as an unhandled promise rejection — it's logged (`console.warn`) and that one node's
  slots just don't show, same as if nothing had asked for them yet. Relatedly,
  `openscad-client.js`'s worker message handler now actually forwards the worker's own
  `type: "log"` messages (the detailed OpenSCAD stderr behind a generic "check the parameters"
  failure) to `console.error` instead of silently dropping them — previously dead code, since
  those messages have no `id` to match a pending request against.
- Every node — root or any depth of child — gets a parameter editor in the sidebar: the same
  `src/components/ParamsEditor.jsx` Library mode's params panel is, so the catalogue-default
  diff/reset/save-as-default flow is one implementation, not two that agree.
- Each child carries an `overlap` field (mm, default 0) — [docs/BENCH.md](../docs/BENCH.md)'s "Offset" — that
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
or the current bench rendered as one mesh. See [docs/HOLES.md](../docs/HOLES.md) for what it does;
the implementation notes:

- The document (`src/lib/screwHoles.js`) is `{ source, holes, name, nextSpec, nextPresetId }`:
  `source` is `{ kind: "catalogue", partId, params }` or `{ kind: "mesh", name, stlBytes, extents }`;
  each hole is `{ id, point, normal, spec, presetId }`, the point *on the surface* in the model's
  own frame and the face's outward normal, so the hole is cut along `-normal`. `spec.kind` is
  `"screw"` (diameter, depth (0 = through), head (`none` / `counterbore` / `countersink` / `hex`),
  head diameter (across corners for hex), head depth (how far the pocket sinks; a countersink's
  extra sink on top of its cone) and sink angle), `"openconnect"` (lock side, side and depth
  clearance, spin), `"multiconnect"` (channel length, on-ramp, an on-ramp every 28 mm as well (`rampEvery` — `mc_slot()`'s `ramp_spacing`, for an item on a column of heads), detent, clearance, spin) or `"thread"` (openGrid's female snap thread for the screw connectors: depth (0 = through), clearance, spin) — the
  slots and the thread carry only the choices upstream's geometry leaves open (`isConnector()` is
  the three of them). `nextSpec` is what the next click drills — the sidebar's "New holes" editor
  edits it; with a hole selected the same editor edits that hole, and `nextSpec` follows along, so
  the screw picked or edited last is what the next holes get. It lives in
  `src/lib/holesSession.js` (module state, like `benchSession.js`) so a tab switch keeps it; it is
  not in the URL.
- **Selection** is a list of hole ids (`Holes.jsx`'s `selectedIds`): a plain click on a hole —
  its list row, its ring (`StlViewer`'s `onMarkerClick` now passes the click's modifier keys), or a
  face spot that already has one — selects just it; Shift toggles it in the selection. Shift on a
  bare face is still free placement, so the two meanings don't collide. With several selected,
  `screwHoles.js`'s `sharedSpec()` gives the editor the fields they agree on and the `mixed` ones;
  `HoleSpecFields` emits patches (`onChange(patch)`), and `patchHoles()` sets just those fields on
  every selected hole. A field they disagree on shows empty with "mixed", a checkbox indeterminate,
  a menu a disabled "Mixed" entry; holes of different kinds share no fields, so only the presets
  are offered. `setHolesSpec()` applies a preset to all (each slot keeps what it shares with the
  preset — see `presetSpecFor()` below — and the preset becomes `nextSpec`, as with one hole); `rotateHoles()` turns each slot by the same
  step from its own direction; `removeHoles()` deletes them. The pill over the scene sits over
  their middle. The Delete button is always there (disabled with nothing selected) and the note
  above it is a fixed three lines, so selecting doesn't move the list under the pointer mid
  Shift-click.
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
  z = 0 and the pocket below. The openGrid thread is `og_thread_hole(...)` from `lib/ogthread.scad`
  in the same frame as a slot (its +Y is where a screwed-home head's +Y ends up); a through thread
  stops at the base's width along its axis (`extents`, when the caller passes them) rather than the
  diagonal, since a helix costs by the millimetre. A 2020 socket is `ex_socket(...)` from
  `lib/exsocket.scad`, and a rectangle a `linear_extrude()` of its outline, both in that frame
  too. Its in-plane axes are not arbitrary: `slotFrame()` makes the slot's
  +Y (the way the head travels to seat, "up" on the wall) the face's own up — the world's +Z
  projected onto the face, so a slot on a vertical face points straight up; for a face within 30°
  of level, where that projection is too short, the world's +Y, so a slot on a plate lying flat
  runs along the plate's Y; failing both, +X — turned by the spec's `spin` (degrees, counter-clockwise seen from outside
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
  largest extent, at least 1.5 mm) of a candidate takes it; otherwise the click rounds to the
  Grid setting (`uiPrefs.js`'s, 0.5 mm by default — the fixed grid it replaced; Off is the exact
  point) in the face's own frame; Shift-click (or snapping off) uses the exact point. The
  analysed mesh is a welded copy (`mergeVertices` on positions only — the display geometry keeps
  the file's flat normals) in the same triangle order, so the viewer's `faceIndex` indexes it
  directly. Because it is the *rendered* mesh that is analysed, holes already drilled are
  themselves snap targets, and a click on one selects it instead of drilling through it
  (`placeAt()`).
- Markers: holes are flat rings (`StlViewer` `shape: "ring"` markers, oriented by the hole's
  normal and lifted 0.08 mm off the surface; `holeFootprintRadius()` sizes them — a slot's ring is
  its channel's half width), the hovered face's snap points small spheres, the one
  within reach and the selected hole in the selection yellow. A slot also gets its outline drawn
  through the `guides` prop (`slotOutline()`: the channel and pocket or round end, the entry
  dashed, and an arrow the way the head travels), since a ring says nothing about which way it
  points. Markers now take a `color`, and the
  viewer keeps the camera where it is for a new model of the same base (`fitKey`, see "3D
  viewer") — a hole drilled, a parameter changed or a flip no longer resets the view.
- `src/lib/screwPresets.js` holds the fastener presets — ISO 4762 socket caps, ISO 10642
  countersunk, ISO 7380 button heads, heat-set inserts, thread-forming core holes, ISO 4032 nut
  traps, wood screws and their pilots, a plain hole and a dowel — each with the `spec` it cuts and
  a `screw` record (`style`, nominal, head diameter/height) that `components/holes/ScrewIcon.jsx`
  draws as a cross-section: the slab, the cut, the fastener seated in it, to the preset's own
  proportions — and the two connector groups (openConnect: lock left / both / none; MultiConnect:
  with on-ramp / open-ended / quick release), drawn as the keyhole section with the head seated in
  it on its snap, depths four times over since a 2.8 mm slot at its width's scale would be a
  hairline — and the openGrid thread (full-size / lite screw, differing in depth), drawn as the
  bore with a screw connector in it. A hole remembers the preset it was placed from and says "(edited)" once its spec
  differs (`specMatchesPreset()`). Picking a slot preset for a slot keeps what the two share
  (`presetSpecFor()`): a preset sets only the fields that tell its kind's presets apart
  (`presetKeys()`, read off the preset list — MultiConnect's on-ramp and detent, openConnect's
  lock), so switching MultiConnect types keeps the channel length, gap and direction, and an
  openConnect slot turned into a MultiConnect one keeps its direction. For the same reason a slot
  only counts as "(edited)" when one of those fields differs; a screw preset is a whole fastener,
  replaces everything and compares every field.
- Keys: `3` switches here (App.jsx); inside the tab `Delete`/`Backspace` removes the selected holes,
  the arrows nudge them (below) and `Escape` deselects (or closes the import), same local-listener
  arrangement as the Bench.
  Exports are `<name>_holes.stl` / `<name>_holes.scad` via `benchName.js`'s `exportFilename()`,
  the name being the sidebar's field or the source's own stem (a mesh's file name minus its
  extension).
- **Handles** (`src/lib/holeHandles.js`; the viewer side is "3D viewer" above). A single selected
  hole gets them once the mesh on screen is the current base's (a click on the old mesh would
  be at the old model's coordinates). A rectangle cutout has four edge and four corner handles
  in its own frame (`slotFrame()`'s `ex`/`ey`, turned by its spin); a round one four rim handles
  on the face's sideways and up (`slotFrame()` at spin 0, not `planeBasis()`'s arbitrary axes,
  so "right" and "top" in their labels are true and they line up with the nudge); screws and
  connectors are their hardware's size and get none. Every hole has a round centre handle that
  moves it, listed first so it draws under the others and a small hole's edge handles stay
  grabbable. All of them are constrained to the hole's face plane, `handleMode="anchored"`, and
  every edge handle is a Tab stop; corners and the move handle are pointer-only. Ids are
  prefixed with the hole's id, so the viewer never takes switching holes for one hole grown.
  The move handle sits over the very spot a click on the hole used to land, so a press on it
  that never becomes a drag is handed to the viewer's canvas click (`clickAt()`), modifiers and
  all: whatever a click on the canvas there would do happens (on the hole's own face, a click
  selects it and a Shift-click takes it out of the selection).
  Corners don't forward (they sit off the body, where a click would drill beside the hole).
- **Resizing** keeps the opposite edge where it is (TinkerCAD's default): the hole's point moves
  by half the change. With Alt (Option) it grows about its centre. Sizes land on the Grid (Off:
  hundredths of a mm) and never go under 0.1 mm, the floor `normalizeSpec()` keeps; a pill stays
  a pill. One gesture reaches at most the model's diagonal or four times the hole's size,
  whichever is more (a move: the diagonal), so a flick past the edge of the view can't ask for a
  hole metres wide. A change commits like a sidebar edit of the hole —
  `setNextSpec(updateHole(doc, id, { spec, point }), spec, presetId)` — so the new size is also
  what the next click drills. The Option-held measurements are hidden while a handle is dragged
  (`onHandleStart`/`onHandleEnd`).
- **Moving.** The centre handle drags the hole across its face in whole Grid steps from where it
  was, along the face's sideways and up (Shift: freely); the ghost is its outline and a cross at
  the new spot, committed as one `updateHole(doc, id, { point })`. A spot off the face says "Off
  the face" while dragging, and a release there commits nothing and says, in the snap hint's
  place for a moment (`notice`), that the hole stayed. Only the centre is checked, on purpose: a
  cutout may hang over an edge to notch it, as one drilled near the edge or grown in the sidebar
  can. The arrow keys nudge the selected holes the same way, one Grid step (0.5 mm with the Grid
  off; Shift ten), and refuse with a notice when a hole would leave its face (and do nothing
  while the mesh on screen is an older base's); a run of presses is one undo step
  (`nudge:<ids>`).
- **"Still on its face?"** (`movedOnFace()`) is asked first of the base without holes —
  `renderHoled()` returns it alongside the holed mesh, and `stlProbe()` parses it once per
  buffer, the first time a hole moves — since on the mesh on screen a hole's own bore sits at its
  old spot, and a step shorter than its radius would land in it and read as off the model. A face
  only the holes made (a pocket's floor, which `holeAtSpot()` lets a click drill into) is
  asked of the mesh on screen instead, a spot inside the hole's own bore counting when the face
  goes on just past the bore. Repeat keeps its probe on the mesh on screen. A probe buckets the
  mesh's triangles in a uniform grid the first time it is asked, since three.js raycasts test
  every triangle: over a 156k-triangle Gridfinity baseplate one probe took 7.6 ms, and a 20-hole
  pattern's nudge outlasted the key repeat.
- **The Grid** for placement is the same setting as the handles' (`uiPrefs.js`): the sidebar's
  Snapping section has it as `components/holes/GridField.jsx`, the viewer as its Grid select;
  both give up focus after a pick, so the next arrow key nudges the hole.
- The selection pill hangs below the selected hole's outline when the hole has handles
  (`holePillAnchor()`: down the face to the outline's bottom, then as far down the screen as an
  oblique view needs), so it doesn't cover the top edge and corners; the viewer keeps it inside
  the viewer. With several holes selected it sits over their middle, as before.
- **Undo.** `holesSession.js` records every change to the document, a new one (picking a model,
  the Library's Add Holes) and going back to the start picker ("Pick another model") included,
  and nothing clears it short of a reload; it skips an equal document cheaply (its small fields
  as JSON, the source field by field, mesh bytes by identity). Coalescing keys:
  `spec:<sorted ids>:<field>` (`spec:new:<field>` for the next hole's spec with nothing
  selected), `name`, `base:<param>`, `nudge:<ids>`, and `handle:<id>` for arrow steps on a
  handle. After an undo or redo the selection drops holes that no longer exist. A drag or typed
  size renders at once, arrow steps after the 250 ms debounce, with a "… · rendering…" ghost
  meanwhile; a commit whose render fails offers its Undo inside the error message, only while
  the document is still the one the commit made. `cachedHoled()` is the render's `cached`
  option, so an undo to anything rendered before shows at once. Every document the history
  keeps holds its mesh source's bytes, so a Flip toggled back reuses the grounded bytes that side
  already had (`meshSource()`) — fresh ones per press held another 25 MB each for a
  500k-triangle import.
- **Hover cost.** Every snap change under the pointer re-renders the tab, so the list rows
  (`HoleRow`) and `PresetPicker` are memoised with callbacks that keep their identity, and the
  guides array keeps its identity between renders. The big one was in the viewer: every marker
  rebuild disposed the old markers' materials first, and three.js deletes a shader program when
  its last material goes, so each hover that moved the snap highlight linked the marker program
  again. The old group now leaves the scene at once and is disposed a frame later, when the new
  materials hold the program: a profiled hover sweep (SwiftShader) went from about 316 program
  links to none, and its script time from 25.9 s to 0.5 s.

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
- **UI** (`components/bench/PresetsPanel.jsx`, and the start picker): on the empty Bench the saved
  presets head the start picker (Enter loads one; its Actions page deletes it), and "Import
  config…" and "Import STL / STEP / 3MF…" are its last rows — the palette's own file input, so
  the picker stays up until a file is chosen and shows a bad file's error itself; in a running
  bench's sidebar the panel has the name field + Save (reads "Replace" when the name is taken) and
  its own import button (`ConfigImportButton`, a button fronting a hidden file input), and
  "Download config" joins the STL/.scad buttons under Export. Both are in the command palette too. Loading over an existing
  bench and deleting a preset each ask first via `window.confirm` — the only two places the app
  uses it.

## User overrides (`src/lib/userOverrides.js`)

The browser side of the CLI's `foundry defaults`/`foundry settings` — see
[docs/OVERRIDES.md](../docs/OVERRIDES.md) for the resolution order (catalogue default -> saved override ->
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

The dev server opens on the landing page; the app is at `/app/`, the guides at `/docs/`. A
`/#mode=…` URL from before the move still lands in the app.

## Licensing note

`openscad-wasm` bundles OpenSCAD itself (GPL-2.0) compiled to WebAssembly. It's used here as an
external tool the browser fetches and runs, the same way the CLI shells out to the `openscad`
binary — no OpenSCAD source is copied into this repository. See the root `README.md` for the
project's own MIT license.

## Verification

```bash
npm test                       # unit tests, tests/unit/ (Node.js 22.12+)
npx playwright install chromium
npm run test:browser            # builds and tests the production app in Chromium
```

The browser suite covers stale-download prevention, printer-setting changes,
worker recovery and cancellation, export preservation during edits, Bench tab/URL
restoration, the existing config round trip with an embedded mesh, and the resize
handles and undo in each tab (`library-handles.spec.js`, `bench-handles.spec.js`,
`holes.spec.js`: drags, arrow steps, the size box, Esc, the guard, touch). Every fake
Worker in it ignores the `{ type: "warm" }` message (see "Warm-up"). Most UI
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
