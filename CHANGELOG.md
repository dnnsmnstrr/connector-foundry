# Changelog

What changed in each release of Connector Foundry: the web app, the desktop apps, the CLI and the
parts themselves. The desktop downloads are on the
[releases page](https://github.com/dnnsmnstrr/connector-foundry/releases); the web version always
runs the latest `main` at https://dnnsmnstrr.github.io/connector-foundry/app/.

## Unreleased

### Website

- **A landing page** at https://dnnsmnstrr.github.io/connector-foundry/ that shows what Connector
  Foundry does: real catalogue parts from Gridfinity, openGrid, the Honeycomb Storage Wall,
  DeckMate, KLIPPT and GoPro joining in 3D (drag to turn them), the Library's resize handles, the
  Bench's five joints and the Holes tab's snapping to try out on the page — the resize and
  command palette demos run the app's own code, and Cmd/Ctrl+K opens that palette anywhere on
  the page — the whole parts gallery with a filter by system, and the downloads for your
  computer.
- **The web app moved to `/app/`**: https://dnnsmnstrr.github.io/connector-foundry/app/. Links
  from before — a shared bench, a bookmark of a tab — are forwarded there, bench and all. The
  desktop app is unchanged.
- **Guides**, on the website and in `docs/`:
  [getting started](https://dnnsmnstrr.github.io/connector-foundry/docs/getting-started/),
  [installing the desktop app](https://dnnsmnstrr.github.io/connector-foundry/docs/desktop/) and
  [the command line](https://dnnsmnstrr.github.io/connector-foundry/docs/cli/) are new; the Bench,
  Holes, Joints, user overrides and accuracy pages are on the website too. They are the Markdown
  files in `docs/`, so GitHub shows the same text.
- **The guides and the website from the app**: **Open the guides** in the command palette (type
  `docs`) and the **Guides** link at the top of Settings open them in a new tab — from the desktop
  app, in your browser. Each guide is in the palette too, by its name (type `holes guide`), and
  **Open the website** goes to the landing page.

### New systems and parts

- **MOD-GRID** (by 3dedc / TinyToolShop, CC BY-NC-SA 4.0): the grid, any number of holes each
  way; the pin its accessories snap in with — the designer's 2x1 pin, or a single peg for one
  hole — to fuse onto any part on the Bench so it plugs into a MOD-GRID grid; and a bit holder for
  4mm hex, 1/4" ("6mm") hex or Leatherman flat bits, one or more grid rows long. Rebuilt from the
  designer's own files and checked against them.

## 0.3.0 — 2026-10-16

### Command palette

- **Cmd/Ctrl+K** (or the new **Search** button) opens a command palette, as in Raycast: type a
  few letters to switch tabs, open Settings, set the grid or the circle detail, find a part (and
  open it in the Library, the Bench or Holes), pick a hole type, attach a part, export, undo,
  change the view, or open the GitHub page — or Layerling, on its own, as a bookmark. The first
  letters of words work too — `oib` is **Open in Bench** — and what you ran lately comes first.
  Each row shows its key where it has one. `Enter` runs a command, `Cmd/Ctrl+Enter` and
  `Alt/Option+Enter` its second and third actions (a part: open it in the Bench, or drill holes
  in it; a link: copy it), `→` lists all of them, `Esc` clears, goes back, then closes.
- **The part pickers float over the workspace**: starting a bench, starting in Holes and
  attaching a part are the same searchable list, with each part's picture, over the scene
  instead of a page of their own. `Esc` puts one away and `Cmd/Ctrl+K` brings it back; typing in
  it finds the app's other commands too. Attaching keeps the slot you clicked in view, with the
  joint beside the search.
- **Drop a model file to import it**: an STL, STEP or 3MF dropped on a part picker is imported
  there — as the base part, onto the slot being attached to, or as the model to drill. The empty
  Bench and Holes tabs take a dropped file too, and so does `Cmd/Ctrl+K` over a running bench or
  a model in Holes, which starts again on the file (it asks first, and Undo goes back).
- **Your own commands and hotkeys** — a part with your parameters in a tab, a bench preset, a
  hole type, a link — can be added to an exported settings file by hand, with an alias to type
  and a Cmd/Ctrl+Shift hotkey; an editor for them will follow. See the web app's README.

### Editing

- **Resize handles**, as in TinkerCAD: the part in the Library, and the base part on the Bench,
  get small square handles to drag. An outline shows the new size, with a label ("W 126 mm · gx 3
  (+21 each side)"), and the part renders once, when you let go. Width and depth grow on both
  sides, so the part stays centred, height grows upward, and a corner changes width and depth
  together. `Esc` cancels a drag. Every part with a size to drag has them: the Gridfinity parts,
  openGrid and Skådis boards, HSW walls, MOLLE spines and panels, BitBeam, the Basics plate,
  post and dovetails, the Arca plate, the 2020 rail.
- **Type a size**: click a handle (or Tab to it and press Enter) to enter an exact size in mm —
  any but a corner, which changes two sizes and only drags. With a handle focused, the arrow
  keys step it (Shift: ten steps of a length); resting the pointer on one shows its size.
- **Grid**: lengths snap to it as you drag or step them — Off, or 0.1 to 5 mm (0.5 mm by
  default) — set in the viewer's toolbar or under Settings → Editing.
- **Undo and redo** everywhere: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z (or Ctrl+Y off the Mac), and
  Undo/Redo buttons in each viewer's toolbar that say what they would undo — a resize, a
  parameter typed (one step per field), a part switched, a part attached or removed, a hole
  drilled or moved. Each tab keeps its own history through tab switches, and the Bench's
  **Start over** and a loaded config, and Holes' **Pick another model**, can be undone too.
- **Keyboard shortcuts**: `?` (or **Keyboard shortcuts** at the top of Settings, or the command
  palette) lists every key, what the handles do, and the mouse, trackpad and touch controls —
  searchable: type "redo", "alt" or "bench delete" to see just those.

### Holes

- **DeckMate Innie socket**: cut Mechanism's Innie into any part, so a DeckMate Outie pushes in
  and slides along to seat. Its floor sits 0.3 mm deeper than an Innie's by default (an **Extra
  depth** field), so a printed Outie seats.
- Presets are **grouped under headings** that open and close, closed but for the group of the
  preset in use, with a **search box** over names and groups.
- **MOLLE** presets: a rigid panel's opening and a slit panel's slit, and the Repeat grid's
  standard spacings now include MOLLE rigid panel (50.8 mm both ways) and MOLLE slit panel
  (38.1 × 25.4 mm) next to Skådis.
- **Resize cutouts by dragging**: a selected round or rectangular cutout has handles on its
  edges (and a rectangle's corners). The opposite edge stays where it is; hold Option (Alt) to
  resize from the centre. Click an edge's handle to type the size.
- **Drag a hole to move it**, by the round handle in its middle, in Grid steps (Shift: freely),
  and **nudge** the selected holes along their face with the arrow keys (Shift: ten steps). A
  hole that would leave its face stays put, with a note saying why.
- A click away from the snap points lands on the **Grid** setting, 0.5 mm as before unless you
  change it, or exactly where you click with it Off; the Snapping section has the Grid too.

### Bench

- **Select the base part** by clicking it in the scene, or with **Select root** in the sidebar:
  its name, Crop and Deselect sit in the viewer's toolbar. It has resize handles (attached parts
  are resized in the sidebar for now), and they never take a slot from an attached part: such a
  size is skipped (2 → 4 cells on an openGrid board with a part on it), and the label says why.
- Selecting a part in the scene opens its parameters in the sidebar, and `F` frames it.

### Viewer

- A **Helpers** button (or `H`) hides the grid, markers, guides, labels and handles in every
  viewer, to see just the model.
- A toolbar in each viewer's corner: **Fit** (or `F`), a **View** menu (Home, Top, Front, Right),
  the Grid where it applies, and Helpers. The wheel **zooms toward the pointer**.
- Editing a part keeps the camera where you put it, backing out only when the part, or its
  handles, would leave the view.

### Settings

- **Export and import settings**: every preference, bench preset and part default as one
  `.settings.json` file, to move them to another browser or machine. Import replaces what is
  there, after a confirm.

### Parts

- **GoPro**: `leg_dia` sets the leg-end diameter (14 to 20 mm, standard 15) on both the male and
  female halves.
- **MOLLE**: the insert's boss is now `boss_w` × `boss_h` (38 × 25.3 mm by default, a tenth
  under the nominal 1.5" × 1"), and the rigid panel's openings are 0.5 mm over nominal so a
  printed insert fits.
- New minimums, the floors the modules already assert: Gridfinity bin `gz` 1, HSW wall and Skådis
  board `cols` and `rows` 1, Arca plate `length` 20. The sidebar field and the CLI now stop there
  instead of failing the render.

### Fixes

- A part option picked from a dropdown keeps its type: Skådis peg's **Pegs: 2** used to reach
  OpenSCAD as the text "2" and fail the render (and could be saved that way as a default).
- Keyboard shortcuts no longer act on the page behind an open dialog (Backspace with Settings
  open deleted the selected bench part) or with Cmd/Ctrl/Alt held.
- Holes: a slow **Use the current bench** no longer replaces a model picked in the meantime; a
  click while the base is re-rendering no longer drills at the old geometry; a revised mesh with
  the same file name no longer shows the previous render from the cache; a very large Skådis
  fill radius no longer freezes the tab; big flat faces (finely meshed imports) snap again; a
  click on the floor of a rectangular or round pocket drills into it instead of selecting the
  pocket; a Shift-click on a selected hole takes it out of the selection even where a snap point
  sits on it.
- Bench: **Start over** clears the old model; a `.scad` export error is shown instead of
  failing silently; stack markers and click targets are right for parts on side and bottom
  slots; a second STEP import is not overwritten by a slower first one; ←/→ on the focused
  sidebar edge no longer also step the selected part to another slot.
- Bench configs and shared links can no longer put arbitrary code into the generated `.scad`
  through part, slot or parameter names, and are checked for non-finite numbers and duplicate
  ids.
- A failing tab shows an error with **Try again** instead of a blank page; the 3D viewer
  releases its WebGL context when it closes.
- CLI: `foundry render` works from any directory; `foundry defaults` no longer overwrites a
  config file it cannot parse, and saved defaults for two parts can no longer share a file.

### Under the hood

- The OpenSCAD bundle the browser loads is a third smaller (only the files the parts actually
  include), the catalogue ships as JSON, and the console no longer logs a spurious error after
  every render.
- CI runs the desktop tests on Windows on every push, and the Pages deploy retries once.
- **Faster**: the render engine loads while the app is idle, and again after a render is
  abandoned, so the next render skips that (up to about half a second); hovering over a model in
  Holes no longer recompiles a shader each time the snap point changes; dragging the sidebar's
  edge, and a render starting or finishing, no longer re-render the whole tab; the 3D view's
  pixel ratio is capped at 2; an undo back to something already rendered, and typing the bench's
  name, show at once instead of rendering again.
- The catalogue's **`resize`** field says which parameter each of a part's handles drives and
  how much it grows the part (read by the web app only); `tests/test_resize.py` renders each entry
  one step on and holds the mesh to the outline the handle showed.
- Contributor and agent guide (`AGENTS.md`); Python is linted with ruff, the web app is
  type-checked (libraries, workers, components with JSDoc-typed props, hooks), `make check` runs
  every check that needs neither OpenSCAD nor a browser, and a schema test guards
  `catalogue.yaml`.

## 0.2.1 — 2026-10-10

### Holes

- **USB ports**: openings for USB-C, USB-A, Micro-USB, Mini-USB and USB-B, sized for a port that
  sits at the opening, and USB-C and USB-A with room for the plug, for a port set back behind a
  wall.
- **Memory cards**: through slots for SD and microSD in a case, and holder slots that stand an SD,
  miniSD, microSD, CompactFlash or CFexpress Type A / Type B (XQD) card half in, for printing a
  card holder.

### Library and number fields

- Number fields have their **arrow buttons** back: a step a click, half a step with Shift, and
  holding one repeats. The **scroll wheel** steps a focused field too, a tenth of a step with
  Shift.
- **Add Holes** next to Open in Bench takes the selected part, with its parameters, to the Holes
  tab.
- **`/`** jumps to the Library's part search from any tab.

## 0.2.0 — 2026-10-10

### New systems and parts

- **MOLLE / PALS**: a **spine** that slides behind backpack or vest webbing and clicks in under
  the bottom row, so any part can ride on MOLLE gear; a printed **slit panel** that takes MOLLE
  pouches, like a laser-cut panel; a **rigid panel** with open windows in a grid you set (count,
  size, corner radius, pitch), like the steel panels in trucks; and a **panel insert** that plugs
  into one window of a rigid panel and gives a face to bolt or fuse things onto. All parametric:
  measure your gear.
- **Skådis**: a board with IKEA Skådis's slot pattern, and a peg with one or two hook tabs to
  hang any part on a real board.
- **Honeycomb Storage Wall**: a wall panel and a clip-in insert, on geru's OpenSCAD libraries.
- **KLIPPT**: the base, plain and with screw holes, and a clip mount to fuse onto a part.
- **Camera**: an Arca-style quick-release plate and a 1/4"-20 or 3/8"-16 tripod socket.
- **openGrid connectors**: openConnect and MultiConnect snaps, each also with a screw body.
- **Gridfinity bin**, with compartments, lip, magnets and screws, and a filled option to cut your
  own cavities into.
- **DeckMate Outie**: a slim variant, from Mechanism's own Adhesive Puck.

### Holes — a new tab

A third tab, next to Library and Bench, drills into a catalogue part, an imported mesh or the whole
bench:

- Click a face to place a hole; clicks snap to the face's centre, its quarters, set-in corners and
  holes already there, with guide lines, a bolt circle and measurements on the face.
- 34 fastener presets drawn as cross-sections (ISO cap, countersunk and button-head screws,
  heat-set inserts, thread-forming holes, nut traps, wood screws and pilots), or type your own.
- Connector slots so any part mounts on something else: openConnect and MultiConnect slots, the
  openGrid thread, a 2020 extrusion socket keyed into the rail (with an optional M5 bolt hole), a
  BitBeam / Technic pin hole, a KLIPPT channel, a Skådis slot and tripod nut traps.
- Generic round and rectangle / pill cutouts; magnet and bearing pockets (including a 25 × 4.5 mm
  pot magnet); teardrop holes on walls; chamfered openings.
- **Repeat** a hole as a row, a grid (optionally staggered, with a Skådis spacing button) or a
  circle.
- Select several holes with Shift to edit what they share, turn slots in quarter turns, or delete
  them together.

### Bench and Library

- Import **STEP** files (and 3MF) on the Bench and in Holes, with a body picker for multi-body
  files.
- **Copy for Layerling**: paste a part or a whole bench into Layerling without an STL round trip.
- A sideways shift for attached parts, and benches are named before export, so files say what
  they are.
- An openConnect head attached to a side face starts with its slide direction up.
- The Library re-renders its preview as you change parameters, and neither Library nor Bench
  shifts its layout while a render runs.
- A global **circle detail** setting (draft, normal, fine); Gridfinity holes now come out round.
- Number fields take a comma or a period as the decimal separator and no longer jump to 0 while
  you type.
- The sidebar can be resized by dragging its edge.

### Part changes

- GoPro female: a symmetric option, "mount" over the middle prong, and `outer_w` sets the far
  prong's width, down to equal prongs.
- openGrid board: connector holes centred, and the lite and screw-mounting options now render in
  the browser.
- Flat plate: 42 × 42 mm with 4 mm corners by default (one Gridfinity unit), and every size now
  renders in the browser.

### Desktop

- **Windows**: an installer for 64-bit Windows, and one for Windows on ARM (Snapdragon laptops,
  Surface Pro), next to the macOS DMGs. Per-user install without an administrator prompt, removable
  from Settings → Apps.
- The header sheds its labels at narrow window widths.

## 0.1.1 — 2026-09-23

- macOS: the DMGs' names carry no version, so the latest download has a stable link, and the
  release holds only the DMGs.

## 0.1.0 — 2026-09-23

- First release: the web app (Library and Bench) as a macOS app for Apple Silicon and Intel.
