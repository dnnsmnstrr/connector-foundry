// Flic Hub Mini holder: a round cup the Hub Mini snaps into face out, a
// slot in its wall for the USB-C cable, its lip catching the hub's front
// edge (see lib/flic.scad). The mouth is BOTTOM, the functional face;
// "mount" is on TOP, the back of the cup. "bot" is the mouth's centre.
//
// The hub's cable plugs in under its back and leaves through a channel to
// one side; turn the hub so the channel meets the slot. The slot (+Y, as
// wide as `cable`) and two slits opposite it split the wall into three
// fingers, so the lip springs open as the hub goes in. Mounted on a wall,
// put the slot at the bottom and the cable hangs straight down out of it.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/flic.scad>

module flic_hub_mini_holder(wall = 2, floor = 2, lip = 0.5, cable = 12,
                            anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cable >= FLIC_HUB_MINI_CABLE,
           str("cable must be at least the hub's own ", FLIC_HUB_MINI_CABLE, "mm channel"));
    pocket_d = FLIC_HUB_MINI_D + 2 * FIT_CLEARANCE;
    assert(cable <= pocket_d / 2, "cable is too wide a slot for the cup to hold the hub");
    depth = flic_hub_mini_depth(lip);
    pocket = circle(d = pocket_d, $fn = 128);
    outer_d = pocket_d + 2 * wall;
    h = depth + floor;

    attachable(anchor, spin, orient, size = [outer_d, outer_d, h],
               anchors = [mount_anchor(h / 2), named_anchor("bot", [0, 0, -h / 2], DOWN, 0)]) {
        translate([0, 0, -h / 2]) flic_cup(pocket, depth, wall, floor, lip) {
            flic_radial_cut(90, cable, depth, pocket_d / 2 - lip - 0.5);
            if (lip > 0)
                for (a = [210, 330])
                    flic_radial_cut(a, FLIC_SLIT_W, depth, pocket_d / 2 - lip - 0.5);
        }
        children();
    }
}
