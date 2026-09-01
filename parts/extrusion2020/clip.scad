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

// Axis convention, shared with tab.scad: X runs ALONG the rail, Y runs
// ACROSS the slot, Z is the insertion direction. (This part used to have
// X and Y the other way round from the tab, so the two could not be
// posed against a rail by the same transform.)
module ex_clip(leg_len = 7, post_h = 8,
                anchor = BOTTOM, spin = 0, orient = UP) {
    blade_t   = 1.3;   // single-leg flex thickness
    spine_h   = 2;
    barb_bump = 1.1;
    post_r    = 1.5;

    // A leg has to reach all the way past the lip before its barb has
    // anything to spring out under: EX_LIP_T of mouth, then the channel.
    // Sizing the leg to the channel depth alone (which is what this did)
    // left the barb still inside the slot mouth, gripping nothing.
    barb_h  = EX_CHANNEL_D;            // barb band, tip-ward, fills the channel
    blade_h = EX_CHANNEL_D + EX_LIP_T; // tip at the floor, spine at the outer face
    inner_y = (EX_SLOT_OPEN - 2 * FIT_CLEARANCE) / 2 - blade_t; // leg's inner face
    outer_y = inner_y + blade_t;                                // leg's plain outer face

    // Barb-to-barb span must clear the channel walls once sprung out,
    // and must exceed the slot mouth or there is nothing to retain on.
    assert(2 * (outer_y + barb_bump) < EX_CHANNEL_W - 2 * FIT_CLEARANCE,
           "barbs are wider than the channel and will not enter");
    assert(2 * (outer_y + barb_bump) > EX_SLOT_OPEN,
           "barbs are narrower than the slot mouth and will not retain");

    total_h = blade_h + spine_h + post_h;
    size = [leg_len, 2 * (outer_y + barb_bump), total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        union() {
            for (side = [-1, 1]) {
                leg_y_pos = side * (inner_y + blade_t / 2);
                translate([0, leg_y_pos, 0])
                    cuboid([leg_len, blade_t, blade_h], anchor = BOTTOM);
                translate([0, leg_y_pos + side * barb_bump / 2, 0])
                    cuboid([leg_len, blade_t + barb_bump, barb_h], anchor = BOTTOM);
            }
            translate([0, 0, blade_h])
                cuboid([leg_len, EX_SLOT_OPEN - 2 * FIT_CLEARANCE, spine_h], anchor = BOTTOM);
            translate([0, 0, blade_h + spine_h])
                cyl(r = post_r, h = post_h, anchor = BOTTOM);
        }
        children();
    }
}
