// GOEWS tile: the wall tile GOEWS accessories hang on, hex or GOEWS
// GRID, any number of cells. GOEWS is by MrExo3D (goews.ws), Printables
// model 1090032, CC-BY 4.0 — NOT MIT, see the README's "Licensing";
// lib/goews.scad has the numbers and where they come from.
//
// style "hex" is the designer's hex tile: cells 42mm across the flats,
// cols to a row, rows rows, every other row half a cell over, so a tile
// is cols x 42 (+ 21 from two rows up) by 48.497 + (rows - 1) x 36.373mm.
// style "grid" is GOEWS GRID: 42 x 36.373mm rectangles, cols x rows. A
// hanger plate (parts/goews/hanger.scad) fits either.
//
// Functional face is BOTTOM, the front the hangers go into. "mount" is
// on TOP, the back that goes on the wall, for fusing the tile onto a
// case or a panel; "bot" is the front. Print it back down (turned over),
// as the designer does: flat on the bed, no supports.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/goews.scad>

module goews_tile(style = "hex", cols = 2, rows = 2, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(style == "hex" || style == "grid", "style must be \"hex\" or \"grid\"");
    assert(cols >= 1 && rows >= 1, "cols and rows must be at least 1");
    assert(cols == round(cols) && rows == round(rows), "cols and rows must be whole numbers");
    xy = style == "hex" ? goews_hex_tile_size(cols, rows) : goews_grid_tile_size(cols, rows);
    size = [xy.x, xy.y, GOEWS_T];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2])
            goews_tile_body(style, cols, rows, $fa = detail_fa(6), $fs = detail_fs(0.5));
        children();
    }
}
