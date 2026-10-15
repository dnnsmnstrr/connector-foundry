# Bench

The web app's Bench tab: attaching parts with joints, importing meshes, exporting, configs and presets. Back to the [README](../README.md).

The web app's Bench tab is a visual editor. Pick a base part, click a slot marker, attach a part
with a joint, repeat. A part that still has an open anchor after attaching (a Basics plate, any
grid) offers it as a new marker, so assemblies stack. A bench takes up to three attached parts. Each
attached part has:

- **Joint** and **Offset (mm)** — negative sinks it into its parent, positive leaves a gap.
- **Shift X / Y (mm)** — slide it sideways on its slot, across the mating face. The two axes are
  the slot's own and turn with the part's rotation, so a correction stays right whichever way the
  part is then turned. Made for an imported STL whose chosen face center isn't quite over the
  feature that should sit on the slot (a buckle whose plate runs further to one side of its
  prongs); catalogue parts put their own `mount` over the right feature already.
- **Rotation (°)** — turn it on its slot. Click a part in the scene (or its name in the sidebar) to
  select it; ↺/↻ buttons above it turn it in 90° steps, the field takes any angle. Only the part
  turns, never a joint's flanges. Parts whose place in the scene can be computed (catalogue parts
  on top slots) are clickable; imported or side-mounted ones are selected from the sidebar.
- **Move** and **delete**, from the same controls over the selected part. "Move" (or `M`) arms a
  move: the next open slot marker clicked is where the part goes — another slot on the same part or
  a free anchor on a different one — taking its joint, rotation, and anything stacked on it along.
  The arrow keys step it straight to the next open slot in that direction on the base part, no
  arming needed. The trash button, `Delete`, or `Backspace` removes it (and anything attached to
  it); `Esc` cancels a move or drops the selection.
- **Crop** — trim everything else to this part's vertical outline. A plate a few millimetres wider
  than the base it sits on, a bracket whose corner pokes past the rail: turn on Crop for the base
  (the "Crop everything else to this outline" box in the sidebar's root section, or the Crop button
  over a selected part) and whatever sticks out past its footprint, straight up or down, is cut
  away — in the preview and in every exported body. Only the outer outline counts: a grid of holes
  or a screw hole in the cropping part is not cut through the others. One part crops at a time; the
  part itself and a joint's flanges are never trimmed, only what overhangs.
- Its own **parameter editor**, with the same defaults/overrides as the Library. A part attached
  to another may start from different values than the same part on its own (the catalogue's
  `attached_defaults`): the openConnect and MultiConnect snaps attach as their head alone
  (`body: none`), the thing you fuse onto a plate to hang it, while the version picked as a base
  keeps its snap body. A saved user default for the parameter still wins. The openConnect head
  also starts turned so its slide direction points up when it lands on a side face, the way it
  hangs on a wall (the catalogue's `attached_up`); the Rotation field turns it from there.

**STL, STEP and 3MF import** bring in any part — a Mechanism or Printables download, a supplier's
CAD file, a slicer project's model — as a Bench part: click a flat face to put a slot at its centre.
A STEP file is converted to a mesh in the browser (OpenCASCADE compiled to WebAssembly, in
millimetres whatever unit the file declares); a 3MF is unpacked and scaled by its declared unit;
one that holds several bodies asks which to use. Meshes are validated and repaired on
the way in (welded, winding fixed) and refused with an explanation if they have real holes. Imports
live in your browser tab only; nothing is fetched or committed.

Export walks the whole tree: one STL per body, or the generated `.scad`. Every exported file is
named after the bench — `<name>_<body>.stl`, `<name>.scad`, `<name>.bench.json` — so a downloads
folder full of them says what each one is. The **Name** field at the top of the sidebar sets it;
a bench exported without one is asked first, with a name built from its parts proposed
(`gridfinity-base_gopro-female`).

**Configs and presets** keep a bench setup itself: "Download config" writes a `.bench.json` (parts,
parameters, joints, offsets, rotations, and any imported meshes embedded, so the file stands alone),
"Import config…" loads one back, and "Presets" saves the same document under a name in your browser
to reopen later — from the sidebar of a running bench or from the start screen. The bench also
stays put when you switch to the Library and back, and lives in the page URL, so a reload (or the
link, pasted elsewhere) brings it back — imported meshes excepted, which only the tab that uploaded
them has; use a config file to move those.
