# Changelog

What changed in each release of Connector Foundry: the web app, the desktop apps, the CLI and the
parts themselves. The desktop downloads are on the
[releases page](https://github.com/dnnsmnstrr/connector-foundry/releases); the web version always
runs the latest `main` at https://dnnsmnstrr.github.io/connector-foundry/.

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

### Fixes

- Windows: the packaged-app test reads the clipboard's line endings as Windows writes them.
- CI tests against current OpenSCAD snapshots again.

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
