# Holes

The web app's Holes tab: where a hole snaps, every preset it cuts, and the print options. Back to the [README](../README.md).

The web app's Holes tab puts screw holes into a model. For custom Gridfinity storage, start from
`gridfinity/bin` with `filled` on: a bin solid up to its stacking lip, whose flat top takes any
cavity cut below — a tool's outline from rounded rectangles, magnet pockets, a 2020 socket. Start —
in the picker that floats over the empty tab, the command palette's list (`Esc` puts it away,
Cmd/Ctrl+K brings it back; a model file dropped on it or on the empty tab is imported) — from a
catalogue part (its
parameters stay editable under a toggle in the sidebar while you work), a mesh of your own (STL, STEP or 3MF), or the
bench as it stands, then click a face: the
hole snaps to that face's significant points — its center, the center of each quadrant, the
center of any hole already through it, and a point set in from each corner (the inset is
adjustable; a plate with rounded corners gets its corner points where the sharp corners would be).
Hovering a face also draws guide lines — its center and quarter lines, a radial from the center
to each corner, and a circle of a radius you choose around the center: the crossings are snap
points (a bolt circle of up to eight), and a click near a line or the circle lands on it, so a hole
can go anywhere along the center line and still be exactly centered. Hold Option (or turn on
**Measure** in the 3D view's toolbar) to see the pointed-at spot's distances to the face's edges and
center, and the face's size; Shift-click places exactly where you click.

**On a touch screen** there is no hover and no Option key: a tap drills, and lands on a snap point or
guide within a fingertip's reach of it; **Measure** shows the distances from the spot you tapped, or
from the selected hole; turning **Snapping** off places freely; and pressing and holding a hole in
the list adds it to the selection, as Shift-click does.

Each hole has a diameter, a depth (or goes right through) and a head pocket — counterbore,
countersink (with its angle), or a hex pocket for a nut trap — from a preset or typed in. The
presets cover the usual suspects, each drawn as a cross-section so you can see what it cuts:
M2–M6 socket caps (ISO 4762), M3–M6 countersunk (ISO 10642), button heads (ISO 7380), heat-set
insert bores, thread-forming core holes for a machine screw straight into plastic, nut traps
(ISO 4032), wood screws and their pilots, a plain hole, a dowel, MagSafe charger and ring pockets,
and a **BitBeam / LEGO Technic pin hole** — a beam's own hole (Ø4.8 with the groove a pin's tip clicks into, `lib/pinhole.scad`,
checked against bitbeam-lib's beam), one beam (8 mm) deep with a groove at its bottom too, or through. Clearances are ISO 273 medium;
treat every one as a starting point for your printer and measure the first print. The presets are
grouped by kind under headings that open and close (closed but for the group of the preset in use,
and remembered), with a search box over them that matches names and groups; the command palette
(Cmd/Ctrl+K) finds them too — "m4 counter" and `Enter` — and so does its "Hole type…". A selected hole
can be edited on its own, and whatever screw was picked or edited last is what the next holes get.
Shift-click holes — in the list, or their rings in the scene — to select several: the editor then
shows the values they share (the rest say "mixed" until you set them) and a change applies to all
of them, a preset picked makes them all that kind, the quarter-turn buttons turn each slot from
its own direction, and Delete removes them all. Shift-click on a bare face still places a hole
exactly where you click.

**Resizing and moving a hole.** Select one hole and it gets handles in the viewer, as in
TinkerCAD. A round or rectangular cutout — the Generic shapes and the presets that cut one (USB
ports, memory cards, Skådis and MOLLE slots, disc-magnet and bearing pockets) — has small square
handles: drag an edge to resize it, and the opposite edge stays where it is; drag a rectangle's
corner to change its width and height together; hold Option (Alt) to resize from the centre
instead. Click an edge's handle (or Tab to it and press Enter) to type the size in mm (a corner
only drags); with a handle focused, the arrow keys grow or shrink it a Grid step at a time
(0.1 mm with the Grid off; Shift: ten steps). `Esc` cancels a drag. A resized hole is also what
the next click drills, as an edit in the sidebar is. Screws and connector slots keep their
hardware's size; every hole, those too, has a round handle in its middle: drag it to move the
hole across its face, in whole Grid steps from where it was (Shift: freely). A spot off the face says "Off the face", and the hole
stays. A cutout may still hang over the face's edge to notch it — only its centre has to stay on
the face. The arrow keys nudge the selected holes along their face by one Grid step (Shift: ten),
and refuse, with a note, a step that would take one off it.

The **Grid** — in the viewer's toolbar, the sidebar's Snapping section and Settings → Editing,
all one setting — is what those steps and sizes snap to, and where a click away from the snap
points lands: 0.5 mm unless you change it (0.1 to 5 mm); Off places, drags and sizes exactly
(an arrow key then nudges 0.5 mm).

**Undo.** Cmd+Z (Ctrl+Z on Windows and Linux) undoes any change — a hole drilled, resized, moved
or deleted, a field typed (one step per field), a Repeat, a new model and "Pick another model"
too — and Shift+Cmd+Z (Shift+Ctrl+Z or Ctrl+Y) redoes; so do the Undo and Redo buttons in the
viewer's toolbar, which say what they would undo. After "Pick another model" the start picker
offers Undo, and Cmd/Ctrl+Z works in its search straight away. The history keeps the last 100 steps and
lasts until the page reloads, through switches to the other tabs. `?` lists every shortcut.

**Repeat…** turns the selected hole into a pattern of the same hole on its face: a row (count,
spacing, across or up the face), a grid (holes and spacing both ways, every other row optionally
staggered half a step, or set to a **standard spacing**: Skådis, MOLLE rigid panel or MOLLE slit
panel) or a circle (count and radius round the hole's spot, the hole itself moving
onto the circle or staying in the middle). The copies are previewed in green; any that would miss
the face — past its edge, into another hole — are left out and counted, and afterwards the whole
pattern is selected to edit or delete together.

A **Skådis slot** preset (a 5 × 15 mm pill, 0.2 mm wider so a printed one takes moulded hooks)
with the grid's Skådis spacing (40 mm across, 20 mm up, staggered) turns any face into a Skådis
board, for Skådis hooks or `skadis/peg`. A circle can be filled with the same spacing instead of a
ring: every point of the pattern within its radius, centred on the selected slot.

The **MOLLE** presets do the same for MOLLE panels of any size or shape: a rigid panel's
**opening** (38.6 × 25.9 mm, as `molle/rigid_panel` cuts it, so `molle/insert` fits) with the MOLLE
rigid panel spacing (50.8 mm both ways), or a laser-cut panel's **slit** (30 × 5 mm, as
`molle/panel` cuts it) with the MOLLE slit panel spacing (38.1 mm across, 25.4 mm up).

Two **tripod nut trap** presets take a 1/4"-20 or 3/8"-16 hex nut (camera and tripod-head
threads), so any part screws onto a tripod; `camera/tripod_socket` prints the thread instead.

Two more preset groups cut **connector slots** rather than screw holes, so any part becomes a
custom mount for an openGrid board: an **openConnect** slot (the keyhole an `opengrid/openconnect`
snap's head slides into — upstream's own geometry, with its lock nub on the left, right, both
sides or neither, and its two clearances) and a **MultiConnect** slot (for an `opengrid/multiconnect`
snap or any Multiboard connector: a channel of the length you choose — one openGrid cell, 28 mm, by
default — running down from the round end the head rests in, with an on-ramp funnel at the entry
and the v2 detent, each optional). For an item that hangs on several heads one above the other, tick
"On-ramp every 28 mm" and make the channel a multiple of 28 mm: there is then a ramp one cell below
every seat, so the item goes onto all its heads at once and slides down one cell. A slot
has a direction on its face — the way the head travels to seat, "up" on the wall — which starts
pointing straight up on a vertical face (the part's own Y on one lying flat) and turns in the sidebar; the viewer draws each slot's outline, entry and an arrow
for it. The point you click is the openGrid cell centre for an openConnect slot (the head seats
3.6 mm up from it) and the round end for a MultiConnect one; an openConnect slot needs about 3 mm
of material under the surface, a MultiConnect slot about 4.5 mm.

The **openGrid thread** presets cut the other half of openGrid's screw connectors: the 16 mm,
3 mm-pitch female thread of upstream's threaded snaps, so the openConnect and MultiConnect snaps'
`body: screw` — the same head on a male thread instead of a snap — screws straight into the part.
It has a direction too: the thread starts where it has to for a screwed-home head to point that
way, so an openConnect head ends up with its slide direction up. "Full" is 8 mm deep for a
full-size screw (6.8 mm of thread), "Lite" 4.5 mm for a lite one; depth, through and the
clearance (upstream's 0.5 mm) are editable.

The **Generic shapes** cut a plain cutout of any size instead of a fastener's hole: a **round** one
(a diameter and a depth, or through) and a **rectangle** (width, height, depth, and a corner radius
— half the narrower side, or the "Pill" tick, makes it a pill with round ends). A rectangle has a
direction like a slot: its height runs up the face unturned, and it turns in the sidebar.
The **USB ports** presets are rounded-rectangle openings for USB-C, USB-A, Micro-USB, Mini-USB and
USB-B, each the receptacle's metal shell plus 0.35 mm a side, for a port that sits at the opening.
USB-C and USB-A also come as "room for the plug": wide enough for the plug's moulded grip at the
spec's maximum, for a port set back behind a wall. The **Memory cards** presets are slots: through
slots for an SD or microSD card in a case, and holder slots that stand an SD, miniSD, microSD,
CompactFlash or CFexpress Type A / Type B (XQD) card on its short edge, half its length deep, for
printing a card holder (Repeat a row of them). All of them are rectangles, so they turn, get a
chamfer and take any other size like one.
The **KLIPPT** presets cut a KLIPPT clip's own channel (`lib/klippt.scad`, from FH's clip, CC BY-SA
4.0), so the part slides onto a `klippt/base` the way a KLIPPT clip does: its lips, the gap the
base's flange slides into and its lock are the clip's. Click where the seated base's centre goes;
the arrow is the way it slides in. "Pocket" adds a drop-in pocket at the entry, for a channel in
the middle of a face; "Run-out" leaves the entry open instead, with a lead-in of the length you
choose, for one cut at an edge. A KLIPPT clip grips the base's neck by bending its lips, which a
rigid part can't, so the channel is cut with a **clearance** (0.3mm a side by default) that moves
each side out: the base then seats free, with a small bump at the entry to hold it in, and the lock
still stops it. 0 cuts the clip exactly; 0.45 and up slides freely. references.yaml checks a base
in it: free in the pocket, free seated at 0.3, gripped just as by the clip at 0.

The **DeckMate** preset cuts a DeckMate Innie's own socket (`lib/deckmate.scad`, from Mechanism's
Innie, CC BY-NC 4.0) 3.25 mm into the part, so a DeckMate Outie (`deckmate/outie`, or one on an
accessory) goes into the part the way it goes into an Innie, with no 2 mm plate standing proud of
the face. Its lips, the undercut behind them and the ends of its walls are the Innie's; past the
Innie's outline, a notch either side clears the ends of the Outie's rail, which on an Innie stand
out in the air. Click where the Innie's centre goes; push the Outie in there and slide it 2 mm the way the
arrow points to seat it. Seated in an Innie, the Outie's rail meets the plate with no room to spare,
so a print a hair thick won't go all the way in: the floor is cut 0.3 mm deeper than the Innie's by
default (**Extra depth**; 0 is the Innie exactly), the lips left as they are. It needs a face about
38 mm across and prints best on one that is up, as an Innie prints back down. references.yaml checks an Outie in it: in on the way down, and seated.

The **Magnets & bearings** presets are round pockets for 6×2, 8×3 and 10×3 mm disc magnets, a
25×4.5 mm pot magnet and a 608 bearing, each 0.2 mm over in diameter and depth. The pot magnet
also comes with an M4 clearance hole through the pocket's floor, for the screw through its
countersunk centre.

The **MagSafe** presets make any face hold a phone. **MagSafe charger puck** is a pocket Apple's
MagSafe charger sits in flush (Ø56.3 × 5.5 mm: the 15 W puck's 55.92 × 5.29 mm, 0.4 mm over across
so it lifts out again; the slimmer 25 W puck sits a little lower in it), with a channel for the
cable, which leaves the puck's rim at its back: 5 mm wide, as deep as the pocket and running 30 mm
past the rim, the way the arrow points — turn it towards the edge the cable should leave by, and
check the width against your cable's strain relief. **MagSafe metal ring** (56 × 46 × 1 mm) and
**MagSafe ring sticker** (55 × 45 × 0.55 mm) are grooves for the rings sold to make a case
MagSafe-compatible, with the middle left standing; glue or press the ring in and a MagSafe phone
or case holds on to the part. Each is 0.2 mm over across (the middle 0.2 under) and 0.2 mm deeper,
as the magnet pockets are. The **Insert** menu switches a pocket between puck and ring, bringing
that insert's usual size along; a ring's inner diameter of 0 cuts the whole disc, for a steel
disc. Magnet rings come in the same outlines, 1.5 or 2.5 mm thick: set the depth to match.
`magsafe/mount` is the same pocket on a round plate of its own.

Two print options go on the holes they make sense for. **Chamfer** (round, rectangle and 2020
cutouts) bevels the opening at 45°, as a lead-in and to absorb the flared first layers of a hole
printed opening-down. **Teardrop on walls** (round and screw holes, and the 2020 socket's bolt hole)
cuts a hole in a wall with a 45° point at its top, so it prints without the top sagging; a screw
hole's counterbore goes teardrop with it and a nut trap stands on a corner. "Up" is the model's +Z,
the way it prints, and a hole in a face lying flat stays round. Picking another preset keeps both.

The **2020 extrusion** presets cut a socket that the end of a 20-series aluminium extrusion pushes
into along the hole, so a length of rail stands in the part: the 20 mm square plus a clearance
(0.15 mm a side), 15 mm deep by default, and — "Keyed" — a key into each of the rail's four slot
mouths so it can't turn ("Plain" leaves the square bare). The keys are the end cap's, and
references.yaml's `extrusion2020/rail-in-holes-socket` checks NopSCADlib's E2020t into it with
no interference. Tick "M5 bolt hole" to also cut an M5 clearance hole (Ø5.5) from the socket's
floor out through the far side, for a bolt into the rail's centre bore (tapped M5 on most
20-series profiles) that pulls it down onto the floor; a through socket has no floor, so it gets
none. Click the rail's axis; depth, through, clearance and direction are editable.

Export the result as an
STL, or as `.scad` — `difference() { part; holes }` over the same sources, so it keeps working
with a native OpenSCAD. **Print with EasyPrint…** shares or saves the STL (or a 3MF) and opens
Prusa's EasyPrint, to print it from a phone ([Getting started](GETTING_STARTED.md#print-from-a-phone-with-easyprint)).
