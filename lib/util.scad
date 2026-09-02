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

// A blind pocket, flat-bottomed, opening upward from z=0.
module pocket(r, depth, overshoot = 0.5) {
    translate([0, 0, depth / 2 - overshoot / 2])
        cylinder(r = r, h = depth + overshoot, center = true, $fn = max(16, $fn));
}

// A row of `count` blind holes opening at one edge of a `size`-sized
// box and boring `depth` inward — the side-face counterpart to a
// vertical grid of through_hole()s, and the geometry behind
// lib/slots.scad's side_row_anchors() (same face/pitch/count meaning,
// same anchor positions). pocket() opens along +Z from z=0; each
// instance is just rotated so that "up" points inward from its own face
// instead.
module side_row_holes(face, size, pitch, count, r, depth, overshoot = 0.5) {
    row_on_x = (face == "xpos" || face == "xneg");
    fixed = row_on_x
        ? (face == "xpos" ? size.x / 2 : -size.x / 2)
        : (face == "ypos" ? size.y / 2 : -size.y / 2);
    // Sends pocket()'s own +Z (its boring direction) to point inward
    // from this face: -X for xpos, +X for xneg, -Y for ypos, +Y for yneg.
    rot = face == "xpos" ? [0, -90, 0] : face == "xneg" ? [0, 90, 0]
        : face == "ypos" ? [90, 0, 0]  : [-90, 0, 0];
    for (i = [-(count - 1) / 2 : (count - 1) / 2]) {
        pos = row_on_x ? [fixed, i * pitch, 0] : [i * pitch, fixed, 0];
        translate(pos) rotate(rot) pocket(r, depth, overshoot);
    }
}
