// MOLLE panel: a printed panel that MOLLE pouches and spines attach to,
// like a laser-cut MOLLE panel. Functional face is BOTTOM, the front the
// pouches go on, which is also the print orientation (front down, ribs
// up, no supports); "mount" is on TOP, the backs of the ribs, against a
// wall, a case lid or another part. "bot" is the front.
//
// The front skin has a slit every 25.4 mm up and every 38.1 mm across
// (lib/molle.scad); a pouch strap goes in at one slit, behind the strip,
// out at the next. Behind the skin, ribs where a sewn panel has its
// bar-tacks leave a `channel` mm deep gap down each column for the strap
// to run in. channel = 0 leaves the bare slotted skin, for a panel that
// stands off whatever it is mounted on some other way.
//
// cols x rows counts columns and strips (rows + 1 rows of slits). A
// panel is exactly cols x 38.1 by (rows + 1) x 25.4, so panels butt
// together and the grid carries on across the joint.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/molle.scad>

module molle_panel(cols = 3, rows = 4, channel = 3, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && cols == round(cols), "cols must be a whole number, at least 1");
    assert(rows >= 1 && rows == round(rows), "rows must be a whole number, at least 1");
    assert(channel >= 0, "channel must not be negative");
    size = [cols * PALS_COL_PITCH, (rows + 1) * PALS_WEB_W, MOLLE_SKIN_T + channel];
    band = (PALS_WEB_W - MOLLE_SLIT_H) / 2;  // top and bottom edge, outside the slits

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) {
            difference() {
                translate([-size.x / 2, -size.y / 2, 0]) cube([size.x, size.y, MOLLE_SKIN_T]);
                for (c = molle_slit_centres(cols, rows))
                    translate([c.x, c.y, -1]) linear_extrude(MOLLE_SKIN_T + 2) molle_slit_outline();
            }
            if (channel > 0) {
                // ribs at the bar-tacks, halved at the panel's sides
                for (k = [0 : cols]) {
                    x0 = max(-size.x / 2, k * PALS_COL_PITCH - size.x / 2 - MOLLE_RIB_W / 2);
                    x1 = min(size.x / 2, k * PALS_COL_PITCH - size.x / 2 + MOLLE_RIB_W / 2);
                    translate([x0, -size.y / 2, MOLLE_SKIN_T - 0.01])
                        cube([x1 - x0, size.y, channel + 0.01]);
                }
                // top and bottom edges, full depth outside the slits
                for (s = [-1, 1])
                    translate([-size.x / 2, s > 0 ? size.y / 2 - band : -size.y / 2, MOLLE_SKIN_T - 0.01])
                        cube([size.x, band, channel + 0.01]);
            }
        }
        children();
    }
}
