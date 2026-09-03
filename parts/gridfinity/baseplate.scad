// Gridfinity baseplate — the frame bins sit in. Like parts/gridfinity/
// base.scad this is a thin wrapper: gridfinityBaseplate() from the
// vendored reference implementation (kennetek/gridfinity-rebuilt-openscad,
// MIT) does all the geometry; this file only adds the repo's slot
// convention.
//
// Convention: the functional face is BOTTOM, so the plate is modelled
// POCKETS DOWN — the flat back faces up and carries "mount" (plus a
// "mount_<i>_<j>" grid at GRID_DIMENSIONS_MM.x/3, the same 14mm free
// subdivision the bin base uses), and "bot" is the centre of the pocket
// face. That is the opposite of how it prints: turn it back-down in the
// slicer. The trade-off is deliberate — on the Bench the back is the
// face you fasten to something else, and every other part here puts
// that face on TOP.
//
// Upstream builds the plate pockets-up, centred in x/y, sitting on z=0,
// (BASEPLATE_HEIGHT + calculate_offset(...)) tall; both functions come
// from the vendored file, so the declared size tracks upstream. `style`
// and `screw_holes` map onto upstream's numeric style_plate/style_hole.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>

include <../../vendor/gridfinity-rebuilt/src/core/standard.scad>
include <../../vendor/gridfinity-rebuilt/src/core/gridfinity-baseplate.scad>
use <../../vendor/gridfinity-rebuilt/gridfinity-rebuilt-baseplate.scad>
use <../../vendor/gridfinity-rebuilt/src/core/gridfinity-rebuilt-holes.scad>

GF_BASEPLATE_STYLES = ["thin", "weighted", "skeletonized", "screw_together", "screw_together_minimal"];
GF_BASEPLATE_HOLES  = ["none", "countersink", "counterbore"];

module gf_baseplate(gx = 1, gy = 1, style = "thin", magnets = false, screw_holes = "none",
                    anchor = BOTTOM, spin = 0, orient = UP) {
    style_plate = search([style], GF_BASEPLATE_STYLES)[0];
    style_hole  = search([screw_holes], GF_BASEPLATE_HOLES)[0];
    assert(style_plate != [], str("gf_baseplate: style must be one of ", GF_BASEPLATE_STYLES));
    assert(style_hole != [], str("gf_baseplate: screw_holes must be one of ", GF_BASEPLATE_HOLES));

    // Magnet holes only exist on the styles with material behind the
    // pockets (weighted/skeletonized/screw-together); upstream ignores
    // them on the minimal styles, and so does its height calculation.
    holes = bundle_hole_options(magnet_hole = magnets, crush_ribs = magnets, chamfer = magnets);
    height = BASEPLATE_HEIGHT + calculate_offset(style_plate, magnets, style_hole);
    size = [gx * GRID_DIMENSIONS_MM.x, gy * GRID_DIMENSIONS_MM.y, height];

    slot_pitch = GRID_DIMENSIONS_MM.x / 3;
    anchors = concat(
        [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)],
        grid_mount_anchors(size, slot_pitch, size.z / 2));

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // Upstream sits on z=0 pockets up; flip it about X so the pockets
        // face down and the back is on top, then centre it.
        xrot(180) down(size.z / 2)
            gridfinityBaseplate([gx, gy], GRID_DIMENSIONS_MM.x, [0, 0],
                                style_plate, holes, style_hole);
        children();
    }
}
