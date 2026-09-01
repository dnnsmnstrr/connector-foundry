// Gridfinity bin base. Functional face is BOTTOM (also the print
// orientation); mates through the "mount" anchor on TOP.
//
// The geometry is NOT reimplemented here. This is a thin wrapper that
// calls gridfinityBase() from the upstream reference implementation,
// vendored as the git submodule vendor/gridfinity-rebuilt
// (kennetek/gridfinity-rebuilt-openscad, MIT). All this file adds is the
// repo's slot convention: a BOSL2 attachable() envelope and the "mount"
// anchor. Every dimension, the base profile, the corner radii, the magnet
// and screw hole geometry (chamfers, crush ribs, supportless printing)
// come from upstream and track it on submodule update.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>

include <../../vendor/gridfinity-rebuilt/src/core/standard.scad>
use <../../vendor/gridfinity-rebuilt/src/core/base.scad>
use <../../vendor/gridfinity-rebuilt/src/core/gridfinity-rebuilt-holes.scad>

// Upstream builds the base sitting on z=0, centered in x/y, BASE_HEIGHT tall.
module gf_base(gx = 1, gy = 1, magnets = false, screws = false,
               crush_ribs = true, chamfer = true, supportless = false,
               only_corners = false, thumbscrew = false,
               anchor = BOTTOM, spin = 0, orient = UP) {

    size = [gx * GRID_DIMENSIONS_MM.x - BASE_GAP_MM.x,
            gy * GRID_DIMENSIONS_MM.y - BASE_GAP_MM.y,
            BASE_HEIGHT];

    // Hole extras only apply when there is a hole to apply them to.
    holes = bundle_hole_options(
        magnet_hole = magnets,
        screw_hole  = screws,
        crush_ribs  = magnets && crush_ribs,
        chamfer     = (magnets || screws) && chamfer,
        supportless = (magnets || screws) && supportless);

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        down(size.z / 2)
            gridfinityBase([gx, gy], hole_options = holes,
                           only_corners = only_corners, thumbscrew = thumbscrew);
        children();
    }
}
