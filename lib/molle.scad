// MOLLE / PALS: the webbing grid on backpacks, vests and pouches, the
// spine that hangs a part on it, and a printed panel that takes MOLLE
// pouches. Used by parts/molle/*.scad.
//
// PALS has no published geometry drawing and no open model to vendor or
// check against. The grid is defined by its webbing: 25 mm (1") nylon
// webbing (CID A-A-55301A Type III, formerly MIL-W-43668), in horizontal
// rows with a 25 mm gap between them, bar-tacked to the backing every
// 38 mm (1.5"). So a row runs every 50.8 mm, and a pouch's strap weaves
// behind a carrier row, then behind the pouch's own row (which sits in
// the gap), then the next carrier row: something every 25.4 mm. Makers
// differ: webbing is 1" ± 1/16", 1.5-2.5 mm thick, and some add a few
// millimetres between bar-tacks to ease the weave. Hence every number a
// fit depends on is a parameter.
//
// Frame: the backing (the backpack's face) at z = 0, +y up the backpack.
include <constants.scad>

PALS_WEB_W     = 25.4;            // webbing width, and the gap between rows
PALS_ROW_PITCH = 2 * PALS_WEB_W;  // one row to the next
PALS_COL_PITCH = 38.1;            // bar-tack to bar-tack
PALS_WEB_T     = 2;               // webbing thickness, as it sits stitched down

// ------------------------------------------------------------
// The spine. A flat tongue slides down behind a column of webbing rows,
// between the webbing and the backing; a bridge over the top row joins
// it to a plate in front of the webbing, so the webbing is clamped
// between the two. A barb on the tongue's front, just below the bottom
// row, catches that row's lower edge, so the spine cannot ride up and
// out. Its ramp leads going in; to take it off, press the tongue's tip
// back into the backing and lift.
//
// The tongue is narrower than the space between two bar-tacks (38.1,
// less a few mm of stitching), so it goes in anywhere along a row.
// ------------------------------------------------------------
MOLLE_TONGUE_W = 25;
MOLLE_TONGUE_T = 2.5;
MOLLE_BRIDGE_T = 3;     // the bridge, over the top row, along y
MOLLE_BARB_H   = 1.2;   // how far the barb stands off the tongue
MOLLE_BARB_L   = 6;     // its ramp, along y
MOLLE_TIP_L    = 3;     // tongue past the barb, to press on
MOLLE_PLAY     = 1.5;   // bottom row's lower edge to the barb's catch

// From the top edge of the top row to the lower edge of the bottom row.
function molle_span(rows) = (rows - 1) * PALS_ROW_PITCH + PALS_WEB_W;

// Where the barb catches, below the bridge's underside (y = 0).
function molle_catch_y(rows) = -(molle_span(rows) + MOLLE_PLAY);
function molle_tip_y(rows)   = molle_catch_y(rows) - MOLLE_BARB_L - MOLLE_TIP_L;

// One tongue's side profile in (y, z), z = 0 its back on the backing:
// tongue, barb and bridge, up to where the plate starts at z = t + gap.
// The tip's back is chamfered so it finds its way behind the webbing.
module molle_tongue_profile(rows, gap) {
    t  = MOLLE_TONGUE_T;
    yc = molle_catch_y(rows);
    yt = molle_tip_y(rows);
    // the tongue, its tip chamfered on the back
    polygon([[yt, t], [yt + t, 0], [0, 0], [0, t]]);
    // the barb: a ramp up from below, a steep catch on top
    polygon([[yc - MOLLE_BARB_L, t - 0.01], [yc, t - 0.01],
             [yc - 0.5, t + MOLLE_BARB_H]]);
    // the bridge, over the top row
    square([MOLLE_BRIDGE_T, t + gap + 0.01]);
}

// ------------------------------------------------------------
// The panel. A printed stand-in for a laser-cut MOLLE panel: a skin
// with a slit every 25.4 mm up and every 38.1 mm across, so a pouch's
// strap goes in at one slit, behind the strip below it, out at the next
// slit, over the pouch's own webbing and in again. A rigid panel has no
// give, so behind the skin there is a channel down each column for the
// strap to run in, between ribs where the bar-tacks would be.
// ------------------------------------------------------------
MOLLE_SLIT_L  = 30;     // across: a 1" strap and its tolerance
MOLLE_SLIT_H  = 5;      // up: a strap, bent through
MOLLE_SKIN_T  = 2.5;
MOLLE_RIB_W   = PALS_COL_PITCH - MOLLE_SLIT_L - 2;  // 1 mm short of each slit

// One slit's outline, centred on the origin, its length along x.
module molle_slit_outline() {
    r = 1;
    offset(r = r) square([MOLLE_SLIT_L - 2 * r, MOLLE_SLIT_H - 2 * r], center = true);
}

// Slit centres for a panel `cols` columns across and `rows` strips up:
// rows + 1 rows of slits, one per column, the panel centred on the
// origin. The panel is exactly cols x 38.1 by (rows + 1) x 25.4, so
// panels butt together and the grid carries on across the joint.
function molle_slit_centres(cols, rows) =
    let (w = cols * PALS_COL_PITCH, h = (rows + 1) * PALS_WEB_W)
    [for (j = [0 : rows], i = [0 : cols - 1])
        [(i + 0.5) * PALS_COL_PITCH - w / 2, (j + 0.5) * PALS_WEB_W - h / 2]];

// ------------------------------------------------------------
// Rigid panels: steel or aluminium sheet with open windows, the kind
// bolted into trucks and seat backs. There is no standard for these
// either; makers rarely publish their numbers and panels differ. The
// defaults are DV8 Offroad's published 1.5" x 1" opening on PALS
// spacing up (a 25.4 mm bar between rows, a webbing row's worth for a
// pouch strap to wrap) and a 12.7 mm bar between columns. Measure your
// panel and set all of them.
// ------------------------------------------------------------
RIGID_OPEN_W  = 38.1;
RIGID_OPEN_H  = 25.4;
RIGID_OPEN_R  = 3;
RIGID_PITCH_X = 50.8;
RIGID_PITCH_Y = PALS_ROW_PITCH;
RIGID_PANEL_T = 2;      // a real panel's sheet; a printed one wants more

// One opening's outline, centred on the origin, `w` across and `h` up.
module rigid_opening_outline(w, h, r) {
    rr = max(0.01, min(r, w / 2 - 0.01, h / 2 - 0.01));
    offset(r = rr) square([w - 2 * rr, h - 2 * rr], center = true);
}

// Opening centres for `cols` x `rows` openings at `pitch` ([x, y]),
// centred on the origin.
function rigid_opening_centres(cols, rows, pitch) =
    [for (j = [0 : rows - 1], i = [0 : cols - 1])
        [(i - (cols - 1) / 2) * pitch.x, (j - (rows - 1) / 2) * pitch.y]];
