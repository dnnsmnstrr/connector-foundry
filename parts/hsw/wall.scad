// Honeycomb Storage Wall panel: a grid of hexagonal cells that HSW
// inserts clip into (see insert.scad). Functional face is BOTTOM, the
// face the inserts go in from, which is also the print orientation:
// the cells' 20mm openings on the bed, the wider lock recess behind
// them up. "mount" is on TOP, the back that goes against the wall;
// "bot" is the front.
//
// The Honeycomb Storage Wall is RostaP's design (printables.com/model/
// 152592). The cell geometry is not re-derived here: each cell is
// hex() from geru's 3d-scad-hsw-customizable (the continuation of
// Xander's and EdwinEesting's customizable HSW, which EdwinEesting
// matched to the original), vendored as vendor/hsw-customizable.
// LICENSE: that file is CC-BY 4.0, so this part is too: attribution
// required, no other restriction (see README "Licensing").
//
// What this file does instead of upstream: the layout. Upstream's
// grid() sizes the panel from top-level customizer variables (a print
// bed's width and height, a table of column lengths) that `use <>`
// cannot change, so it is no use from outside. The panel is laid out
// here with upstream's own pitch (references.yaml checks it against
// upstream's grid), and each cell is upstream's halfhex(), which is
// hex() plus the flat-edge trims. Columns are `rows` cells tall, the odd
// ones half a cell lower, as on the original.
//
// flat_edges trims the panel to a rectangle the way upstream's
// edge_left/top/right/bottom do: the outer half cells cut away and a
// flat wall in their place, so panels butt together edge to edge.
// Upstream cuts the halves away at the cells' outer points, which its
// wall profile reaches 0.01mm past, so on its own every trimmed cell
// leaves a loose sliver there; the panel is clipped to its extent here,
// which takes them off.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../vendor/hsw-clip/hswx.scad>
use <../../vendor/hsw-customizable/custom-honeycomb-wall-v2.3.scad>

// Upstream's wall profile starts 0.01mm outside each cell's outer flat,
// so neighbouring cells overlap and union into one solid. It counts in
// the panel's extent.
HSW_WALL_SINK = 0.01;

// Cell pitch: columns 1.5 side lengths apart, cells in a column one
// outer flat-to-flat apart.
HSW_PITCH_X = 1.5 * HSWX_SIDE;
HSW_PITCH_Y = HSWX_OUTSIDE;

// The panel's extent in upstream's frame: column 0's top cell centred
// on the origin, columns running toward +x, cells down toward -y.
// [[x_min, x_max], [y_min, y_max]].
function hsw_wall_extent(cols, rows, flat_edges) =
    let (
        staggered = cols > 1,
        // A flat side edge is cut through the cells' centres, flush; a
        // flat top or bottom still has the other columns' whole cells
        // reaching it, sink and all.
        // The cells' points on ±x are where two slanted flats meet, each
        // sunk square to itself, so they reach only cos 30° of the sink
        // further out.
        point = HSWX_SIDE + HSW_WALL_SINK * cos(30),
        x_min = flat_edges ? 0 : -point,
        x_max = HSW_PITCH_X * (cols - 1) + (flat_edges ? 0 : point),
        y_max = flat_edges ? HSW_WALL_SINK : HSW_PITCH_Y / 2 + HSW_WALL_SINK,
        // The lowest cell: the bottom of a lower (odd) column if there is
        // one. flat_edges cuts it at its centre.
        y_low = -HSW_PITCH_Y * (rows - 1) - (staggered ? HSW_PITCH_Y / 2 : 0),
        y_min = y_low - (flat_edges ? HSW_WALL_SINK : HSW_PITCH_Y / 2 + HSW_WALL_SINK)
    ) [[x_min, x_max], [y_min, y_max]];

module hsw_wall(cols = 4, rows = 3, flat_edges = false,
                anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && rows >= 1, "cols and rows must be at least 1");
    // A lone column or row would be trimmed from both sides to nothing.
    assert(!flat_edges || (cols >= 2 && rows >= 2), "flat_edges needs at least 2 columns and 2 rows");

    ext = hsw_wall_extent(cols, rows, flat_edges);
    size = [ext[0][1] - ext[0][0], ext[1][1] - ext[1][0], HSWX_DEPTH];
    centre = [(ext[0][0] + ext[0][1]) / 2, (ext[1][0] + ext[1][1]) / 2];
    lowest_col_odd = cols > 1;

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([-centre.x, -centre.y, -size.z / 2]) intersection() {
            for (c = [0 : cols - 1], r = [0 : rows - 1]) {
                odd = c % 2 == 1;
                translate([HSW_PITCH_X * c, -HSW_PITCH_Y * (r + (odd ? 0.5 : 0)), 0])
                    halfhex(HSWX_DEPTH, HSWX_SIDE, HSWX_WALL, HSWX_INSIDE,
                            flat_edges && c == 0,
                            flat_edges && r == 0 && !odd,
                            flat_edges && c == cols - 1,
                            flat_edges && r == rows - 1 && odd == lowest_col_odd);
            }
            if (flat_edges)
                translate([ext[0][0], ext[1][0], 0]) cube(size);
        }
        children();
    }
}
