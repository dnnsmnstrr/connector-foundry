// MOD-GRID pin — the snap pin every MOD-GRID accessory plugs into a
// grid with, for putting on any part: fused onto it on the Bench, the
// part plugs into a MOD-GRID grid (parts/modgrid/grid.scad). MOD-GRID is
// by 3dedc (TinyToolShop), MakerWorld model 2811701, CC BY-NC-SA 4.0 —
// NOT MIT, see the README's "Licensing"; lib/modgrid.scad has the pin
// and where its numbers come from.
//
// The designer ships this as "Modular connector": the two pegs of the
// 2x1 pin alone, to add to your own model. These are the same two pegs
// reshaped to bend rather than snap (lib/modgrid.scad says how and why).
// pegs = 1 is a single peg, for one hole, centred on the part (the
// designer's 6mm bit holder is two halves of a peg each). `plate` puts a
// plate behind the pegs, as long as the pin and 1.4mm short of its
// holes' 8mm cells across (14.6mm for two pegs, the bit holders' width;
// 6.6 for one), so the part stands on its own; on the Bench it attaches
// with plate 0, the pegs' roots straight on the host's face as in the
// designer's file. rows spans that many rows of the grid, a set of pegs
// in each; depth is how deep each peg goes along its hole (4.8 by
// default, 0.1mm clear of the 5mm hole either side).
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
// holder's body is 14.6mm across two cells), so 0.5mm outside the barbs
// either side.
function modgrid_plate_width(pegs) = pegs * MODGRID_PITCH - 1.4;

function modgrid_connector_pin_length(style, depth) =
    style == "bitbeam" ? 4 : style == "dowel" ? depth : MODGRID_PIN_LEN;

function modgrid_connector_width(pegs, style) =
    style == "bitbeam" ? (pegs == 1 ? BITBEAM_SQUARE_W : MODGRID_PITCH + BITBEAM_SQUARE_W) :
    modgrid_plate_width(pegs);

// The v2 dowel prototype uses a 4.8mm projection into the grid and
// tested at 4.65mm across, leaving 0.175mm clearance on each side.
MODGRID_DOWEL_W = 4.65;
MODGRID_DOWEL_SLOT = 0.7;
MODGRID_DOWEL_ROOT = 0.55;
MODGRID_DOWEL_TIP_BORE_RATIO = 0.60;
MODGRID_DOWEL_BORE_CLEARANCE = 0.20;

// The BitBeam-style experiment was checked as a short, square split pin:
// 4mm projecting length, a 4.6mm shaft, and a 4.9mm entry tip.
BITBEAM_SQUARE_W = 4.6;
BITBEAM_SQUARE_TIP = 4.9;
BITBEAM_SQUARE_LENGTH = 4;
BITBEAM_SQUARE_TAPER = 0.5;
BITBEAM_SQUARE_SLOT = 0.9;
BITBEAM_SQUARE_FORK = 2;

module modgrid_dowel_peg(depth, screw_diameter, plate) {
    bore_root = screw_diameter + MODGRID_DOWEL_BORE_CLEARANCE;
    bore_tip = screw_diameter * MODGRID_DOWEL_TIP_BORE_RATIO;

    difference() {
        // The tapered entry tip leaves the four slotted petals free to flare.
        hull() {
            translate([0, 0, -depth + 0.55])
                cube([MODGRID_DOWEL_W, MODGRID_DOWEL_W, depth - 0.55], center = [true, true, false]);
            translate([0, 0, -depth])
                cube([MODGRID_DOWEL_W - 0.5, MODGRID_DOWEL_W - 0.5, 0.08], center = [true, true, false]);
        }

        // A screw entered from the carrier side wedges the tip petals outward.
        translate([0, 0, -depth]) cylinder(d1 = bore_tip, d2 = bore_root, h = depth);
        translate([0, 0, -0.01]) cylinder(d = bore_root, h = plate + 0.02);
        translate([-MODGRID_DOWEL_SLOT / 2, -MODGRID_DOWEL_W / 2 - 0.05, -depth - 0.01])
            cube([MODGRID_DOWEL_SLOT, MODGRID_DOWEL_W + 0.1, depth - MODGRID_DOWEL_ROOT + 0.02]);
        translate([-MODGRID_DOWEL_W / 2 - 0.05, -MODGRID_DOWEL_SLOT / 2, -depth - 0.01])
            cube([MODGRID_DOWEL_W + 0.1, MODGRID_DOWEL_SLOT, depth - MODGRID_DOWEL_ROOT + 0.02]);
    }
}

module modgrid_bitbeam_square_peg() {
    difference() {
        union() {
            translate([0, 0, -BITBEAM_SQUARE_LENGTH])
                linear_extrude(height = BITBEAM_SQUARE_TAPER, scale = BITBEAM_SQUARE_W / BITBEAM_SQUARE_TIP)
                    square([BITBEAM_SQUARE_TIP, BITBEAM_SQUARE_TIP], center = true);
            translate([0, 0, -BITBEAM_SQUARE_LENGTH + BITBEAM_SQUARE_TAPER])
                cube([BITBEAM_SQUARE_W, BITBEAM_SQUARE_W,
                      BITBEAM_SQUARE_LENGTH - BITBEAM_SQUARE_TAPER], center = [true, true, false]);
        }

        // The fork is at the grid-entry tip, away from the carrier root.
        translate([-BITBEAM_SQUARE_SLOT / 2, -BITBEAM_SQUARE_TIP, -BITBEAM_SQUARE_LENGTH - 0.01])
            cube([BITBEAM_SQUARE_SLOT, 2 * BITBEAM_SQUARE_TIP, BITBEAM_SQUARE_FORK + 0.02]);
    }
}

module modgrid_connector(pegs = 2, rows = 1, depth = MODGRID_PIN_DEPTH, plate = 1.5,
                         style = "compliant", screw_diameter = 2.0,
                         anchor = BOTTOM, spin = 0, orient = UP) {
    assert(pegs == 1 || pegs == 2, "pegs must be 1 or 2");
    assert(rows >= 1 && rows == round(rows), "rows must be a whole number, at least 1");
    assert(depth >= 2 && depth <= MODGRID_HOLE, "depth must be from 2 to 5 (the hole)");
    assert(plate >= 0, "plate must not be negative");
    assert(in_list(style, ["compliant", "dowel", "bitbeam"]), "style must be compliant, dowel or bitbeam");
    assert(screw_diameter >= 1.5 && screw_diameter <= 2.6,
           "screw_diameter must be from 1.5 to 2.6mm");
    length = (rows - 1) * MODGRID_PITCH + depth;
    pin_length = modgrid_connector_pin_length(style, depth);
    peg_width = style == "dowel" ? MODGRID_DOWEL_W : BITBEAM_SQUARE_W;
    peg_span = pegs == 1 ? peg_width : MODGRID_PITCH + peg_width;
    carrier_width = modgrid_connector_width(pegs, style);
    width = style == "compliant" ? (plate > 0 ? max(carrier_width, modgrid_pin_width(pegs)) :
             modgrid_pin_width(pegs)) : (plate > 0 ? max(carrier_width, peg_span) : peg_span);
    part_length = style == "bitbeam" ? (rows - 1) * MODGRID_PITCH + BITBEAM_SQUARE_W :
                  style == "dowel" ? (rows - 1) * MODGRID_PITCH + max(depth, MODGRID_DOWEL_W) : length;
    size = [width, part_length, pin_length + plate];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        if (style == "compliant") {
            // Keep the established profile frame and exact dimensions for
            // the default connector, which is checked against the reference grid.
            translate([0, length / 2, (MODGRID_PIN_LEN - plate) / 2]) rotate([90, 0, 0]) render(convexity = 4) {
                modgrid_pin(depth, rows, overlap = plate > 0 ? 0.01 : 0, pegs = pegs,
                            $fa = detail_fa(6), $fs = detail_fs(0.2));
                if (plate > 0)
                    translate([-carrier_width / 2, 0, 0]) cube([carrier_width, plate, length]);
            }
        } else {
            // These test styles use the prototype's square pins directly in
            // the part frame: their roots meet the carrier, and their tips
            // point down toward the grid. The full volume is merged so the
            // browser preview shows one solid, as the compliant branch does.
            translate([0, 0, (pin_length - plate) / 2]) render(convexity = 4) {
                if (plate > 0)
                    difference() {
                        translate([-carrier_width / 2, -part_length / 2, 0])
                            cube([carrier_width, part_length, plate]);
                        if (style == "dowel")
                            for (row = [0 : rows - 1], x = pegs == 1 ? [0] : [-MODGRID_PITCH / 2, MODGRID_PITCH / 2]) {
                                y = (row - (rows - 1) / 2) * MODGRID_PITCH;
                                translate([x, y, -0.01])
                                    cylinder(d = screw_diameter + MODGRID_DOWEL_BORE_CLEARANCE, h = plate + 0.02);
                            }
                    }
                for (row = [0 : rows - 1], x = pegs == 1 ? [0] : [-MODGRID_PITCH / 2, MODGRID_PITCH / 2]) {
                    y = (row - (rows - 1) / 2) * MODGRID_PITCH;
                    translate([x, y, 0])
                        if (style == "dowel") modgrid_dowel_peg(depth, screw_diameter, plate);
                        else modgrid_bitbeam_square_peg();
                }
            }
        }
        children();
    }
}
