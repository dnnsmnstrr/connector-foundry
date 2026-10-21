// GOEWS hanger plate: the part everything on a GOEWS wall hangs by. A
// hanger behind a plate goes into a tile's opening (tile.scad,
// grid_tile.scad) and drops behind its cleats. Functional face is BOTTOM,
// the hanger; "mount" is on TOP, the plate's front, where a hook, a holder
// or anything else on the Bench fuses on. +y is up the wall.
//
// Prints standing on the plate's bottom edge, the way upstream exports
// it (its thicker-cleat hanger is chamfered underneath for when extend
// lifts it off the bed): turn the part, or the part it is fused onto,
// that way in the slicer.
//
// A thin wrapper over hanger_plate() from jimfunk's goews-rebuilt-openscad
// (vendor/goews-rebuilt), turned from upstream's frame, which stands the
// plate up (z up the wall, y out of it), into this repo's. LICENSE:
// CC-BY 4.0 on Printables; see README "Licensing".
//
// units sets the width in tile units, one hanger per unit, each plate
// 42 mm less a 0.25 mm gap a side so neighbours fit. The notch in the
// plate's top edge sits around the unit's threaded hole, above the
// opening, so the optional locking bolt's head can hold the plate in;
// bolt_notch false leaves the edge straight. tolerance is upstream's
// play between hanger and tile: smaller hangs straighter, larger goes
// in and out more easily. extend lengthens the plate downward, for
// something that needs more plate than a hanger's height.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../lib/goews.scad>
use <../../lib/goews_hanger.scad>

module goews_hanger(units = 1, cleats = "original", plate = 3, bolt_notch = true,
                    tolerance = 0.15, extend = 0,
                    anchor = BOTTOM, spin = 0, orient = UP) {
    assert(units >= 1 && units == floor(units), "units must be a whole number, at least 1");
    assert(cleats == "original" || cleats == "thick", "cleats must be original or thick");
    assert(plate > 0, "plate must be positive");
    assert(tolerance >= 0, "tolerance must not be negative");
    assert(extend >= 0, "extend must not be negative");

    thick = cleats == "thick";
    unit_w = goews_plate_w();
    depth = goews_hanger_depth(thick, tolerance);
    // Upstream cuts a thicker-cleat hanger's back off where hanger and
    // gap would reach further back than a tile is thick.
    back = thick ? max(0, depth - goews_tile_t()) : 0;
    height = goews_plate_h() + extend;
    size = [units * unit_w - 2 * goews_plate_side_tolerance(), height, depth + plate - back];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        // rotate([90, 0, 180]) takes upstream's (x, y, z) to (-x, z, y):
        // its depth to this frame's z, its height up the wall to y. The
        // plate is symmetric across x, so the turn does not mirror it.
        translate([0, -height / 2, -(back + depth + plate) / 2])
            rotate([90, 0, 180]) translate([-units * unit_w / 2, 0, 0])
                goews_upstream_hanger_plate(goews_variant(thick), plate, bolt_notch, units, tolerance, extend);
        children();
    }
}
