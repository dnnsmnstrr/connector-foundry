// BitBeam plate: a filled grid_x-by-grid_y grid of BitBeam cells,
// `height` units thick, with the library's own through-hole in every
// cell and — by default — a BitBeam side hole into every edge cell, so a
// beam pinned to an edge lines up with the columns and rows on top.
//
// Nothing about a hole is modelled in this repo. The plate and its top
// holes are vendor/bitbeam-lib's cube_base() — chamfered edges, the
// sub-surface groove every hole carries for a pin's ridge, everything a
// real BitBeam part has — and the side holes are the same holes() module
// cube_frame() uses for its arms, turned onto each edge here exactly as
// that module turns it onto an arm. (This replaces the former
// basics/pinhole_plate, which cut plain cylinders into a rounded Basics
// plate: BitBeam-pitched, but not BitBeam holes.)
//
// Sizes are in BitBeam units (BITBEAM_UNIT, 8mm) throughout, as the
// library's are: a 3x3 plate is 24mm square, and height=1 is a beam's
// own 8mm, so a beam butted against an edge sits flush with its side
// holes at the plate's mid-thickness. Side holes need a full unit of
// thickness — bitbeam-lib's own rule for a beam (cube_arm() only cuts
// them for h >= 1) — so asking for them on a thinner plate is a hard
// error, not a silently missing bore.
//
// Anchors: mount/bot/xpos/xneg/ypos/yneg on the six faces (branch off
// any side, like basics/plate), a "mount_<i>_<j>" grid on every top
// hole, and "<face>_<i>" on every side hole — all in register, all real
// clickable slots in the Bench (see lib/slots.scad).
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../vendor/bitbeam-lib/bitbeam-lib.scad>

// Reassign the vendored library's own globals from this repo's
// constants rather than relying on them already agreeing (they do,
// today) — same as parts/bitbeam/beam.scad, so BITBEAM_UNIT/
// BITBEAM_HOLE_DIA stays the one place that controls every BitBeam
// part's size.
unit = BITBEAM_UNIT;
hole = BITBEAM_HOLE_DIA;

module bitbeam_plate(grid_x = 3, grid_y = 3, height = 1, side_holes = true,
                     anchor = BOTTOM, spin = 0, orient = UP) {
    assert(!side_holes || height >= 1,
        str("bitbeam_plate: side holes need height >= 1 unit (", BITBEAM_UNIT, "mm, a beam's own) ",
            "to leave wall around a ", BITBEAM_HOLE_DIA, "mm bore — set side_holes=false, or height=1."));

    size = [grid_x * BITBEAM_UNIT, grid_y * BITBEAM_UNIT, height * BITBEAM_UNIT];
    span_x = (grid_x - 1) * BITBEAM_UNIT;   // first to last cell center
    span_y = (grid_y - 1) * BITBEAM_UNIT;

    top_anchors = grid_mount_anchors(size, BITBEAM_UNIT, size.z / 2, count = [grid_x, grid_y]);
    side_anchors = !side_holes ? [] : concat(
        side_row_anchors("xpos", size, BITBEAM_UNIT, grid_y),
        side_row_anchors("xneg", size, BITBEAM_UNIT, grid_y),
        side_row_anchors("ypos", size, BITBEAM_UNIT, grid_x),
        side_row_anchors("yneg", size, BITBEAM_UNIT, grid_x));
    anchors = concat([
        mount_anchor(size.z / 2),
        named_anchor("bot",  [0, 0, -size.z / 2],  DOWN,  0),
        named_anchor("xpos", [size.x / 2, 0, 0],  RIGHT, 0),
        named_anchor("xneg", [-size.x / 2, 0, 0], LEFT,  0),
        named_anchor("ypos", [0, size.y / 2, 0],  BACK,  0),
        named_anchor("yneg", [0, -size.y / 2, 0], FRONT, 0),
    ], top_anchors, side_anchors);

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // cube_base() puts its first cell's center on the origin; shift
        // so the plate is centered, per attachable()'s convention (same
        // move as beam.scad's).
        translate([-span_x / 2, -span_y / 2, 0])
            difference() {
                cube_base(grid_x, grid_y, h = height);
                if (side_holes) {
                    // One side hole per edge cell, a cell deep, at
                    // mid-thickness: holes() cuts along Z, so it is
                    // turned to run into the face — the same
                    // rotate([90, 0, 0]) holes() that cube_arm() uses for
                    // a beam's side holes, once per edge.
                    rotate([90, 0, 0]) holes(grid_x, 1);                                                // yneg
                    translate([0, span_y, 0]) rotate([90, 0, 0]) holes(grid_x, 1);                      // ypos
                    rotate([0, 0, 90]) rotate([90, 0, 0]) holes(grid_y, 1);                             // xneg
                    translate([span_x, 0, 0]) rotate([0, 0, 90]) rotate([90, 0, 0]) holes(grid_y, 1);   // xpos
                }
            }
        children();
    }
}
