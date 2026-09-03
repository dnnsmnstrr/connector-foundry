// Four joint types for mating two parts through their "mount" slots.
//
//   fused  - attach() directly. One printed body. No module needed here;
//            just `parent() attach("mount", "mount") child();`
//   bolted - each side gets a flange fused onto its own mount face.
//            Side A carries an insert bore, side B a clearance hole, on a
//            shared 4-hole pattern, so the two printed bodies bolt
//            together after printing.
//   snap   - same idea, but side A carries barbed pegs and side B carries
//            matching holes, for a tool-free joint.
//   pin    - each side gets an IDENTICAL flange (just a BITBEAM_HOLE_DIA
//            bore), and the two flanges' bores line up face to face when
//            joined. Structurally different from the other three: the
//            fastener is a real bitbeam_pin (parts/bitbeam/pin.scad), a
//            separate THIRD printable body, not integral to either
//            flange — see pin_flange()'s own comment for why, and the
//            web editor's assembly.js for how body-splitting handles a
//            joint contributing more than the usual two bodies.
//   screwed - for a part that already carries Mechanism's DeckMate
//            three-hole pattern (parts/deckmate/outie.scad,
//            universal.scad). ONE flange, on the side that has no holes
//            of its own: deckmate_screw_flange(), heat-set insert bores
//            at the pattern, fused onto that side — the DeckMate part is
//            the other printable body and needs nothing added, its own
//            holes are the fastening. Two parts that both carry the
//            pattern (Universal + Outie) need no flange at all: they
//            attach directly and split into two bodies at the seam.
//            Exists so a DeckMate rail can be printed in its own best
//            orientation (or be Mechanism's own print) and fastened on,
//            instead of fused in whatever orientation the rest of the
//            assembly happens to print in.
//
// Bolted/snap/pin flanges are themselves attachable(): they consume the
// parent/child's "mount" anchor and expose their own "mount" anchor on
// the far face, so composition keeps working through a joint.
include <../vendor/BOSL2/std.scad>
include <constants.scad>
include <slots.scad>
include <util.scad>

JOINT_FLANGE_SIZE = 20;   // square flange, mm per side
JOINT_FLANGE_T    = 4;    // flange thickness
JOINT_BOLT_OFFSET = 6;    // bolt hole offset from flange center, each axis
JOINT_INSERT_R    = 4.0 / 2 + FIT_CLEARANCE; // heat-set insert bore, side A
JOINT_CLEARANCE_R = 3.4 / 2 + FIT_CLEARANCE; // bolt clearance, side B

JOINT_PEG_R      = 1.8;  // snap peg shaft radius
JOINT_PEG_BARB_R = 2.3;  // snap peg barb radius
JOINT_PEG_H      = 3.5;  // peg length above the flange face

// Thick enough for a proper BITBEAM_HOLE_DIA bore, same reasoning as
// parts/bitbeam/plate.scad's own minimum thickness — a plain
// JOINT_FLANGE_T (4mm) flange would leave the 4.8mm bore with no wall
// above or below it at all.
JOINT_PIN_FLANGE_T = BITBEAM_UNIT;

_JOINT_SIZE     = [JOINT_FLANGE_SIZE, JOINT_FLANGE_SIZE, JOINT_FLANGE_T];
_JOINT_PIN_SIZE = [JOINT_FLANGE_SIZE, JOINT_FLANGE_SIZE, JOINT_PIN_FLANGE_T];

// Bolted flange, side A: fuse onto the part that will hold heat-set inserts.
module bolted_flange_a(anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, size = _JOINT_SIZE, anchors = [mount_anchor(_JOINT_SIZE.z / 2)]) {
        difference() {
            cuboid(_JOINT_SIZE, rounding = 2, edges = "Z");
            corner_pattern([JOINT_FLANGE_SIZE, JOINT_FLANGE_SIZE], JOINT_BOLT_OFFSET)
                through_hole(JOINT_INSERT_R, JOINT_FLANGE_T);
        }
        children();
    }
}

// Bolted flange, side B: clearance holes for the bolts to pass through.
module bolted_flange_b(anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, size = _JOINT_SIZE, anchors = [mount_anchor(_JOINT_SIZE.z / 2)]) {
        difference() {
            cuboid(_JOINT_SIZE, rounding = 2, edges = "Z");
            corner_pattern([JOINT_FLANGE_SIZE, JOINT_FLANGE_SIZE], JOINT_BOLT_OFFSET)
                through_hole(JOINT_CLEARANCE_R, JOINT_FLANGE_T);
        }
        children();
    }
}

// Snap flange, side A: barbed pegs proud of the face.
module snap_flange_a(anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, size = _JOINT_SIZE, anchors = [mount_anchor(_JOINT_SIZE.z / 2)]) {
        union() {
            cuboid(_JOINT_SIZE, rounding = 2, edges = "Z");
            corner_pattern([JOINT_FLANGE_SIZE, JOINT_FLANGE_SIZE], JOINT_BOLT_OFFSET)
                translate([0, 0, JOINT_FLANGE_T / 2])
                    union() {
                        cylinder(r = JOINT_PEG_R, h = JOINT_PEG_H);
                        translate([0, 0, JOINT_PEG_H - 0.6])
                            cylinder(r1 = JOINT_PEG_R, r2 = JOINT_PEG_BARB_R, h = 0.6);
                    }
        }
        children();
    }
}

// Snap flange, side B: matching holes that the barbs press into.
module snap_flange_b(anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, size = _JOINT_SIZE, anchors = [mount_anchor(_JOINT_SIZE.z / 2)]) {
        difference() {
            cuboid(_JOINT_SIZE, rounding = 2, edges = "Z");
            corner_pattern([JOINT_FLANGE_SIZE, JOINT_FLANGE_SIZE], JOINT_BOLT_OFFSET)
                cylinder(r = JOINT_PEG_BARB_R + FIT_CLEARANCE, h = JOINT_FLANGE_T + 1, center = true, $fn = 24);
        }
        children();
    }
}

// Pin flange: fuses onto either side's mount face — unlike bolted's
// insert/clearance split or snap's peg/socket split, a pin joint's two
// flanges are IDENTICAL, just a single BITBEAM_HOLE_DIA bore through
// the center. Both flanges' bores end up face to face when the joint is
// assembled, forming one channel a real bitbeam_pin (a LEGO Technic pin,
// via vendor/technic.scad) slides into spanning the seam, collar in the
// seam — exactly how two beams pin together, just with a flange standing
// in for the beam's own body. The bore is a fixed nominal diameter, same
// as a real beam's hole; the pin's friction ridges do the gripping, as
// in any Technic hole, so there is nothing to tune here.
module pin_flange(anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, size = _JOINT_PIN_SIZE, anchors = [mount_anchor(_JOINT_PIN_SIZE.z / 2)]) {
        difference() {
            cuboid(_JOINT_PIN_SIZE, rounding = 2, edges = "Z");
            through_hole(BITBEAM_HOLE_DIA / 2, JOINT_PIN_FLANGE_T);
        }
        children();
    }
}

// Screw flange for the DeckMate pattern: the footprint of an Outie's
// base (DM_OUTIE_BASE) with the three holes (DM_SCREW_HOLES) bored
// through, as heat-set insert bores by default or bolt clearance with
// insert=false. Fuses onto the side of a joint that has no holes of its
// own; the DeckMate part screws onto it.
//
// Two named anchors, one per face, both at the PATTERN's reference point
// (0, DM_OUTIE_PATTERN_Y) rather than the flange's center — the same
// rule every DeckMate part follows, so whichever face meets the DeckMate
// part, mount-to-anchor puts hole on hole:
//   "mount" (TOP)    — toward the part this flange is fused to
//   "seat"  (BOTTOM) — toward the DeckMate part that screws onto it
// The bores go straight through, so the flange has no handedness; the
// codegen in web/src/lib/assembly.js uses "seat" for the DeckMate side
// whether that is the parent or the child.
_DM_FLANGE_SIZE = [DM_OUTIE_BASE.x, DM_OUTIE_BASE.y, JOINT_FLANGE_T];

module deckmate_screw_flange(insert = true, anchor = BOTTOM, spin = 0, orient = UP) {
    r = insert ? JOINT_INSERT_R : JOINT_CLEARANCE_R;
    anchors = [
        named_anchor("mount", [0, DM_OUTIE_PATTERN_Y,  _DM_FLANGE_SIZE.z / 2], UP,   0),
        named_anchor("seat",  [0, DM_OUTIE_PATTERN_Y, -_DM_FLANGE_SIZE.z / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = _DM_FLANGE_SIZE, anchors = anchors) {
        difference() {
            cuboid(_DM_FLANGE_SIZE, rounding = 2, edges = "Z");
            translate([0, DM_OUTIE_PATTERN_Y, 0])
                for (p = DM_SCREW_HOLES)
                    translate([p.x, p.y, 0]) through_hole(r, JOINT_FLANGE_T);
        }
        children();
    }
}
