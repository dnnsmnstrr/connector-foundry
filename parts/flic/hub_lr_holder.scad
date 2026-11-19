// Flic Hub LR holder: a sleeve the Hub LR slides into from its open end,
// face out, held against the floor by lips over the edges of its face.
// The mouth is BOTTOM, the functional face; "mount" is on TOP, the back of
// the sleeve. "bot" is the mouth's centre.
//
// Every port of the Hub LR is on one end face (see lib/flic.scad), so the
// sleeve is open at that end (+X) and stops flush with it; the other three
// sides have walls and lips. The lips stand `lip` mm over the hub's face,
// on the 3.3mm of flat edge outside its centre panel. Mounted on a wall,
// put the open end up, or to one side: the closed end is what the hub
// rests on.
//
// The lips are flat, so print the sleeve standing on its closed end: every
// face is then a wall or the floor, with no overhang to support.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/flic.scad>

// The lips' thickness: five 0.2mm layers' worth of plastic, which a
// 1.6mm strip 66mm long needs not to bow.
FLIC_HUB_LR_LIP_T = 1.6;

module flic_hub_lr_holder(wall = 2, floor = 2, lip = 2.5, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(wall >= FLIC_MIN_WALL, str("wall must be at least ", FLIC_MIN_WALL, "mm"));
    assert(floor >= FLIC_MIN_FLOOR, str("floor must be at least ", FLIC_MIN_FLOOR, "mm"));
    assert(lip >= 1 && lip <= 3.3, "lip must be between 1mm and the 3.3mm of flat edge the hub has");
    // A sliding fit: FIT_CLEARANCE round the hub and twice it over its
    // thickness, so the hub goes in without forcing the lips.
    pocket = [FLIC_HUB_LR.x + FIT_CLEARANCE, FLIC_HUB_LR.y + 2 * FIT_CLEARANCE, FLIC_HUB_LR.z + 2 * FIT_CLEARANCE];
    size = [pocket.x + wall, pocket.y + 2 * wall, FLIC_HUB_LR_LIP_T + pocket.z + floor];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        // The box is centred; the pocket runs from the closed end (-X,
        // behind its wall) out through the open one.
        translate(-size / 2) difference() {
            cube(size);
            // The hub, sliding in from +X.
            translate([wall, wall, FLIC_HUB_LR_LIP_T]) cube([pocket.x + 0.01, pocket.y, pocket.z]);
            // The window between the lips, which the hub's face shows through.
            translate([wall + lip, wall + lip, -0.01])
                cube([pocket.x - lip + 0.01, pocket.y - 2 * lip, FLIC_HUB_LR_LIP_T + 0.02]);
        }
        children();
    }
}
