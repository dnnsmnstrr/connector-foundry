// Upstream's GOEWS grid_tile() under a name of this repo's, for
// parts/goews/grid_tile.scad: use this file, don't include it
// (lib/goews.scad says why; lib/goews_tile.scad why it is a file alone).
use <../vendor/goews-rebuilt/grid_tile.scad>

// grid_tile(), with the parameters the part sets.
module goews_upstream_grid_tile(variant, cols, rows, screw_d, head_d, countersink)
    grid_tile(variant = variant, columns = cols, rows = rows,
              mounting_hole_shank_diameter = screw_d, mounting_hole_head_diameter = head_d,
              mounting_hole_countersink_depth = countersink);
