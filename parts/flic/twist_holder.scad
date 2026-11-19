// Flic Twist holder: a shallow ring the Twist's stationary core stands in,
// so it stays put on a desk or a shelf while its ring turns. The mouth is
// BOTTOM, the functional face; "mount" is on TOP, the back. "bot" is the
// mouth's centre.
//
// Only the core's band below the turning ring is there to hold (see
// lib/flic.scad): `depth` is how much of it the ring's rim takes, and it
// stops at 3.2mm, half a millimetre short of the ring, so the ring never
// rubs. The rim can be wider than the ring for that reason. It holds by
// friction alone, which is enough to twist against; on a wall, glue the
// Twist in or use Flic's own wall mount.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/flic.scad>

FLIC_TWIST_MAX_DEPTH = FLIC_TWIST_RING_Z - 0.55;

module flic_twist_holder(wall = 2.5, floor = 2, depth = 3, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(depth > 0 && depth <= FLIC_TWIST_MAX_DEPTH,
           str("depth must be more than 0 and at most ", FLIC_TWIST_MAX_DEPTH, "mm, short of the turning ring"));
    pocket_d = FLIC_TWIST_CORE_D + 2 * FIT_CLEARANCE;
    pocket = circle(d = pocket_d, $fn = 128);
    outer_d = pocket_d + 2 * wall;
    h = depth + floor;

    attachable(anchor, spin, orient, size = [outer_d, outer_d, h],
               anchors = [mount_anchor(h / 2), named_anchor("bot", [0, 0, -h / 2], DOWN, 0)]) {
        translate([0, 0, -h / 2]) flic_cup(pocket, depth, wall, floor);
        children();
    }
}
