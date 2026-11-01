// BitBeam's published pin fit uses a 4.6mm shaft and 4.9mm forked ends.
// Slots in the end tips let their broad prongs flex in a 4.8mm hole;
// there are no fine Technic ridges to print.
include <constants.scad>

BITBEAM_PIN_NARROW_DIA = 4.6;
BITBEAM_PIN_WIDE_DIA = 4.9;
BITBEAM_PIN_FORK_SLOT = 1.0;
BITBEAM_PIN_FORK_DEPTH = 2.0;
BITBEAM_PIN_TIP_LENGTH = 1.0;
BITBEAM_PIN_FN = 32;

module bitbeam_pin_geometry(length, split_top = true, split_bottom = true) {
    assert(length >= BITBEAM_UNIT / 2, "bitbeam_pin_geometry: length must be at least half a BitBeam unit");
    $fn = BITBEAM_PIN_FN;

    fork_depth = min(BITBEAM_PIN_FORK_DEPTH, length / 2);
    tip_length = min(BITBEAM_PIN_TIP_LENGTH, length / 4);
    top_dia = split_top ? BITBEAM_PIN_WIDE_DIA : BITBEAM_PIN_NARROW_DIA;
    bottom_dia = split_bottom ? BITBEAM_PIN_WIDE_DIA : BITBEAM_PIN_NARROW_DIA;

    difference() {
        union() {
            cylinder(d = BITBEAM_PIN_NARROW_DIA, h = length);
            if (split_bottom)
                cylinder(d1 = bottom_dia, d2 = BITBEAM_PIN_NARROW_DIA, h = tip_length);
            if (split_top)
                translate([0, 0, length - tip_length])
                    cylinder(d1 = BITBEAM_PIN_NARROW_DIA, d2 = top_dia, h = tip_length);
        }

        if (split_bottom)
            translate([-BITBEAM_PIN_FORK_SLOT / 2, -bottom_dia, -0.01])
                cube([BITBEAM_PIN_FORK_SLOT, bottom_dia * 2, fork_depth + 0.01]);
        if (split_top)
            translate([-BITBEAM_PIN_FORK_SLOT / 2, -top_dia, length - fork_depth])
                cube([BITBEAM_PIN_FORK_SLOT, top_dia * 2, fork_depth + 0.01]);
    }
}
