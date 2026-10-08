// Skådis pegboard: the slot, its pattern, and the hook tab that
// hangs things on it. Used by parts/skadis/*.scad; the Holes tab cuts the
// same slot as a pill (web/src/lib/screwPresets.js's "skadis-slot") and
// lays the pattern out with its Repeat form's "Skådis spacing".
//
// There is no published Skådis spec and no permissively
// licensed model to vendor. The numbers are the board's, as the
// community's OpenSCAD libraries agree on them: franpoli's
// Skådis library (GPL-3.0) and breckenedge's parametric-skadis-tower
// (CC-BY-SA 4.0), both measured against in references.yaml, neither
// vendored. melance's skadis.scad (GPL-3.0) puts its pegs 45 mm apart,
// not 40; the other two, and a real board, say 40.
//
// The pattern is a checkerboard on a 20 mm grid: a slot in every other
// cell, so 40 mm apart along a row, rows 20 mm apart, every other row
// shifted 20 mm. A slot is a 5 x 15 mm stadium, upright, through a 5 mm
// board.
//
// Frame: a board's front face at z = 0, +y up the board.
include <constants.scad>

SKADIS_PITCH  = 20;   // the grid: half the spacing along a row, the row spacing
SKADIS_SLOT_W = 5;
SKADIS_SLOT_H = 15;
SKADIS_BOARD_T = 5;
// Printed slots come out narrow and a moulded hook binds in them: cut
// slots this much wider (the tower's slot_fit; the Holes tab's preset
// is cut the same).
SKADIS_SLOT_FIT = 0.2;

// The hook tab: an arm through the slot, and a hook down behind the
// board. Arm and hook together are SKADIS_TAB_W x (SKADIS_ARM_H +
// SKADIS_HOOK_DROP) = 4.4 x 11 mm face on, which passes straight through
// a 5 x 15 slot (its corners clear the slot's round ends). Lowered
// SKADIS_HOOK_DROP, the arm's round bottom sits in the slot's round end
// and the hook hangs behind the board below the slot.
SKADIS_TAB_W      = 4.4;
SKADIS_ARM_H      = 5;
SKADIS_HOOK_DROP  = 6;
SKADIS_HOOK_T     = 3;   // the hook's thickness behind the board
SKADIS_ARM_REACH  = SKADIS_BOARD_T + 0.5; // board plus play

// One slot's outline, centred on the origin, its length along y.
module skadis_slot_outline(fit = SKADIS_SLOT_FIT) {
    w = SKADIS_SLOT_W + fit;
    hull() for (s = [-1, 1]) translate([0, s * (SKADIS_SLOT_H - w) / 2]) circle(d = w, $fn = 48);
}

// Slot centres for a board `cols` slots across (in a full row; a half
// is one more cell) and `rows` rows up: one per cell of a 2cols x rows
// grid where (i + j) is even, the board centred on the origin.
function skadis_slot_centres(cols, rows) =
    let (w = 2 * cols * SKADIS_PITCH, h = rows * SKADIS_PITCH)
    [for (j = [0 : rows - 1], i = [0 : 2 * cols - 1]) if ((i + j) % 2 == 0)
        [(i + 0.5) * SKADIS_PITCH - w / 2, (j + 0.5) * SKADIS_PITCH - h / 2]];

// One hook tab, the board's front face at z = 0 and the tab reaching in
// along -z; its arm's bottom (where it rests in the slot) at y = 0.
module skadis_tab() {
    r = SKADIS_TAB_W / 2;
    // The arm: round underneath, to sit in the slot's round end.
    translate([0, 0, -SKADIS_ARM_REACH])
        linear_extrude(SKADIS_ARM_REACH + 0.01)
            hull() {
                translate([0, r]) circle(r = r, $fn = 48);
                translate([-r, r]) square([SKADIS_TAB_W, SKADIS_ARM_H - r]);
            }
    // The hook, down behind the board.
    translate([-r, -SKADIS_HOOK_DROP, -SKADIS_ARM_REACH - SKADIS_HOOK_T])
        cube([SKADIS_TAB_W, SKADIS_HOOK_DROP + SKADIS_ARM_H, SKADIS_HOOK_T + 0.01]);
}
