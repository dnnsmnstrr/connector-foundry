// A single BitBeam pin for attaching a part to a BitBeam hole. `length`
// is measured in 8mm units, so the default projects one unit from the
// mating face. Only the projecting tip is forked; the mount end stays
// solid so it can attach cleanly to another part.
//
// Functional face is BOTTOM; `mount` is on TOP. Attaching the mount to
// a part leaves the pin projecting below it.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/bitbeam_pin.scad>

$fa = DETAIL_FA;
$fs = DETAIL_FS;

module bitbeam_pin(length = 1, friction = true, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length >= 0.5, "bitbeam_pin: length must be at least half a BitBeam unit");
    len = length * BITBEAM_UNIT;
    dia = friction ? BITBEAM_PIN_WIDE_DIA : BITBEAM_PIN_NARROW_DIA;
    size = [dia, dia, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(len / 2)]) {
        translate([0, 0, -len / 2]) bitbeam_pin_geometry(len, false, friction);
        children();
    }
}
