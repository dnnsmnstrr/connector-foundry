// DeckMate "Innie" — Mechanism's Universal Grip, the socket half of the
// DeckMate interface (the side an accessory's rail slides into),
// wrapped as-is.
//
// This repo models no DeckMate geometry of its own (a hand-guessed
// dovetail was confirmed wrong against a real part and now lives in
// Basics as a generic dovetail — see parts/basics/dovetail_rail.scad).
// The three parts in this directory are Mechanism's published STLs
// (getmechanism.com/pages/digital-files, CC BY-NC 4.0 — NOT MIT, see the
// README's "Licensing"), imported unmodified and given this repo's slot
// convention so they compose with everything else here.
//
// Orientation is the file's own, which already matches the convention:
// the DeckMate socket hangs below a 2mm plate and is the functional face
// at BOTTOM; the flat back — where Mechanism puts the adhesive, and
// where a printed connector fuses on instead — is TOP, with "mount" at
// its center. "bot" marks the center of the socket side's bounding box
// (it floats over the socket recess, not on material; it's there so the
// socket face is addressable from the Bench, not because anything mates
// to that exact point). This part has no screw pattern — see outie.scad
// and universal.scad for the two that do.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>

// The mesh's bounding box in its own coordinates, measured once with
// trimesh and restated here because OpenSCAD cannot measure an import():
// attachable() needs the size up front, and the file's geometry sits far
// from the origin (y ~ 326, z ~ -19), so it is recentred by exactly this
// much. tests/test_anchors.py renders every face anchor against the real
// geometry, so these cannot drift from the file without failing.
DM_INNIE_BBOX_MIN = [-17.650327682495117, 308.703857421875, -22.030094146728516];
DM_INNIE_BBOX_MAX = [18.02832794189453, 344.38287353515625, -16.780000686645508];
DM_INNIE_SIZE     = DM_INNIE_BBOX_MAX - DM_INNIE_BBOX_MIN;   // ~ [35.68, 35.68, 5.25]
DM_INNIE_CENTER   = (DM_INNIE_BBOX_MIN + DM_INNIE_BBOX_MAX) / 2;

module deckmate_innie(anchor = BOTTOM, spin = 0, orient = UP) {
    anchors = [
        mount_anchor(DM_INNIE_SIZE.z / 2),
        named_anchor("bot", [0, 0, -DM_INNIE_SIZE.z / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = DM_INNIE_SIZE, anchors = anchors) {
        // Relative to this file, not the caller: OpenSCAD resolves an
        // import() against the file the statement is written in, so this
        // works from the CLI's stub, a Bench-generated assembly, and the
        // GUI alike — and the web bundler ships the .stl next to this
        // file at the same relative path.
        translate(-DM_INNIE_CENTER) import("innie.stl", convexity = 4);
        children();
    }
}
