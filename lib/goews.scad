// GOEWS (Greatly Over Engineered Wall System, by MrExo3D; goews.ws): the
// numbers parts/goews/*.scad need to size their envelopes, read from
// jimfunk's goews-rebuilt-openscad (vendored as vendor/goews-rebuilt).
// Its modules come through lib/goews_tile.scad, goews_grid_tile.scad and
// goews_hanger.scad, for the same reason as below.
//
// Use this file, don't include it. Upstream names things plainly: values
// (overcut, plate_width, thread_pitch, tile_width ...) and modules (tile,
// grid_tile, hanger, mounting_hole ...). A Bench assembly includes every
// part's file into one scope, where the last assignment of a name wins
// and a module defined there shadows one brought in with `use`. Included
// here, or used by the three files above, in files the parts `use`,
// upstream's names stay in those files' scope (a used file's own uses go
// no further): the parts see only goews_* names, so no number is restated
// and nothing upstream names can collide with anything else's.
//
// Frame, upstream's and the parts': +y is up the wall. A tile's back is
// z = 0, its front z = goews_tile_t().
include <../vendor/goews-rebuilt/constants.scad>
// A hex unit is tile_width across its flats (Gridfinity's 42 mm) and
// goews_hex_h() point to point; rows are goews_row_pitch() apart, every
// other one shifted half a unit.
function goews_unit_w() = tile_width;
function goews_hex_h() = tile_height;
function goews_row_pitch() = tile_y_offset;
// A grid tile's unit is tile_width by grid_tile_height.
function goews_grid_h() = grid_tile_height;
function goews_tile_t() = tile_thickness;

// The hanger plate: plate_width per unit, plate_height tall, its sides
// each plate_side_tolerance in from the unit. The hanger behind it is
// hanger_thickness deep, plus a gap that is the tolerance, and for the
// thicker cleats hanger_offset more (upstream's get_hanger_plate_offset()).
function goews_plate_w() = plate_width;
function goews_plate_h() = plate_height;
function goews_plate_side_tolerance() = plate_side_tolerance;
function goews_hanger_depth(thick, tolerance) =
    hanger_thickness + get_hanger_plate_offset(goews_variant(thick), tolerance);

// Upstream's variant numbers, from this repo's `cleats` option.
function goews_variant(thick) = thick ? variant_thicker_cleats : variant_original;
