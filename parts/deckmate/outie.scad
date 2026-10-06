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
//
// fill_holes=true plugs all three with solid material: for an Outie
// fused straight onto something (the Bench's "fused" joint) the holes
// are dead space nothing will ever be screwed into, and on the rail
// side they are three open mouths facing the Innie. Leave it off for
// the "screwed" joint, which needs them.
//
// slim=true is Mechanism's own slim Outie instead: the one its Adhesive
// Puck (printables.com/model/1337452, Mechanism's official release,
// same CC BY-NC 4.0) is built on, cut out of that file below the puck's
// plate. Same rail, same depth and height, but no ears for the side
// holes and the U's outer edge brought in — 30.6mm wide instead of
// 35.3mm — since nothing engages the outside of the U (the mating piece
// slots into its inside). Its holes are solid, so fill_holes does
// nothing to it and the "screwed" joint has nothing to screw into:
// it is for fusing onto something. The puck's U sits in exactly this
// part's frame once recentred, rail down as here (checked against
// outie.stl: the two coincide at zero offset).
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>

// Bounding box of outie.stl in its own coordinates — see innie.scad for
// why this is restated and what checks it.
DM_OUTIE_BBOX_MIN = [47.536338806152344, 181.843505859375, -26.609174728393555];
DM_OUTIE_BBOX_MAX = [82.8399429321289, 208.3461151123047, -18.909175872802734];
DM_OUTIE_SIZE     = DM_OUTIE_BBOX_MAX - DM_OUTIE_BBOX_MIN;   // ~ [35.30, 26.50, 7.70]
DM_OUTIE_CENTER   = (DM_OUTIE_BBOX_MIN + DM_OUTIE_BBOX_MAX) / 2;

// adhesive_puck.stl holds the puck (a 56.7 x 28.4 plate with the slim
// Outie's U under it, rail down) and, off to one side, the separate
// piece that slots into the U. The U's bounding box, from the rail
// face up to the plate's underside (DM_PUCK_U_BBOX_MAX.z), measured
// the same way as the box above; a box to that height and footprint
// cuts the U out of the file and leaves the rest.
DM_PUCK_U_BBOX_MIN = [-121.6103744506836, 89.6799087524414, -36.699188232421875];
DM_PUCK_U_BBOX_MAX = [-91.0103759765625, 116.18252563476562, -28.9992];
DM_PUCK_U_SIZE     = DM_PUCK_U_BBOX_MAX - DM_PUCK_U_BBOX_MIN;   // ~ [30.60, 26.50, 7.70]
DM_PUCK_U_CENTER   = (DM_PUCK_U_BBOX_MIN + DM_PUCK_U_BBOX_MAX) / 2;

// How far each hole runs down from the base face, in DM_SCREW_HOLES
// order (side, side, third) — measured off outie.stl the same way as
// the bounding box: the two side holes pass through the full thickness
// where the base is 7.7mm; the third exits 6.0mm down onto a step,
// through a slightly wider (2.9mm) mouth. tests/test_deckmate.py's
// fill_holes test probes near each hole's far end, so these can't drift
// from the file unnoticed.
DM_OUTIE_HOLE_DEPTHS = [DM_OUTIE_SIZE.z, DM_OUTIE_SIZE.z, 6.0];

// A plug is the hole's own taper widened by this much on the radius at
// each end, so its side lands inside the boss wall (solid to 3mm+ from
// every centre — what test_deckmate.py's BESIDE_R probe relies on) rather
// than on the hole's own surface, where coincident faces would leave a
// sliver. Its ends stay flush with the faces, so the footprint is
// unchanged. Sized against the file's actual mouths (4.57 / 2.4 and
// 2.9mm across), not just the nominal DM_OUTIE_HOLE_D_* figures.
DM_OUTIE_PLUG_R_BASE = DM_OUTIE_HOLE_D_BASE / 2 + 0.3;
DM_OUTIE_PLUG_R_RAIL = DM_OUTIE_HOLE_D_RAIL / 2 + 0.5;

module deckmate_outie(fill_holes = false, slim = false, anchor = BOTTOM, spin = 0, orient = UP) {
    size = slim ? DM_PUCK_U_SIZE : DM_OUTIE_SIZE;
    anchors = [
        named_anchor("mount", [0, DM_OUTIE_PATTERN_Y, size.z / 2], UP, 0),
    ];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        if (slim)
            translate(-DM_PUCK_U_CENTER) intersection() {
                import("adhesive_puck.stl", convexity = 6);
                // The U's footprint (a hair over, so its sides aren't cut
                // on their own faces) from below the rail to the plate.
                translate(DM_PUCK_U_BBOX_MIN - [0.01, 0.01, 0.01])
                    cube([DM_PUCK_U_SIZE.x + 0.02, DM_PUCK_U_SIZE.y + 0.02, DM_PUCK_U_SIZE.z + 0.01]);
            }
        else
            union() {
                rotate([0, 180, 0]) translate(-DM_OUTIE_CENTER) import("outie.stl", convexity = 6);
                if (fill_holes) _deckmate_outie_plugs();
            }
        children();
    }
}

// One tapered plug per hole, wide end up at the base face, in the part's
// own centered frame (the same frame DM_SCREW_HOLES + DM_OUTIE_PATTERN_Y
// place the "mount" anchor in, so the plugs land on the holes by the
// same construction that lines the pattern up with a flange).
module _deckmate_outie_plugs() {
    top = DM_OUTIE_SIZE.z / 2;
    translate([0, DM_OUTIE_PATTERN_Y, 0])
        for (i = [0 : len(DM_SCREW_HOLES) - 1]) {
            p = DM_SCREW_HOLES[i];
            depth = DM_OUTIE_HOLE_DEPTHS[i];
            translate([p.x, p.y, top - depth / 2])
                cyl(h = depth, r1 = DM_OUTIE_PLUG_R_RAIL, r2 = DM_OUTIE_PLUG_R_BASE, $fn = 48);
        }
}
