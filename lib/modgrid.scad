// MOD-GRID: a pocket-sized tool grid and the snap pin its accessories
// plug in with. Used by parts/modgrid/*.scad.
//
// MOD-GRID is by 3dedc (TinyToolShop), published as MakerWorld model
// 2811701 under CC BY-NC-SA 4.0 — NOT MIT, see the README's
// "Licensing". Nothing here imports the designer's files: the numbers
// below are measured off their v4 STLs (the 4x12 grid, the "Modular
// connector" and the 4mm, 6mm and Leatherman bit holders) and the
// geometry is rebuilt from them, so a grid can take any size and the pin
// can go on any part. references.yaml holds the rebuilt parts to those
// files.
//
// The grid is a 3mm plate with 5mm square holes through it on an 8mm
// pitch, and 1.5mm of plate past the outer cells (so 3mm of wall between
// two holes and 5.5mm from a hole's centre to the edge): a grid is
// exactly cells x 8 + 3, the designer's 4 x 12 being 35 x 99mm.
//
// Every accessory carries the same 2x1 pin: two snap pegs, one per hole,
// in two neighbouring holes of a row. Each peg is a U turned upside
// down — two legs either side of a slot, each leg ending in a barb that
// springs out under the grid. The legs taper out from the root down to
// the barbs, 4.48 to 4.9mm across, and the barbs stand 3.548mm below the
// root: 0.548mm under a 3mm grid's back. Their tips are rounded, 1mm,
// at both ends of the peg, so a peg finds its way into the square hole.
// A peg is 5mm deep along the hole (the connector, the Leatherman
// holder; the hex bit holders' are 4.9).
//
// Frame for everything in this file (the "profile frame", the way the
// designer models and prints an accessory): the profile in XY, extruded
// along +Z from z = 0; the pin's root on y = 0 with the pegs pointing
// to -y. The parts turn it into the slot convention, pegs down.
include <../vendor/BOSL2/std.scad>
include <constants.scad>

// The grid.
MODGRID_PITCH    = 8;    // hole to hole, both ways
MODGRID_HOLE     = 5;    // square
MODGRID_T        = 3;    // plate thickness
MODGRID_EDGE     = 1.5;  // plate past the outer cells' 8mm squares
MODGRID_CORNER_R = 3;

// The pin. Measured on the v4 connector, and the same to within 0.01mm
// on every bit holder. The two pegs' centres are 8.1mm apart, 0.1 more
// than the holes': the outer legs come within 0.03mm of their holes'
// outer walls at the grid's back, the inner ones keep 0.13.
MODGRID_PIN_SPREAD = 8.1;
MODGRID_PIN_ROOT   = 2.24;   // half the peg's width at the root
MODGRID_PIN_LEDGE  = 2.45;   // half its width where the barbs start
MODGRID_PIN_BARB   = 3.45;   // half its width over the barbs
MODGRID_PIN_DROP   = 3.548;  // root to the barbs' flat tops
MODGRID_PIN_LEN    = 5.298;  // root to the tips; the barbs' faces are 45°
MODGRID_PIN_SLOT   = 1.45;   // half the slot between the legs
MODGRID_PIN_SLOT_TOP = 0.3;  // the slot stops this far short of the root
MODGRID_PIN_SLOT_R = 1;      // with its two top corners rounded this much
MODGRID_PIN_TIP_R  = 1;      // the tips' rounding, at each end of the peg
MODGRID_PIN_DEPTH  = 5;      // along the hole

// Width over the barbs of a pair, the pin's footprint across.
MODGRID_PIN_W = MODGRID_PIN_SPREAD + 2 * MODGRID_PIN_BARB;

// The same for a pin of 1 or 2 pegs.
function modgrid_pin_width(pegs = 2) = pegs == 1 ? 2 * MODGRID_PIN_BARB : MODGRID_PIN_W;

// A grid of cols x rows holes, the plate on z = 0 to MODGRID_T, centred
// on the origin in XY. (Not in the profile frame: it is the grid itself.)
function modgrid_grid_size(cols, rows) =
    [cols * MODGRID_PITCH + 2 * MODGRID_EDGE, rows * MODGRID_PITCH + 2 * MODGRID_EDGE, MODGRID_T];

module modgrid_grid_plate(cols, rows) {
    size = modgrid_grid_size(cols, rows);
    linear_extrude(size.z)
        difference() {
            rect([size.x, size.y], rounding = MODGRID_CORNER_R);
            for (i = [0 : cols - 1], j = [0 : rows - 1])
                translate([(i - (cols - 1) / 2) * MODGRID_PITCH, (j - (rows - 1) / 2) * MODGRID_PITCH])
                    square(MODGRID_HOLE, center = true);
        }
}

// One peg's profile, centred on x = 0. `overlap` carries the root that
// far up past y = 0, into the body the peg is unioned with, so the two
// do not meet on a shared face.
module modgrid_peg_profile(overlap = 0) {
    tip = MODGRID_PIN_BARB - (MODGRID_PIN_LEN - MODGRID_PIN_DROP);
    difference() {
        polygon([
            [-MODGRID_PIN_ROOT, overlap], [-MODGRID_PIN_ROOT, 0],
            [-MODGRID_PIN_LEDGE, -MODGRID_PIN_DROP], [-MODGRID_PIN_BARB, -MODGRID_PIN_DROP],
            [-tip, -MODGRID_PIN_LEN], [tip, -MODGRID_PIN_LEN],
            [MODGRID_PIN_BARB, -MODGRID_PIN_DROP], [MODGRID_PIN_LEDGE, -MODGRID_PIN_DROP],
            [MODGRID_PIN_ROOT, 0], [MODGRID_PIN_ROOT, overlap],
        ]);
        // The slot, run out past the tips so only its top corners round.
        offset(r = MODGRID_PIN_SLOT_R) offset(delta = -MODGRID_PIN_SLOT_R)
            translate([-MODGRID_PIN_SLOT, -MODGRID_PIN_LEN - 2 * MODGRID_PIN_SLOT_R])
                square([2 * MODGRID_PIN_SLOT, MODGRID_PIN_LEN + 2 * MODGRID_PIN_SLOT_R - MODGRID_PIN_SLOT_TOP]);
    }
}

// One peg, `depth` deep along z, its tips rounded at both ends: in the
// plane of the peg's length and depth, the last MODGRID_PIN_TIP_R of it
// is a half-round, so the tips' corners are gone at z = 0 and z = depth.
module modgrid_peg(depth = MODGRID_PIN_DEPTH, overlap = 0) {
    assert(depth >= 2 * MODGRID_PIN_TIP_R, "a peg must be at least 2mm deep");
    r = MODGRID_PIN_TIP_R;
    w = 2 * MODGRID_PIN_BARB + 2;
    y0 = -MODGRID_PIN_LEN + r;
    // render(): OpenSCAD's preview (the README gallery, the GUI) draws an
    // intersection with see-through patches unless it is merged first.
    render(convexity = 4) intersection() {
        linear_extrude(depth) modgrid_peg_profile(overlap);
        union() {
            translate([-w / 2, y0, -1]) cube([w, MODGRID_PIN_LEN + overlap + 1, depth + 2]);
            translate([-w / 2, -MODGRID_PIN_LEN - 1, r]) cube([w, 1 + r + 0.01, depth - 2 * r]);
            for (z = [r, depth - r])
                translate([0, y0, z]) rotate([0, 90, 0]) cylinder(r = r, h = w, center = true);
        }
    }
}

// The 2x1 pin: a peg for each of two neighbouring holes in a row,
// centred on x = 0. With pegs = 1, a single peg on x = 0, for one hole:
// centred in it, its legs keep 0.08mm from the walls at the grid's back
// either side. With rows > 1, one more set every MODGRID_PITCH along z,
// for a part that spans that many rows of the grid.
module modgrid_pin(depth = MODGRID_PIN_DEPTH, rows = 1, overlap = 0, pegs = 2) {
    assert(pegs == 1 || pegs == 2, "pegs must be 1 or 2");
    for (k = [0 : rows - 1], x = pegs == 1 ? [0] : [-1, 1] * MODGRID_PIN_SPREAD / 2)
        translate([x, 0, k * MODGRID_PITCH]) modgrid_peg(depth, overlap);
}
