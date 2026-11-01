// A single BitBeam/Technic-compatible friction pin half for attaching
// parts to a BitBeam hole. `length` is measured in BitBeam units (8mm),
// so the default protrudes exactly one unit from the mating face.
// Geometry comes from vendor/technic.scad (cfinke, MIT), with its
// Technic-sized friction ridges and collar.
//
// Functional face is BOTTOM; `mount` is on TOP. In the Bench, attaching
// the mount to a part leaves the pin projecting one unit below it.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../vendor/technic.scad/Technic.scad>

$fa = DETAIL_FA;
$fs = DETAIL_FS;

module bitbeam_half_pin(length = 1, friction = true, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length > 0, "bitbeam_half_pin: length must be positive");
    len = length * BITBEAM_UNIT;
    size = [technic_pin_collar_diameter, technic_pin_collar_diameter, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(len / 2)]) {
        translate([0, 0, -len / 2]) technic_pin_half(length = length, friction = friction);
        children();
    }
}
