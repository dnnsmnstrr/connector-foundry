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

// How far a forked end reaches across its slot. The end is a
// BITBEAM_PIN_FN-gon with vertices on the x and y axes; the slot runs
// along y, so it cuts away the two vertices on y, and the prongs' outer
// edges stop where they meet the slot's walls at x = +-slot/2: 4.79mm
// across for the 4.9mm end, not 4.9. A pin's attachable() size has to say
// so, or its FWD and BACK anchors sit 0.05mm off the faces.
function bitbeam_pin_fork_width(dia) =
    let(r = dia / 2, step = 360 / BITBEAM_PIN_FN, x = BITBEAM_PIN_FORK_SLOT / 2,
        a0 = floor(acos(x / r) / step) * step, a1 = a0 + step,
        p0 = r * [cos(a0), sin(a0)], p1 = r * [cos(a1), sin(a1)])
    2 * (p0.y + (x - p0.x) / (p1.x - p0.x) * (p1.y - p0.y));

// The attachable() size of a pin `length` long: a forked end makes it
// 4.9mm across x and the fork's width across y, a plain one 4.6mm round.
function bitbeam_pin_size(length, forked) =
    forked ? [BITBEAM_PIN_WIDE_DIA, bitbeam_pin_fork_width(BITBEAM_PIN_WIDE_DIA), length]
           : [BITBEAM_PIN_NARROW_DIA, BITBEAM_PIN_NARROW_DIA, length];

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
