// Gridfinity bin: a whole bin — base, walls, stacking lip — gx by gy
// cells and gz height units (7mm each, the stacking lip on top of that,
// as upstream counts it). Functional face is BOTTOM (also the print
// orientation).
//
// Either a bin with compartments (divx by divy, upstream's scoop and
// label tabs), or `filled`: solid up to just under the stacking lip, so
// it still stacks and takes a bin on top, with a flat top face to cut
// custom cavities into — the Holes tab's job (a tool's outline, a row
// of magnet pockets, a 2020 socket ...). The "mount" anchor, and the
// "mount_<i>_<j>" grid at GRID_DIMENSIONS_MM.x/3 (14mm) pitch, sit on
// TOP — the lip's top edge, where the next bin stacks — as every part's
// do on its bounding box's top face (the web app places them there).
//
// The geometry is NOT reimplemented here. This is a thin wrapper that
// calls new_bin()/bin_render() from the upstream reference
// implementation, vendored as vendor/gridfinity-rebuilt
// (kennetek/gridfinity-rebuilt-openscad, MIT) — the same calls its own
// bin generator (gridfinity-rebuilt-bins.scad) makes. All this file adds
// is the repo's slot convention: a BOSL2 attachable() envelope and the
// anchors. Heights, the lip profile, the wall, compartments, scoops,
// tabs, magnet and screw holes all come from upstream.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>

include <../../vendor/gridfinity-rebuilt/src/core/standard.scad>
use <../../vendor/gridfinity-rebuilt/src/core/gridfinity-rebuilt-utility.scad>
use <../../vendor/gridfinity-rebuilt/src/core/gridfinity-rebuilt-holes.scad>
use <../../vendor/gridfinity-rebuilt/src/core/bin.scad>
use <../../vendor/gridfinity-rebuilt/src/core/cutouts.scad>

module gf_bin(gx = 1, gy = 1, gz = 3, filled = false, divx = 1, divy = 1,
              scoop = true, tabs = true, lip = true,
              magnets = false, screws = false,
              anchor = BOTTOM, spin = 0, orient = UP) {
    assert(gz * 7 >= BASE_HEIGHT, "gf_bin: gz must be at least 1");
    assert(filled || (divx >= 1 && divy >= 1), "gf_bin: divx and divy must be at least 1");

    // Upstream's defaults for its bin generator, as the base part's.
    holes = bundle_hole_options(
        magnet_hole = magnets,
        screw_hole  = screws,
        crush_ribs  = magnets,
        chamfer     = magnets || screws,
        supportless = false);

    // gridz_define 0 (7mm units, the lip not counted), no z snap: what
    // upstream's generator does by default.
    bin = new_bin(grid_size = [gx, gy], height_mm = height(gz, 0, false),
                  include_lip = lip, hole_options = holes);

    // Upstream's generator renders at $fa = 4, $fs = 0.25 (its file
    // level). The lip's height depends on its fillet's facets, so the
    // envelope is measured at the same detail the bin is drawn at.
    fa = detail_fa(4);
    fs = detail_fs(0.25);
    size = let($fa = fa, $fs = fs) bin_get_bounding_box(bin);
    slot_pitch = GRID_DIMENSIONS_MM.x / 3;
    anchors = concat([mount_anchor(size.z / 2)], grid_mount_anchors(size, slot_pitch, size.z / 2));

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // Passed on this call alone, as the base part does, so a part
        // stacked on the bin keeps its own detail.
        down(size.z / 2)
            gf_bin_render(bin, filled, divx, divy, scoop, tabs, $fa = fa, $fs = fs);
        children();
    }
}

// The bin, solid or subdivided — upstream's generator's own body.
module gf_bin_render(bin, filled, divx, divy, scoop, tabs) {
    if (filled)
        bin_render(bin);
    else
        bin_render(bin)
            bin_subdivide(bin, [divx, divy])
                cut_compartment_auto(cgs(height = 0), tabs ? 1 : 5, false, scoop ? 1 : 0);
}
