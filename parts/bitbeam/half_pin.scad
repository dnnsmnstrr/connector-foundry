// Compatibility wrapper for saved benches that still name
// bitbeam/half-pin. The mount end stays solid; only its exposed tip is
// forked, matching the public bitbeam/pin part.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/bitbeam_pin.scad>

$fa = DETAIL_FA;
$fs = DETAIL_FS;

module bitbeam_half_pin(length = 1, friction = true, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length >= 0.5, "bitbeam_half_pin: length must be at least half a BitBeam unit");
    len = length * BITBEAM_UNIT;
    dia = friction ? BITBEAM_PIN_WIDE_DIA : BITBEAM_PIN_NARROW_DIA;
    size = [dia, dia, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(len / 2)]) {
        translate([0, 0, -len / 2]) bitbeam_pin_geometry(len, false, friction);
        children();
    }
}
