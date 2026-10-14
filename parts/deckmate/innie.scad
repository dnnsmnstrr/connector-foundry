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
include <../../lib/constants.scad>
include <../../lib/slots.scad>

// DM_INNIE_SIZE / DM_INNIE_CENTER (the mesh's bounding box, which
// attachable() needs up front and an import() can't report) live in
// lib/constants.scad, shared with lib/deckmate.scad's socket cutter.

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
