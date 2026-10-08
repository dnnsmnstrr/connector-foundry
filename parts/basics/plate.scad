// Basics plate: a flat rectangular connector piece. Functional face is
// BOTTOM (also print orientation); the default "mount" anchor is on TOP,
// but per lib/slots.scad's convention this part has more faces, so it
// also exposes "bot", "xpos", "xneg", "ypos", "yneg" — a plate can branch
// composition off any side, not just stack top-to-bottom.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module basics_plate(w = 42, d = 42, t = 4, r = 4, bolts = false, bolt_r = 1.7, bolt_inset = 6,
                     anchor = BOTTOM, spin = 0, orient = UP) {
    size = [w, d, t];
    anchors = [
        mount_anchor(t / 2),
        named_anchor("bot",  [0, 0, -t / 2], DOWN,  0),
        named_anchor("xpos", [w / 2, 0, 0],  RIGHT, 0),
        named_anchor("xneg", [-w / 2, 0, 0], LEFT,  0),
        named_anchor("ypos", [0, d / 2, 0],  BACK,  0),
        named_anchor("yneg", [0, -d / 2, 0], FRONT, 0),
    ];

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        difference() {
            // Same solid as cuboid(size, rounding = r, edges = "Z"), built
            // without its 3D hull(): the browser's openscad-wasm hulls with
            // CGAL, which asserts on cuboid's near-coplanar corner pieces
            // at some sizes (160x100 among them). Same arc segments as
            // cuboid's (a multiple of 4), so the outline is identical.
            linear_extrude(height = t, center = true)
                rect([w, d], rounding = r, $fn = quantup(segs(r), 4));
            if (bolts)
                corner_pattern([w, d], bolt_inset)
                    through_hole(bolt_r + FIT_CLEARANCE, t);
        }
        children();
    }
}
