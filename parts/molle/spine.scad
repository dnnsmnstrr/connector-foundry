// MOLLE spine: hangs a part on MOLLE / PALS webbing (a backpack, a
// vest, a pouch). Functional face is BOTTOM, the tongue's back, against
// the backing; "mount" is on TOP, the plate's front, where a holder, a
// GoPro mount or anything else on the Bench fuses on.
//
// Each tongue (lib/molle.scad) slides down behind `rows` rows of one
// column, from above; the plate comes down in front of the webbing and
// the barb clicks in under the bottom row. With cols = 2 there are two
// tongues, 38.1 mm apart, for two columns side by side: they stop the
// part swinging. `webbing` is the gap between tongue and plate, the
// webbing's thickness: tighter grips better and goes in harder.
//
// Prints on its side (the profile flat on the bed), so the layers run
// along the tongue and round the bridge, and the tongue flexes rather
// than splitting along a layer.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/molle.scad>

module molle_spine(rows = 2, cols = 1, webbing = PALS_WEB_T, plate = 3,
                   anchor = BOTTOM, spin = 0, orient = UP) {
    assert(rows >= 1 && rows == round(rows), "rows must be a whole number, at least 1");
    assert(cols >= 1 && cols == round(cols), "cols must be a whole number, at least 1");
    assert(webbing >= 1, "webbing must be at least 1mm");
    assert(plate >= 1.5, "plate must be at least 1.5mm");

    y_min = molle_tip_y(rows);
    y_max = MOLLE_BRIDGE_T;
    z_plate = MOLLE_TONGUE_T + webbing;
    size = [cols * PALS_COL_PITCH - 4, y_max - y_min, z_plate + plate];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, -(y_min + y_max) / 2, -size.z / 2]) {
            // the plate, from the barb's catch to the top of the bridge
            translate([-size.x / 2, molle_catch_y(rows), z_plate])
                cube([size.x, y_max - molle_catch_y(rows), plate]);
            // the tongues: the (y, z) profile extruded across x
            for (i = [0 : cols - 1])
                translate([(i - (cols - 1) / 2) * PALS_COL_PITCH - MOLLE_TONGUE_W / 2, 0, 0])
                    multmatrix([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0]])
                        linear_extrude(MOLLE_TONGUE_W) molle_tongue_profile(rows, webbing);
        }
        children();
    }
}
