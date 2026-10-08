// Skådis peg: hook tabs on a plate, to hang a part on a Skådis
// board (a real one, or skadis/board). Functional face is BOTTOM, the
// tabs; "mount" is on TOP, the plate's front, where a holder, a shelf
// or anything else on the Bench fuses on. "bot" is the hooks' backs.
//
// Each tab (lib/skadis.scad's skadis_tab()) goes straight through a slot,
// drops 6 mm and hangs behind the board; lifted again, it comes out.
// With pegs = 2 there are two, 40 mm apart, for two slots side by side
// in a row: they stop the part turning. The plate runs from the hooks'
// bottom to as far above the arm, so "mount" is in its middle.
//
// Prints on its side (a tab's arm and hook flat on the bed), so the
// layers run along the arm and the hook does not snap off along one.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/skadis.scad>

module skadis_peg(pegs = 1, plate = 2, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(pegs == 1 || pegs == 2, "pegs must be 1 or 2");
    assert(plate > 0, "plate must be positive");

    spacing = 2 * SKADIS_PITCH;
    y_min = -SKADIS_HOOK_DROP;
    y_max = SKADIS_ARM_H + SKADIS_HOOK_DROP;
    reach = SKADIS_ARM_REACH + SKADIS_HOOK_T;
    size = [12 + (pegs - 1) * spacing, y_max - y_min, plate + reach];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, -(y_min + y_max) / 2, reach - size.z / 2]) {
            translate([-size.x / 2, y_min, 0]) cube([size.x, size.y, plate]);
            for (i = [0 : pegs - 1])
                translate([(i - (pegs - 1) / 2) * spacing, 0, 0]) skadis_tab();
        }
        children();
    }
}
