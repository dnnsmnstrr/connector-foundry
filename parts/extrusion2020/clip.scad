// 2020-extrusion snap-in clip. Two flexible legs, each with a barb near
// the tip, squeeze through EX_SLOT_OPEN on insertion and spring back out
// to EX_CHANNEL_W once past the lip — no end access needed, drops
// straight into the slot mid-rail.
//
// Functional face is BOTTOM: legs hang tip-first, in the direction they
// get pushed into the channel; spine and "mount" anchor sit on TOP. Each
// barb is a plain square nub near the tip — a printed part relies on the
// leg's own thinness to flex, not a molded cam ramp, so a square barb
// (sand or chamfer by hand if your printer needs an easier lead-in) keeps
// the CSG simple and reliably watertight.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module ex_clip(leg_y = 7, post_h = 8,
                anchor = BOTTOM, spin = 0, orient = UP) {
    blade_t   = 1.3;                          // single-leg flex thickness
    blade_h   = EX_CHANNEL_D - FIT_CLEARANCE; // fits within channel depth
    spine_h   = 2;
    barb_bump = 1.1;
    barb_h    = 2;                            // barb band height, tip-ward
    post_r    = 1.5;
    inner_x = (EX_SLOT_OPEN - 2 * FIT_CLEARANCE) / 2 - blade_t; // leg's inner face
    outer_x = inner_x + blade_t;                                // leg's plain outer face

    // Barb-to-barb span must clear the channel walls once sprung out.
    assert(2 * (outer_x + barb_bump) < EX_CHANNEL_W - 2 * FIT_CLEARANCE);

    total_h = blade_h + spine_h + post_h;
    size = [2 * (outer_x + barb_bump), leg_y, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        union() {
            for (side = [-1, 1]) {
                leg_x = side * (inner_x + blade_t / 2);
                translate([leg_x, 0, 0])
                    cuboid([blade_t, leg_y, blade_h], anchor = BOTTOM);
                translate([leg_x + side * barb_bump / 2, 0, 0])
                    cuboid([blade_t + barb_bump, leg_y, barb_h], anchor = BOTTOM);
            }
            translate([0, 0, blade_h])
                cuboid([EX_SLOT_OPEN - 2 * FIT_CLEARANCE, leg_y, spine_h], anchor = BOTTOM);
            translate([0, 0, blade_h + spine_h])
                cyl(r = post_r, h = post_h, anchor = BOTTOM);
        }
        children();
    }
}
