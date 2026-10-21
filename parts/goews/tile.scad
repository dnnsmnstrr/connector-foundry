// GOEWS hex tile: a wall panel of hexagonal units, screwed to the wall,
// that GOEWS hanger plates (see hanger.scad) hang in. Functional face is
// BOTTOM, the back against the wall, which is also the print orientation:
// back on the bed, the way upstream exports it, with its rear edges
// chamfered. "mount" is on TOP, the front, where the hangers go in; "bot"
// is the back.
//
// GOEWS is MrExo3D's design (goews.ws, printables.com/model/1090032).
// The geometry is not re-derived here: this is a thin wrapper over
// tile() from jimfunk's goews-rebuilt-openscad, vendored as
// vendor/goews-rebuilt, which rebuilds the original's Fusion 360 model
// and adds the thicker-cleat variant. LICENSE: upstream's model and
// rebuild are CC-BY 4.0 on Printables; see README "Licensing".
//
// Each unit is Gridfinity's 42 mm across its flats, with one hanger
// opening, a 14 mm threaded hole above it for the locking bolt and a
// screw hole below it. Rows are a unit's height less its top point
// apart, every other row shifted half a unit, so a tile's sides are
// zig-zags that the next tile's interlock with. The fills square an edge
// off instead. fill_top's fill carries more screw holes, which upstream
// recommends for reaching the top plate of a drywall-covered wall.
//
// cleats picks upstream's two variants. They do not mix: a hanger plate
// only fits a tile with the same cleats. thick moves the cleat profile
// back 1 mm for thicker shoulders, which upstream measured holding 40 lb
// where the original's held 25 (both without the bolt).
//
// Upstream lays the tile out from its first unit's lower left corner and
// the outside box follows from the rows: a single row starts half a unit
// in, unless fill_left fills that half; from two rows on, the unshifted
// row reaches x = 0. The fills stay inside the box the units span.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../lib/goews.scad>
use <../../lib/goews_tile.scad>

module goews_tile(cols = 2, rows = 2, cleats = "original",
                  fill_top = false, fill_bottom = false, fill_left = false, fill_right = false,
                  screw_d = 4, head_d = 8, countersink = 2,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && rows >= 1, "cols and rows must be at least 1");
    assert(cleats == "original" || cleats == "thick", "cleats must be original or thick");
    assert(screw_d > 0 && head_d >= screw_d, "head_d must be at least screw_d");
    // Upstream sinks the screw head 1 mm into the front, then cuts the
    // countersink below that: more than the rest of the 6 mm cuts through.
    assert(countersink >= 0 && countersink <= goews_tile_t() - 1, "countersink must be 0 to 5mm");

    w = goews_unit_w();
    x_min = rows > 1 || fill_left ? 0 : w / 2;
    x_max = w / 2 + cols * w;
    y_max = (rows - 1) * goews_row_pitch() + goews_hex_h();
    size = [x_max - x_min, y_max, goews_tile_t()];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([-(x_min + x_max) / 2, -y_max / 2, -size.z / 2])
            goews_upstream_tile(goews_variant(cleats == "thick"), cols, rows,
                                fill_top, fill_bottom, fill_left, fill_right, screw_d, head_d, countersink);
        children();
    }
}
