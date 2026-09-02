// BitBeam beam: a LEGO Technic-compatible strip, `len` holes long,
// BITBEAM_UNIT (8mm) square in cross-section, holes on BITBEAM_UNIT
// pitch through top/bottom and (by default) front/back too. Geometry
// comes from vendor/bitbeam-lib's cube_arm() — see lib/constants.scad's
// "BitBeam" section for why this is vendored rather than modelled here,
// and catalogue.yaml's source field for the licence story.
//
// Functional face is BOTTOM, same as everything else in this catalogue,
// though a beam has no strong top/bottom of its own — it's a symmetric
// bar. Prints flat, no supports needed either way up.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>
include <../../vendor/bitbeam-lib/bitbeam-lib.scad>

// Reassign the vendored library's own globals from this repo's
// constants rather than relying on them already agreeing (they do,
// today) — so BITBEAM_UNIT/BITBEAM_HOLE_DIA stays the one place that
// actually controls every BitBeam part's size, beam included.
unit = BITBEAM_UNIT;
hole = BITBEAM_HOLE_DIA;

module bitbeam_beam(len = 5, side_holes = true, skip = [], skip_side = [],
                     anchor = BOTTOM, spin = 0, orient = UP) {
    size = [BITBEAM_UNIT * len, BITBEAM_UNIT, BITBEAM_UNIT];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([-BITBEAM_UNIT * (len - 1) / 2, 0, 0])
            cube_arm(len, 1, side_holes, skip, skip_side);
        children();
    }
}
