// DeckMate "Outie" — Mechanism's "Bot Print", the rail half of the
// DeckMate interface (the male dovetail an Innie's socket slides onto),
// wrapped as-is. See innie.scad's header for provenance and licence.
//
// In the file the flat base plate is at the bottom and the rail rises
// from it; this repo's convention puts the functional face (the rail)
// at BOTTOM and the mounting face on TOP, so the mesh is turned over
// (180° about Y — which keeps every y coordinate, so the hole pattern
// below reads the same as measured).
//
// The base carries Mechanism's three-hole screw pattern (see
// DM_SCREW_HOLES in lib/constants.scad). "mount" sits at the pattern's
// reference point — the midpoint between the two side holes, 3.39mm
// off the base's own center — not at the bounding-box center, so that
// attaching mount-to-mount to anything else carrying the same pattern
// (universal.scad, lib/joints.scad's deckmate_screw_flange()) lines the
// holes up by construction. The holes are tapered: 4.45mm at the base
// face narrowing to 2.4mm where they exit on the rail side, i.e. a
// self-tapping hole for a screw driven from the base side, or a seat
// for an M3 heat-set insert pressed into the wide end. Nothing wider
// than 2.4mm passes through from the rail side.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>

// Bounding box of outie.stl in its own coordinates — see innie.scad for
// why this is restated and what checks it.
DM_OUTIE_BBOX_MIN = [47.536338806152344, 181.843505859375, -26.609174728393555];
DM_OUTIE_BBOX_MAX = [82.8399429321289, 208.3461151123047, -18.909175872802734];
DM_OUTIE_SIZE     = DM_OUTIE_BBOX_MAX - DM_OUTIE_BBOX_MIN;   // ~ [35.30, 26.50, 7.70]
DM_OUTIE_CENTER   = (DM_OUTIE_BBOX_MIN + DM_OUTIE_BBOX_MAX) / 2;

module deckmate_outie(anchor = BOTTOM, spin = 0, orient = UP) {
    anchors = [
        named_anchor("mount", [0, DM_OUTIE_PATTERN_Y, DM_OUTIE_SIZE.z / 2], UP, 0),
    ];
    attachable(anchor, spin, orient, size = DM_OUTIE_SIZE, anchors = anchors) {
        rotate([0, 180, 0]) translate(-DM_OUTIE_CENTER) import("outie.stl", convexity = 6);
        children();
    }
}
