# Bench

The web app's Bench tab: attaching parts with joints, importing meshes, exporting, configs and presets. Back to the [README](../README.md).

The web app's Bench tab is a visual editor. Pick a base part, click a slot marker, attach a part
with a joint, repeat. Both pickers float over the workspace — "Start a bench" over an empty tab,
"Attach to …" over the scene, with the joint beside the search — and are the command palette's
lists: type a few letters of a part, a preset or a command, `Enter` picks, `Esc` puts the picker
away and Cmd/Ctrl+K brings it back. Drop an STL, STEP or 3MF file on either picker, or on the empty
tab, to import it there. Cmd/Ctrl+K on a bench also lists what the sidebar and the
scene's buttons do (Attach a part…, the exports, Start over, the selected part's Move, turn,
crop and remove). A part that still has an open anchor after attaching (a Basics plate, any
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

**Resizing the base part.** Click the base part in the scene, away from the parts on it (its
parameters open in the sidebar), or **Select root** beside its name in the sidebar: its name,
**Crop** and Deselect appear in the viewer's toolbar. Delete, Backspace, `M` and the arrow keys
leave a selected base alone — removing it would remove everything. A base part whose size the
catalogue knows (the Gridfinity parts, openGrid and Skådis boards, HSW walls, GOEWS tiles and
hanger plates, MOLLE panels, BitBeam beams and plates, Basics plates and posts, the 2020 rail…)
gets small square handles, as in TinkerCAD:

- **Drag** one to resize. An outline shows the new size, with a label like "W 126 mm · gx 3 (+21
  each side)", and the part renders once, when you let go. Width and depth grow on both sides, so
  the part stays centred, and height grows upward; a corner handle changes width and depth
  together. Counts move in their own steps (a Gridfinity unit, a grid cell, half a Skådis
  column); lengths snap to the **Grid** in the viewer's toolbar (Off, or 0.1 to 5 mm; 0.5 mm
  unless you change it — Settings → Editing has the same setting). `Esc` cancels a drag. A drag
  stops at sizes that still render in a few seconds in the browser and fit a large print bed
  (8 × 8 Gridfinity units, say); the sidebar's fields go further.
- **Click** a handle (or Tab to it and press Enter) to type an exact size in mm. A corner
  changes two sizes, so it has no box: it only drags.
- With a handle focused, the **arrow keys** grow (→ ↑) or shrink (← ↓) it a step at a time;
  Shift moves ten steps of a length. Resting the pointer on a handle shows its size.

A size that would take a slot away from an attached part is skipped, whether dragged, stepped
or typed into a handle's box: the handle goes on to the next size that keeps every part on its
slot — on an openGrid board with a part on it, 2 cells go to 4, since 3 would renumber every
slot — or, with none left that way, stops at the nearest size short of it (at worst where it
was), and the label says why ("3 would move attached parts"). A size typed into the sidebar's
parameter fields isn't caught this way; it shows as a render error, and Undo brings the old size
back.

Only the base part has handles for now. A selected attached part, or a base part whose size the
catalogue doesn't know, says "Resize in the sidebar": change its size in its parameters there.

**Undo.** Cmd+Z (Ctrl+Z on Windows and Linux) undoes any change to the bench — attaching,
moving, removing, a resize, a parameter typed (one step per field), Start over, a loaded config
or preset — and Shift+Cmd+Z (Shift+Ctrl+Z or Ctrl+Y) redoes. The Undo and Redo buttons in the
viewer's toolbar do the same and say what they would undo. After Start over the start picker
offers Undo, and Cmd/Ctrl+Z works in its search straight away. The history keeps the last 100 steps and
lasts until the page reloads, through switches to the other tabs; opening a bench link starts a
new one. While you are typing in a field, Cmd/Ctrl+Z undoes the typing.

`F` (or the Fit button) frames the selected part, or the whole bench with nothing selected, and
**View ▾** looks from the Top, Front, Right or the Home view; `?` lists every shortcut.

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
to reopen later — from the sidebar of a running bench, the start picker, or the command palette's
"Load a saved preset…". The bench also
stays put when you switch to the Library and back, and lives in the page URL, so a reload (or the
link, pasted elsewhere) brings it back — imported meshes excepted, which only the tab that uploaded
them has; use a config file to move those.
