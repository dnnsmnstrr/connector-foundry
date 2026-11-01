// A single BitBeam pin for attaching a part to a BitBeam hole. `length`
// is measured in 8mm units, so the default projects one unit from the
// mating face. Its simple forked ends follow BitBeam's published pin
// dimensions and flex into the hole without fine Technic ridges.
//
// Functional face is BOTTOM; `mount` is on TOP. Attaching the mount to
// a part leaves the pin projecting one unit below it.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/bitbeam_pin.scad>

$fa = DETAIL_FA;
$fs = DETAIL_FS;

module bitbeam_half_pin(length = 1, friction = true, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length >= 1, "bitbeam_half_pin: length must be at least one BitBeam unit");
    len = length * BITBEAM_UNIT;
    dia = friction ? BITBEAM_PIN_WIDE_DIA : BITBEAM_PIN_NARROW_DIA;
    size = [dia, dia, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(len / 2)]) {
        translate([0, 0, -len / 2]) bitbeam_pin_geometry(len, friction);
        children();
    }
}
