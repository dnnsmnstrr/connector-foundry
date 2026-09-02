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
// parts/basics/pinhole_plate.scad's own minimum thickness — a plain
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
// assembled, forming one channel a real bitbeam_pin slides into
// spanning the seam — exactly how two beams pin together, just with a
// flange standing in for the beam's own body. The bore is a fixed
// nominal diameter, same as a real beam's hole; all the fit tuning
// happens on the pin itself (bitbeam_pin's own FIT_CLEARANCE), not
// here, so there is one knob for grip, not two disagreeing ones.
module pin_flange(anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, size = _JOINT_PIN_SIZE, anchors = [mount_anchor(_JOINT_PIN_SIZE.z / 2)]) {
        difference() {
            cuboid(_JOINT_PIN_SIZE, rounding = 2, edges = "Z");
            through_hole(BITBEAM_HOLE_DIA / 2, JOINT_PIN_FLANGE_T);
        }
        children();
    }
}
