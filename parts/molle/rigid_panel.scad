// MOLLE rigid panel: a sheet with open windows, like the steel panels
// bolted into trucks and seat backs, that pouch straps wrap round and
// molle/insert plugs into. Functional face is BOTTOM, the front, which
// is also the print orientation (flat on the bed either way up); "mount"
// is on TOP, the back. "bot" is the front.
//
// Rigid panels have no standard: count, size, corner radius and pitch
// of the openings are all parameters (lib/molle.scad has the defaults
// and where they come from). Openings sit centred in cols x rows cells
// of pitch_x by pitch_y, so a panel is exactly that size and panels butt
// together with the grid carrying on across the joint. Mounting holes
// for the panel itself come from the Holes tab.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/molle.scad>

module molle_rigid_panel(cols = 4, rows = 3, open_w = RIGID_OPEN_W, open_h = RIGID_OPEN_H,
                         open_r = RIGID_OPEN_R, pitch_x = RIGID_PITCH_X, pitch_y = RIGID_PITCH_Y,
                         thickness = 4, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && cols == round(cols), "cols must be a whole number, at least 1");
    assert(rows >= 1 && rows == round(rows), "rows must be a whole number, at least 1");
    assert(open_w > 0 && open_h > 0, "open_w and open_h must be positive");
    assert(open_r >= 0, "open_r must not be negative");
    assert(pitch_x >= open_w + 2, "pitch_x must leave at least a 2mm bar between openings");
    assert(pitch_y >= open_h + 2, "pitch_y must leave at least a 2mm bar between openings");
    assert(thickness >= 1, "thickness must be at least 1mm");
    size = [cols * pitch_x, rows * pitch_y, thickness];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) difference() {
            translate([-size.x / 2, -size.y / 2, 0]) cube(size);
            for (c = rigid_opening_centres(cols, rows, [pitch_x, pitch_y]))
                translate([c.x, c.y, -1]) linear_extrude(size.z + 2)
                    rigid_opening_outline(open_w, open_h, open_r);
        }
        children();
    }
}
