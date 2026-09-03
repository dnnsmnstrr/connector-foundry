// Shared helpers: hole patterns, profile sweeps, print-orientation notes.
include <../vendor/BOSL2/std.scad>

// Runs children once at each of 4 corners of a [x,y]-centered rectangle,
// offset inward from the full size by `inset` on each axis.
module corner_pattern(size, inset) {
    x = size.x / 2 - inset;
    y = size.y / 2 - inset;
    for (p = [[x, y], [-x, y], [-x, -y], [x, -y]])
        translate([p.x, p.y, 0]) children();
}

// A cylindrical hole through the full part height plus a hair of overshoot
// on both ends, so `difference()` always produces a clean through-cut
// regardless of z-fighting.
module through_hole(r, h, overshoot = 0.5) {
    cylinder(r = r, h = h + 2 * overshoot, center = true, $fn = max(16, $fn));
}
