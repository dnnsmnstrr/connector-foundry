// MOD-GRID: a pocket-sized tool grid and the snap pin its accessories
// plug in with. Used by parts/modgrid/*.scad.
//
// MOD-GRID is by 3dedc (TinyToolShop), published as MakerWorld model
// 2811701 under CC BY-NC-SA 4.0 — NOT MIT, see the README's
// "Licensing". Nothing here imports the designer's files: the grid's
// numbers below are measured off their v4 STLs (the 4x12 grid, and the
// 4mm, 6mm and Leatherman bit holders' bodies in
// parts/modgrid/bit_holder.scad) and the geometry is rebuilt from them,
// so a grid can take any size. The pin is the designer's idea but our
// own shape (see below), so it can go on any part and survive a print.
// references.yaml holds the rebuilt parts to those files, and the pin to
// the designer's grid.
//
// The grid is a 3mm plate with 5mm square holes through it on an 8mm
// pitch, and 1.5mm of plate past the outer cells (so 3mm of wall between
// two holes and 5.5mm from a hole's centre to the edge): a grid is
// exactly cells x 8 + 3, the designer's 4 x 12 being 35 x 99mm.
//
// Every accessory carries the same 2x1 pin: two snap pegs, one per hole,
// in two neighbouring holes of a row. Each peg is a U turned upside
// down — two legs either side of a slot, each leg ending in a barb that
// springs out under the grid.
//
// The designer's pin (v4, on every one of their accessories) has barbs
// 6.9mm across for the 5mm hole: each leg has to bend 0.95mm inward to
// get through, on a leg about 3mm long and thinnest (0.8mm) at its root.
// A plane-stress model of that profile puts the root at 8% strain on
// the way in, about twice what printed PLA takes, and printed, the legs
// snapped off instead of bending. So the pin here keeps the designer's
// layout and is reshaped to bend:
//
// - The barbs stand 0.3mm past each wall (MODGRID_PIN_GRIP), and the
//   legs are 0.65mm thick and run up to 0.25mm short of the root: the
//   same model puts them at 2.3% strain, with a sixth of the force per
//   leg (about 10 N against 57 in PLA).
// - A 30° lead-in (from the peg's axis) takes them into the hole
//   gently; a 45° latch face behind it, set to cross the hole's back
//   edge 0.1mm outside the wall (MODGRID_PIN_PRELOAD), holds them. Once
//   seated, each leg is still bent that 0.1mm against the edge, which
//   pulls the part flush onto the grid and centres it: no rattle, on a
//   grid printed anywhere from 2.9 to 3.1mm thick. Pulling it out takes
//   nearly twice the push.
// - 0.2mm of room either side of the legs, and 0.1mm along the hole (the
//   peg is 4.8mm deep): only the barbs touch the hole on the way in.
//   Each end of a peg's tips is rounded 1mm along the hole, so the peg
//   finds its way into the square hole.
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

// The pin. Its two pegs sit on the holes' 8mm pitch, so every leg meets
// its wall the same.
MODGRID_PIN_BODY    = 2.3;   // half the peg's width, root to latch
MODGRID_PIN_GRIP    = 0.3;   // each barb's crest past its hole's wall
MODGRID_PIN_PRELOAD = 0.1;   // the latch face past the wall at the grid's back
MODGRID_PIN_LATCH   = 45;    // the latch face, degrees from the peg's axis
MODGRID_PIN_LEAD    = 30;    // the lead-in, degrees from the axis
MODGRID_PIN_TIP     = 2.1;   // half the width at the tips
MODGRID_PIN_SLOT    = 1.65;  // half the slot between the legs
MODGRID_PIN_SLOT_TOP = 0.25; // the slot stops this far short of the root
MODGRID_PIN_SLOT_R  = 0.4;   // with its two top corners rounded this much
MODGRID_PIN_TIP_R   = 1;     // the tips' rounding, at each end of the peg
MODGRID_PIN_DEPTH   = 4.8;   // along the hole

// Where those put the barbs: half the width over them, and how far below
// the root the latch face starts, the crest is and the tips are (2.7,
// 3.2 and 4.41mm: the tips stand 1.41mm out of a 3mm grid's back).
MODGRID_PIN_CREST = MODGRID_HOLE / 2 + MODGRID_PIN_GRIP;
MODGRID_PIN_LATCH_TOP = MODGRID_T - (MODGRID_HOLE / 2 + MODGRID_PIN_PRELOAD - MODGRID_PIN_BODY) / tan(MODGRID_PIN_LATCH);
MODGRID_PIN_DROP = MODGRID_T + (MODGRID_PIN_GRIP - MODGRID_PIN_PRELOAD) / tan(MODGRID_PIN_LATCH);
MODGRID_PIN_LEN  = MODGRID_PIN_DROP + (MODGRID_PIN_CREST - MODGRID_PIN_TIP) / tan(MODGRID_PIN_LEAD);

// Width over the barbs of a pair, the pin's footprint across.
MODGRID_PIN_W = MODGRID_PITCH + 2 * MODGRID_PIN_CREST;

// The same for a pin of 1 or 2 pegs.
function modgrid_pin_width(pegs = 2) = pegs == 1 ? 2 * MODGRID_PIN_CREST : MODGRID_PIN_W;

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
    difference() {
        polygon([
            [-MODGRID_PIN_BODY, overlap], [-MODGRID_PIN_BODY, -MODGRID_PIN_LATCH_TOP],
            [-MODGRID_PIN_CREST, -MODGRID_PIN_DROP], [-MODGRID_PIN_TIP, -MODGRID_PIN_LEN],
            [MODGRID_PIN_TIP, -MODGRID_PIN_LEN], [MODGRID_PIN_CREST, -MODGRID_PIN_DROP],
            [MODGRID_PIN_BODY, -MODGRID_PIN_LATCH_TOP], [MODGRID_PIN_BODY, overlap],
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
    w = 2 * MODGRID_PIN_CREST + 2;
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
// centred on x = 0. With pegs = 1, a single peg on x = 0, for one hole.
// With rows > 1, one more set every MODGRID_PITCH along z, for a part
// that spans that many rows of the grid.
module modgrid_pin(depth = MODGRID_PIN_DEPTH, rows = 1, overlap = 0, pegs = 2) {
    assert(pegs == 1 || pegs == 2, "pegs must be 1 or 2");
    for (k = [0 : rows - 1], x = pegs == 1 ? [0] : [-1, 1] * MODGRID_PITCH / 2)
        translate([x, 0, k * MODGRID_PITCH]) modgrid_peg(depth, overlap);
}
