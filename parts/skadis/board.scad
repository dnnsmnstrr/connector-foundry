// Skådis board: a panel with Skådis's slot pattern, which moulded
// Skådis hooks and this repo's skadis/peg hang on. Functional face is
// BOTTOM, the front the hooks go in from, which is also the print
// orientation (flat on the bed either way up); "mount" is on TOP, the
// back, against the wall. "bot" is the front.
//
// The board is 2 cols x rows cells of SKADIS_PITCH, with a slot in every
// other one (lib/skadis.scad), so boards butt together and the pattern
// carries on across the joint. cols goes in halves: a whole number gives
// an even count of cells across, so every row starts with a slot on one
// side and ends on a gap on the other; a half (2.5: five cells, 100mm)
// gives an odd count, and the board is the same mirrored left to right.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/skadis.scad>

module skadis_board(cols = 2, rows = 4, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && rows >= 1, "cols and rows must be at least 1");
    assert(2 * cols == round(2 * cols), "cols must be a whole or a half number");
    size = [2 * cols * SKADIS_PITCH, rows * SKADIS_PITCH, SKADIS_BOARD_T];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) difference() {
            translate([-size.x / 2, -size.y / 2, 0]) cube(size);
            for (c = skadis_slot_centres(cols, rows))
                translate([c.x, c.y, -1]) linear_extrude(size.z + 2) skadis_slot_outline();
        }
        children();
    }
}
