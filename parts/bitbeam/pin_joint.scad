// Two-sided BitBeam pin used internally by the Bench's pin joint. Each
// half is one 8mm unit, so the default spans two aligned holes. Both
// forked ends follow BitBeam's published shape, without fine ridges.
//
// Functional face is BOTTOM; "mount" is on TOP. The Bench centers this
// whole pin on the seam between its two parts.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/bitbeam_pin.scad>

function bitbeam_pin_len(top_length = 1, bottom_length = 1) =
    (top_length + bottom_length) * BITBEAM_UNIT;

BITBEAM_PIN_LEN = bitbeam_pin_len();

module bitbeam_joint_pin(top_length = 1, bottom_length = 1, friction = true,
                         anchor = BOTTOM, spin = 0, orient = UP) {
    assert(top_length >= 1 && bottom_length >= 1,
        "bitbeam_joint_pin: each end is at least one BitBeam unit");
    len = bitbeam_pin_len(top_length, bottom_length);
    dia = friction ? BITBEAM_PIN_WIDE_DIA : BITBEAM_PIN_NARROW_DIA;
    size = [dia, dia, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(len / 2)]) {
        translate([0, 0, -len / 2]) bitbeam_pin_geometry(len, friction, friction);
        children();
    }
}
