// MOD-GRID pin — the snap pin every MOD-GRID accessory plugs into a
// grid with, for putting on any part: fused onto it on the Bench, the
// part plugs into a MOD-GRID grid (parts/modgrid/grid.scad). MOD-GRID is
// by 3dedc (TinyToolShop), MakerWorld model 2811701, CC BY-NC-SA 4.0 —
// NOT MIT, see the README's "Licensing"; lib/modgrid.scad has the pin
// and where its numbers come from.
//
// The designer ships this as "Modular connector": the two pegs of the
// 2x1 pin alone, to add to your own model. pegs = 1 is a single peg, for
// one hole, centred on the part (the designer's 6mm bit holder is two
// halves of a peg each). `plate` puts a plate behind the pegs, as long
// as the pin and 1.4mm short of its holes' 8mm cells across (14.6mm for
// two pegs, the bit holders' width; 6.6 for one), so the part stands on
// its own; on the Bench it attaches with plate 0, the pegs' roots
// straight on the host's face as in the designer's file. rows spans that
// many rows of the grid, a set of pegs in each; depth is how deep each
// peg goes along its hole (5, the hole, by default).
//
// Orientation: functional face BOTTOM — the pegs, pointing down; "mount"
// on TOP, the plate's top (the pegs' roots with plate 0). The designer
// prints a pin on its side, the pegs' profile flat on the bed, so the
// legs and barbs are drawn out in each layer: turn it that way in the
// slicer, or print the host so.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/modgrid.scad>

// The plate's width across the pegs: their cells, less the 1.4mm the
// designer leaves between two accessories side by side in a row (a bit
// holder's body is 14.6mm across two cells), so 0.15 to 0.2mm inside the
// barbs either side.
function modgrid_plate_width(pegs) = pegs * MODGRID_PITCH - 1.4;

module modgrid_connector(pegs = 2, rows = 1, depth = MODGRID_PIN_DEPTH, plate = 1.5,
                         anchor = BOTTOM, spin = 0, orient = UP) {
    assert(pegs == 1 || pegs == 2, "pegs must be 1 or 2");
    assert(rows >= 1 && rows == round(rows), "rows must be a whole number, at least 1");
    assert(depth >= 2 && depth <= MODGRID_HOLE, "depth must be from 2 to 5 (the hole)");
    assert(plate >= 0, "plate must not be negative");
    length = (rows - 1) * MODGRID_PITCH + depth;
    width = modgrid_plate_width(pegs);
    size = [modgrid_pin_width(pegs), length, MODGRID_PIN_LEN + plate];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        // Profile frame to part frame: a quarter turn about X takes the
        // pegs (-y) down and the depth (+z) to -y; then centred. render()
        // merges pegs and plate, which the preview (the README gallery)
        // otherwise draws in two colours.
        translate([0, length / 2, (MODGRID_PIN_LEN - plate) / 2]) rotate([90, 0, 0]) render(convexity = 4) {
            modgrid_pin(depth, rows, overlap = plate > 0 ? 0.01 : 0, pegs = pegs,
                        $fa = detail_fa(6), $fs = detail_fs(0.2));
            if (plate > 0)
                translate([-width / 2, 0, 0]) cube([width, plate, length]);
        }
        children();
    }
}
