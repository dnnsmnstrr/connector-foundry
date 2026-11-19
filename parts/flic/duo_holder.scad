// Flic Duo holder: a stadium-shaped cup the Duo (or a Cue or Mic, which
// share its housing) lies in face out, its lip catching the Duo's rounded
// front edge (see lib/flic.scad). The mouth is BOTTOM, the functional
// face; "mount" is on TOP, the back of the cup. "bot" is the mouth's
// centre.
//
// The Duo's magnets hold it to the steel wall plate it comes with. With
// `plate` on, the cup's floor has a pocket the plate is glued into flush,
// and the Duo clicks onto it as onto a wall. Four slits, where the
// straight sides meet the round ends, let the lip spring open as the Duo
// goes in; with lip 0 they go, and the plate (or a press fit) holds it.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/flic.scad>

// Flush: the Duo lies on the plate and the floor round it alike.
FLIC_DUO_PLATE_POCKET = FLIC_DUO_PLATE.z;

module flic_duo_holder(wall = 2, floor = 2, lip = 0.5, plate = true,
                       anchor = BOTTOM, spin = 0, orient = UP) {
    size = [FLIC_DUO_L, FLIC_DUO_W] + 2 * [FIT_CLEARANCE, FIT_CLEARANCE];
    depth = flic_duo_depth(lip);
    pocket = rect(size, rounding = size.y / 2 - 0.001, $fn = 128);
    outer = size + 2 * [wall, wall];
    h = depth + floor;
    assert(!plate || floor > FLIC_DUO_PLATE_POCKET + 0.6, "floor is too thin for the plate's pocket");
    // Where the straight sides start: the end circles' centres.
    straight = (size.x - size.y) / 2;

    attachable(anchor, spin, orient, size = [outer.x, outer.y, h],
               anchors = [mount_anchor(h / 2), named_anchor("bot", [0, 0, -h / 2], DOWN, 0)]) {
        translate([0, 0, -h / 2]) flic_cup(pocket, depth, wall, floor, lip) {
            if (lip > 0)
                for (sx = [-1, 1], sy = [-1, 1])
                    translate([sx * straight - FLIC_SLIT_W / 2, sy > 0 ? size.y / 2 - lip - 0.5 : -100, -0.01])
                        cube([FLIC_SLIT_W, 100 - size.y / 2 + lip + 0.5, depth + 0.01]);
            if (plate)
                translate([0, 0, depth - 0.01])
                    linear_extrude(FLIC_DUO_PLATE_POCKET + 0.01) intersection() {
                        // The plate's outline, its small corner rounds left
                        // square: the pocket only has to hold the plate.
                        rect([FLIC_DUO_PLATE.x, FLIC_DUO_PLATE.y] + 2 * [FIT_CLEARANCE, FIT_CLEARANCE]);
                        rect([FLIC_DUO_PLATE_ARC_L, FLIC_DUO_PLATE.y] + 2 * [FIT_CLEARANCE, FIT_CLEARANCE],
                             rounding = FLIC_DUO_PLATE.y / 2 + FIT_CLEARANCE - 0.001, $fn = 128);
                    }
        }
        children();
    }
}
