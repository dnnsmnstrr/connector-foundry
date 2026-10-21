// Upstream's GOEWS tile() under a name of this repo's, for
// parts/goews/tile.scad: use this file, don't include it (lib/goews.scad
// says why). One file per upstream file, so a part parses only the
// upstream file it calls, and with it one more copy of BOSL2.
use <../vendor/goews-rebuilt/tile.scad>

// tile(), with the parameters the part sets; the rest keep upstream's
// defaults.
module goews_upstream_tile(variant, cols, rows, fill_top, fill_bottom, fill_left, fill_right,
                           screw_d, head_d, countersink)
    tile(variant = variant, columns = cols, rows = rows,
         fill_top = fill_top, fill_bottom = fill_bottom, fill_left = fill_left, fill_right = fill_right,
         mounting_hole_shank_diameter = screw_d, mounting_hole_head_diameter = head_d,
         mounting_hole_countersink_depth = countersink);
