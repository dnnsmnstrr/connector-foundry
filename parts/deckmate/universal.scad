// DeckMate "Universal" — Mechanism's Deck Mate Universal base plate,
// wrapped as-is. See innie.scad's header for provenance and licence.
//
// A 56.7 x 28.4 x 3mm plate an Outie screws onto: it carries the same
// three-hole pattern (2.98mm through, countersunk from the adhesive
// side), and a 41mm round recess on that same side for Mechanism's
// adhesive disc. In the file the countersinks and recess are at the
// bottom; this repo's convention wants the face things attach TO on
// TOP, so the mesh is turned over (180° about Y, which keeps every y
// coordinate): the adhesive side becomes "mount" — fuse it onto
// anything in place of the adhesive — and the pattern face becomes the
// functional BOTTOM with "bot" on it, where an Outie stacks on with the
// "screwed" joint (no flange needed: both sides carry the pattern).
//
// Both anchors sit at the pattern's reference point — the midpoint
// between the two side holes, 4.9mm off the plate's own center — so an
// Outie attached mount-to-"bot" lines its holes up with these by
// construction (see DM_SCREW_HOLES in lib/constants.scad).
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>

// Bounding box of universal.stl in its own coordinates — see innie.scad
// for why this is restated and what checks it.
DM_UNIVERSAL_BBOX_MIN = [-134.6640167236328, -12.609519004821777, -28.999176025390625];
DM_UNIVERSAL_BBOX_MAX = [-77.95797729492188, 15.790480613708496, -25.999176025390625];
DM_UNIVERSAL_SIZE     = DM_UNIVERSAL_BBOX_MAX - DM_UNIVERSAL_BBOX_MIN;   // ~ [56.71, 28.40, 3.00]
DM_UNIVERSAL_CENTER   = (DM_UNIVERSAL_BBOX_MIN + DM_UNIVERSAL_BBOX_MAX) / 2;

module deckmate_universal(anchor = BOTTOM, spin = 0, orient = UP) {
    anchors = [
        named_anchor("mount", [0, DM_UNIVERSAL_PATTERN_Y,  DM_UNIVERSAL_SIZE.z / 2], UP,   0),
        named_anchor("bot",   [0, DM_UNIVERSAL_PATTERN_Y, -DM_UNIVERSAL_SIZE.z / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = DM_UNIVERSAL_SIZE, anchors = anchors) {
        rotate([0, 180, 0]) translate(-DM_UNIVERSAL_CENTER) import("universal.stl", convexity = 4);
        children();
    }
}
