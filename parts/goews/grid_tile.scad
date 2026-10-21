// GOEWS grid tile: the square-grid layout of a GOEWS wall panel, units
// in plain rows and columns instead of interlocking hexagons, so it
// spends less wall on each unit. Same hangers, cleats and bolt as the hex
// tile (see tile.scad). Functional face is BOTTOM, the back against the
// wall, which is also the print orientation; "mount" is on TOP, the front,
// where the hangers go in; "bot" is the back.
//
// A thin wrapper over grid_tile() from jimfunk's goews-rebuilt-openscad
// (vendor/goews-rebuilt). LICENSE: CC-BY 4.0 on Printables; see README
// "Licensing".
//
// A unit is 42 mm wide and 36.373 mm tall, the hex tile's row pitch. Each
// has two screw holes, near its top corners, where a hex unit has one
// below its opening.
// Grid tiles butt together edge to edge; nothing interlocks.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../lib/goews.scad>
use <../../lib/goews_grid_tile.scad>

module goews_grid_tile(cols = 2, rows = 2, cleats = "original",
                       screw_d = 4, head_d = 8, countersink = 2,
                       anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && rows >= 1, "cols and rows must be at least 1");
    assert(cleats == "original" || cleats == "thick", "cleats must be original or thick");
    assert(screw_d > 0 && head_d >= screw_d, "head_d must be at least screw_d");
    // As on the hex tile: the head sinks 1 mm before the countersink starts.
    assert(countersink >= 0 && countersink <= goews_tile_t() - 1, "countersink must be 0 to 5mm");

    size = [cols * goews_unit_w(), rows * goews_grid_h(), goews_tile_t()];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        // render(): upstream cuts each opening exactly as thick as the
        // tile, coplanar with both faces, which OpenSCAD's preview (the
        // README gallery, the GUI) draws as z-fighting unless it is
        // merged first. The exported mesh is the same either way.
        translate(-size / 2) render(convexity = 4)
            goews_upstream_grid_tile(goews_variant(cleats == "thick"), cols, rows, screw_d, head_d, countersink);
        children();
    }
}
