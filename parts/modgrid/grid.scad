// MOD-GRID grid: the plate MOD-GRID accessories snap into, any number of
// holes each way. MOD-GRID is by 3dedc (TinyToolShop), MakerWorld model
// 2811701, CC BY-NC-SA 4.0 — NOT MIT, see the README's "Licensing";
// lib/modgrid.scad has the numbers and where they come from.
//
// A 3mm plate with 5mm square holes on an 8mm pitch, cols across and
// rows up, 3mm corners: exactly cols x 8 + 3 by rows x 8 + 3, the
// designer's 12 x 4 being 99 x 35mm. Every accessory's 2x1 pin
// (parts/modgrid/connector.scad) takes two neighbouring holes of a row.
// The designer's 4x12 has its holes 0.49mm off centre across its length
// (5.01mm from one end to the first hole's centre, 5.98 at the other,
// where the rows are 5.5 from both sides); here they are centred, 5.5
// all round.
//
// Functional face is BOTTOM, the front the accessories go into, which is
// also the print orientation (flat on the bed either way up: the holes
// go straight through). "mount" is on TOP, the back, for fusing the grid
// onto a case or a lid; "bot" is the front.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/modgrid.scad>

module modgrid_grid(cols = 12, rows = 4, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(cols >= 1 && rows >= 1, "cols and rows must be at least 1");
    assert(cols == round(cols) && rows == round(rows), "cols and rows must be whole numbers");
    size = modgrid_grid_size(cols, rows);

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) modgrid_grid_plate(cols, rows, $fa = detail_fa(6), $fs = detail_fs(0.5));
        children();
    }
}
