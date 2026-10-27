// SOLDR: the modular soldering station whose tool modules sit on a
// frame by tapered feet and magnets. Used by parts/soldr/*.scad.
//
// SOLDR is by soldr.pro, its print files published on Printables and
// MakerWorld under CC BY-NC-SA 4.0 — NOT MIT, see the README's
// "Licensing". Nothing here imports the designer's files: the numbers
// below are measured off two of their module STLs (a 1x1 and a 1x2 box)
// and the base is rebuilt from them, so a base can take any size.
// references.yaml holds the rebuilt base to both files.
//
// A module stands on one foot per unit: a square frustum 24.2mm across
// at the bed and 28.8mm at its top, 2mm up (the sides lean out 1.15mm
// per mm, about 49° from the vertical), its corners rounded 1mm all the
// way up. The units are 30.5mm apart, so two neighbouring modules' feet
// leave 1.7mm between them. From z = 2 to 3 a plate ties the feet
// together, units x 30.5 - 1.7mm each way; a module's own body starts on
// it. Each foot has two 6mm magnets, ±7.2mm from its centre along y,
// pressed in from above (or, as this repo adds, one in the middle or
// four on a quarter pitch; see soldr_magnet_spots()): the holes start 0.3mm over the bed and run out
// through the plate's top, with six crush ribs to hold the magnet and a
// 0.6mm round on the top edge to lead it in.
include <../vendor/BOSL2/std.scad>
include <constants.scad>

SOLDR_PITCH    = 30.5;  // unit to unit, both ways
SOLDR_GAP      = 1.7;   // between two neighbouring modules
SOLDR_FOOT_BOT = 24.2;  // a foot across, at the bed
SOLDR_FOOT_TOP = 28.8;  // and at its top: SOLDR_PITCH - SOLDR_GAP
SOLDR_FOOT_H   = 2;
SOLDR_PLATE_T  = 1;     // the plate over the feet
SOLDR_CORNER_R = 1;
SOLDR_H        = SOLDR_FOOT_H + SOLDR_PLATE_T;

// Magnets. The hole is 6.5mm with six ribs standing 0.44mm into it (so
// 5.62mm between opposite ribs), every 60° starting at 30° from x.
SOLDR_MAGNET_OFFSET = 7.2;   // from the foot's centre, along y
SOLDR_MAGNET_D      = 6.5;
SOLDR_MAGNET_FLOOR  = 0.3;   // material under the magnet
SOLDR_MAGNET_ROUND  = 0.6;   // the hole's top edge
SOLDR_RIB_R         = 0.5;
SOLDR_RIB_IN        = 0.44;

// Where a foot's magnets go, from its centre. "two" is the designer's
// pair. "one" puts a single magnet in the middle of the foot. "four" is
// not the designer's either: one per quarter of the unit, a
// quarter pitch (7.625mm) out both ways, so every hole is 15.25mm from
// its neighbours, across the gap to the next unit too. The hole's edge
// is then 1.57mm inside the foot at the magnet's floor.
function soldr_magnet_spots(magnets) =
    magnets == "one"  ? [[0, 0]] :
    magnets == "two"  ? [for (dy = [-1, 1]) [0, dy * SOLDR_MAGNET_OFFSET]] :
    magnets == "four" ? [for (dx = [-1, 1], dy = [-1, 1]) [dx, dy] * SOLDR_PITCH / 4] :
    [];

// A base of gx x gy units, z = 0 to SOLDR_H, centred on the origin in XY.
function soldr_base_size(gx, gy) =
    [gx * SOLDR_PITCH - SOLDR_GAP, gy * SOLDR_PITCH - SOLDR_GAP, SOLDR_H];

// One magnet hole, centred on x = y = 0, from the floor to `top`.
module soldr_magnet_hole(top = SOLDR_H) {
    r = SOLDR_MAGNET_D / 2;
    rr = SOLDR_MAGNET_ROUND;
    difference() {
        rotate_extrude()
            difference() {
                union() {
                    translate([0, SOLDR_MAGNET_FLOOR]) square([r, top - SOLDR_MAGNET_FLOOR + 0.01]);
                    translate([r - 0.01, top - rr]) square([rr + 0.01, rr + 0.01]);
                }
                translate([r + rr, top - rr]) circle(r = rr);
            }
        // The ribs run out at 45° over their top 0.44mm, ending where the
        // round begins, so the magnet goes in over a clean edge and meets
        // them gradually.
        rib_top = top - rr - SOLDR_RIB_IN;
        difference() {
            for (a = [30 : 60 : 330])
                rotate(a) translate([r - SOLDR_RIB_IN + SOLDR_RIB_R, 0, SOLDR_MAGNET_FLOOR - 0.01])
                    cylinder(r = SOLDR_RIB_R, h = top - rr - SOLDR_MAGNET_FLOOR + 0.01);
            translate([0, 0, rib_top]) {
                cylinder(r1 = r - SOLDR_RIB_IN, r2 = r, h = SOLDR_RIB_IN + 0.001);
                translate([0, 0, SOLDR_RIB_IN]) cylinder(r = r, h = rr + 1);
            }
        }
    }
}

// The base: the feet, the plate over them and, with magnets, their holes.
module soldr_base_body(gx, gy, magnets = "two") {
    assert(in_list(magnets, ["one", "two", "four", "none"]),
           "magnets must be \"one\", \"two\", \"four\" or \"none\"");
    size = soldr_base_size(gx, gy);
    centres = [for (i = [0 : gx - 1], j = [0 : gy - 1])
        [(i - (gx - 1) / 2) * SOLDR_PITCH, (j - (gy - 1) / 2) * SOLDR_PITCH]];
    difference() {
        union() {
            // prismoid() is a polyhedron, not a hull(): the browser's
            // OpenSCAD runs hull() through CGAL, which asserts on some
            // rounded shapes. It also keeps the 1mm corners 1mm at both
            // ends, as the designer's feet are, where a scaled
            // linear_extrude would grow them. Its VNF is worked out once
            // and placed per unit: building it is BOSL2 script, about
            // 40ms a foot, which an 8 x 8 base paid 64 times.
            foot = prismoid([SOLDR_FOOT_BOT, SOLDR_FOOT_BOT], [SOLDR_FOOT_TOP, SOLDR_FOOT_TOP],
                            h = SOLDR_FOOT_H, rounding = SOLDR_CORNER_R, anchor = BOTTOM);
            for (c = centres) translate([c.x, c.y, 0]) vnf_polyhedron(foot);
            translate([0, 0, SOLDR_FOOT_H])
                linear_extrude(SOLDR_PLATE_T) rect([size.x, size.y], rounding = SOLDR_CORNER_R);
        }
        for (c = centres, m = soldr_magnet_spots(magnets))
            translate([c.x + m.x, c.y + m.y, 0]) soldr_magnet_hole();
    }
}
