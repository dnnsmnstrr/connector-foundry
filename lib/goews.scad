// GOEWS, the Greatly Over Engineered Wall System: wall tiles with a
// window per cell, and the hanger plate every GOEWS accessory hangs from
// them by. Used by parts/goews/*.scad.
//
// GOEWS is by MrExo3D (goews.ws), published as Printables model 1090032
// under CC-BY 4.0 — attribution, no other restriction; see the README's
// "Licensing". Nothing here imports the designer's files: the numbers
// below are measured off their STLs (the single hex tile, the 3 x 3
// GOEWS GRID tile, the 2x and 3x hanging plate blanks) and the geometry
// is rebuilt from them, so a tile can take any size. references.yaml
// holds the rebuilt parts to those files, and the plate to the tile.
//
// The grid is Gridfinity's 42mm across. Hex tiles are 42mm across the
// flats, pointy end up, each row 42 x sqrt(3) / 2 = 36.373mm above the
// last and half a cell over; GOEWS GRID tiles are 42 x 36.373mm
// rectangles with the same window at the same height, so a hanger moves
// between the two. A tile is 6mm thick, its front chamfered 0.5mm round
// every cell, so a tile looks like loose cells pushed together.
//
// Each cell has a 36 x 22mm window through it. A hanger is a 35.2mm bar
// with 45-degree flanks front and back (a flattened hexagon in section,
// 5mm deep): it goes into the top of the window and drops onto the
// bottom, where two cleats, 45-degree lips along the window's sides at
// the front, hold its front flanks, and a 45-degree ramp across the
// window's floor meets its chamfered bottom. Behind the cleats the
// window's sides close in at 45 degrees too, and the last 1mm at the
// back leaves 27mm open, a ledge the hanger's back sits on: hung, a
// plate stands 0.15mm off the tile, with 0.4mm round both flanks.
// Above the window, an M14 x 2 thread takes a bolt through the plate's
// notch, which locks the plate down; a ring of 9mm round the thread
// stays solid. Below it, a countersunk screw hole fixes the tile to the
// wall (hex tiles one per cell, GOEWS GRID two). Hex tiles also have a
// 3mm deep recess in their back, 3mm in from the cell's two lower
// edges, around a boss on the screw hole.
//
// This is the designer's original cleat. jimfunk's OpenSCAD rebuild
// (github.com/jimfunk/goews-rebuilt-openscad, which has no licence file,
// so nothing here comes from it) adds a "thicker cleats" variant, its
// cleats 1mm further back; goews.ws says the two do not fit each other.
//
// Frame for the tile (the "cell frame", which parts/goews/tile.scad
// places): x across, y up the wall, the hex cell's centre on the
// origin; z through the tile from its front (z = 0, functional face
// down) to its back on the wall (z = GOEWS_T). The hanger plate's frame
// is described above goews_hanger_plate().
include <../vendor/BOSL2/std.scad>
include <../vendor/BOSL2/threading.scad>
include <constants.scad>

GOEWS_PITCH = 42;                         // across, Gridfinity's grid
GOEWS_ROW   = GOEWS_PITCH * sqrt(3) / 2;  // 36.373: up, row to row
GOEWS_HEX_R = GOEWS_PITCH / sqrt(3);      // 24.249: centre to a hex cell's point
GOEWS_T     = 6;                          // tile thickness
GOEWS_FRONT_CHAMFER = 0.5;

// The window, from the hex cell's centre: the bottom is the lower
// points' level (42 x sqrt(3) / 6 = 12.124 below), the top 22mm up.
GOEWS_WIN_W   = 36;
GOEWS_WIN_H   = 22;
GOEWS_WIN_Y0  = -GOEWS_PITCH * sqrt(3) / 6;
GOEWS_CLEAT   = 2.5;  // each cleat's lip, across and deep (45 degrees)
GOEWS_CLEAT_H = 8;    // the cleat's full lip stands this far up the window; it
                      // tapers out at 45 degrees over the next GOEWS_CLEAT
GOEWS_FLANK   = 5;    // the window narrows at 45 degrees from GOEWS_CLEAT deep to this
GOEWS_LEDGE_W = 27;   // what the back's 1mm ledge leaves open
// The floor's ramp: the window's floor rises 1mm per 1mm back, from the
// front's GOEWS_WIN_Y0 to 6mm higher at the back.

// The thread: M14 x 2, opened up for a printed bolt. The designer's
// measures 14.55 across its root and 12.32 across its crest, with a
// narrower root than ISO's; BOSL2's ISO profile at 14.45 is the closest
// to it by volume.
GOEWS_THREAD_D     = 14.45;
GOEWS_THREAD_PITCH = 2;
GOEWS_THREAD_Y     = GOEWS_HEX_R - 11.55;  // 12.699, 11.55 below the hex's top point
GOEWS_THREAD_RING  = 9;                    // stays solid round the thread
GOEWS_THREAD_MINOR = 12.32;                // the designer's crest, measured
GOEWS_THREAD_LEAD  = 1;                    // the front's 45-degree lead-in to the minor diameter

// The wall screw hole: a 4mm shank, an 8mm head sunk 1mm, then
// countersunk at 45 degrees over the next 2mm.
GOEWS_SCREW_D   = 4;
GOEWS_SCREW_HEAD = 8;
GOEWS_SCREW_SINK = 1;
GOEWS_HEX_SCREW_Y = -GOEWS_HEX_R + 6;            // hex: one, 6mm above the bottom point
GOEWS_GRID_Y0     = GOEWS_WIN_Y0 - 3;            // a GOEWS GRID cell's bottom
GOEWS_GRID_SCREW  = [GOEWS_PITCH / 2 - 8.3, GOEWS_GRID_Y0 + 30.436];  // and its mirror in x

// The hex back recess (measured: 3mm in from the lower edges, from 3mm
// deep to the back, its top edge at 45 degrees, reaching 10.367 below the
// centre at the back), round a boss of 5mm on the screw hole that
// widens at 45 degrees over its first 1.243mm.
GOEWS_RECESS_DEPTH = 3;
GOEWS_RECESS_INSET = 3;
GOEWS_RECESS_TOP   = -10.367;
GOEWS_RECESS_BOSS  = 5;
GOEWS_RECESS_BOSS_FLARE = 1.243;

// The hanger plate (measured off the 1x and 3x blanks).
GOEWS_PLATE_W   = GOEWS_PITCH - 0.4;  // a unit, 0.2mm narrower each side than the grid
GOEWS_PLATE_H   = 24.39;
GOEWS_PLATE_T   = 3;
GOEWS_PLATE_R   = 3;      // the top corners, and the notch's fillets
GOEWS_NOTCH_R   = 7;      // the bolt's notch in the plate's top edge...
GOEWS_NOTCH_Y   = 24.852; // ...its centre above the plate's bottom
// Across the flanks' edge. The designer's files differ: 35.6 on the 1x
// blank and the first hooks, 35.2 on the 2x, 3x and 4x blanks and the
// later hook series. This is the later one, 0.4mm narrower than the window
// either side.
GOEWS_HANGER_W  = 35.2;
GOEWS_HANGER_T  = 5;      // front to back over the flanks
GOEWS_HANGER_GAP = 0.15;  // the flanks stand this far off the plate
GOEWS_HANGER_H  = 13.15;
GOEWS_HANGER_NOTCH_R = 9.5;  // clears the bolt's head as the plate goes in
GOEWS_HANGER_NOTCH_Y = 16;
GOEWS_HANGER_DEPTH = GOEWS_HANGER_T + GOEWS_HANGER_GAP;  // 5.15

// A hex tile: cols cells in a row, rows rows, every other row half a cell
// to the left (the designer's 2 x 2 has its bottom row to the right).
// Outside size, x by y, and each cell's centre in the cell frame of the
// whole tile, centred on its own box.
function goews_hex_tile_size(cols, rows) =
    [cols * GOEWS_PITCH + (rows > 1 ? GOEWS_PITCH / 2 : 0), 2 * GOEWS_HEX_R + (rows - 1) * GOEWS_ROW];
function goews_hex_centres(cols, rows) =
    let (shift = rows > 1 ? GOEWS_PITCH / 4 : 0)
    [for (r = [0 : rows - 1], c = [0 : cols - 1])
        [(c - (cols - 1) / 2) * GOEWS_PITCH + (r % 2 == 0 ? -shift : shift), (r - (rows - 1) / 2) * GOEWS_ROW]];

// A GOEWS GRID tile: cols x rows rectangles. Its centre is not its cells'
// hex-frame origin: the window sits 3mm above a cell's bottom.
GOEWS_GRID_CY = GOEWS_GRID_Y0 + GOEWS_ROW / 2;  // a cell's own centre in the cell frame
function goews_grid_tile_size(cols, rows) = [cols * GOEWS_PITCH, rows * GOEWS_ROW];
function goews_grid_centres(cols, rows) =
    [for (r = [0 : rows - 1], c = [0 : cols - 1])
        [(c - (cols - 1) / 2) * GOEWS_PITCH, (r - (rows - 1) / 2) * GOEWS_ROW - GOEWS_GRID_CY]];

// The hex outline, inset by `inset` (its points up and down).
module goews_hex_outline(inset = 0) {
    circle(r = GOEWS_HEX_R - inset * 2 / sqrt(3), $fn = 6);
}

// A cell's body: its outline through the tile, the front edges
// chamfered. A linear_extrude scaled about the cell's centre is a true
// inset for the hex (every side is the same distance out) and, per axis,
// for the rectangle.
module goews_cell_body(style) {
    c = GOEWS_FRONT_CHAMFER;
    if (style == "hex") {
        s = GOEWS_HEX_R / (GOEWS_HEX_R - c * 2 / sqrt(3));
        rotate(90) {
            linear_extrude(c, scale = s) goews_hex_outline(c);
            translate([0, 0, c]) linear_extrude(GOEWS_T - c) goews_hex_outline();
        }
    } else {
        sz = [GOEWS_PITCH, GOEWS_ROW];
        translate([0, GOEWS_GRID_CY, 0]) {
            linear_extrude(c, scale = [sz.x / (sz.x - 2 * c), sz.y / (sz.y - 2 * c)]) square(sz - [2 * c, 2 * c], center = true);
            translate([0, 0, c]) linear_extrude(GOEWS_T - c) square(sz, center = true);
        }
    }
}

// One cleat, on the window's right side: a 45-degree lip whose full
// GOEWS_CLEAT stands GOEWS_CLEAT_H up from the window's bottom, then
// tapers out at 45 degrees (its top runs up and out to the wall).
// Overlaps the window's wall and the front by `e`, so it unions cleanly.
module goews_cleat(e = 0.01) {
    xw = GOEWS_WIN_W / 2;
    x0 = xw - GOEWS_CLEAT;
    y0 = GOEWS_WIN_Y0;
    intersection() {
        // The lip in section, extruded up the window.
        translate([0, y0 - e, 0]) rotate([-90, 0, 0])
            linear_extrude(GOEWS_CLEAT_H + 2 * GOEWS_CLEAT + 2 * e)
                polygon([[x0 - e, e], [xw + e, e], [xw + e, -GOEWS_CLEAT - e]]);
        // Its tapered top, seen from the front.
        translate([0, 0, -e]) linear_extrude(GOEWS_CLEAT + 2 * e)
            polygon([[x0, y0 - e], [xw + e, y0 - e], [xw + e, y0 + GOEWS_CLEAT_H + GOEWS_CLEAT + e],
                     [x0, y0 + GOEWS_CLEAT_H]]);
    }
}

// The window's void, cleats, ramp and the ring round the thread taken
// out of it.
module goews_window() {
    e = 0.01;
    xw = GOEWS_WIN_W / 2;
    y0 = GOEWS_WIN_Y0;
    difference() {
        // Its width through the tile: straight to the cleats' depth, in at
        // 45 degrees to the flank's depth, then the ledge's opening.
        translate([0, y0, 0]) rotate([-90, 0, 0]) linear_extrude(GOEWS_WIN_H)
            polygon([[-xw, e], [xw, e], [xw, -GOEWS_CLEAT], [xw - (GOEWS_FLANK - GOEWS_CLEAT), -GOEWS_FLANK],
                     [GOEWS_LEDGE_W / 2, -GOEWS_FLANK], [GOEWS_LEDGE_W / 2, -GOEWS_T - e],
                     [-GOEWS_LEDGE_W / 2, -GOEWS_T - e], [-GOEWS_LEDGE_W / 2, -GOEWS_FLANK],
                     [-xw + (GOEWS_FLANK - GOEWS_CLEAT), -GOEWS_FLANK], [-xw, -GOEWS_CLEAT]]);
        // The floor's ramp, 1mm up per 1mm back.
        translate([-xw - e, 0, 0]) rotate([90, 0, 90]) linear_extrude(GOEWS_WIN_W + 2 * e)
            polygon([[y0 - 1, -e], [y0 - e, -e], [y0 + GOEWS_T + e, GOEWS_T + e], [y0 - 1, GOEWS_T + e]]);
        goews_cleat(e);
        mirror([1, 0, 0]) goews_cleat(e);
        translate([0, GOEWS_THREAD_Y, -e]) cylinder(r = GOEWS_THREAD_RING, h = GOEWS_T + 2 * e);
    }
}

// The countersunk wall screw hole, its head at the front.
module goews_screw_hole() {
    e = 0.01;
    r1 = GOEWS_SCREW_D / 2;
    r2 = GOEWS_SCREW_HEAD / 2;
    translate([0, 0, -e]) cylinder(r = r1, h = GOEWS_T + 2 * e);
    translate([0, 0, -e]) cylinder(r = r2, h = GOEWS_SCREW_SINK + e);
    translate([0, 0, GOEWS_SCREW_SINK - e]) cylinder(r1 = r2, r2 = r1, h = r2 - r1 + e);
}

// The hex cell's back recess, round its boss.
module goews_hex_recess() {
    e = 0.01;
    d0 = GOEWS_RECESS_DEPTH;
    lift = GOEWS_RECESS_INSET * 2 / sqrt(3);  // the inset, measured up
    yb = -GOEWS_HEX_R + lift;                 // the inset V's point
    reach = (GOEWS_RECESS_TOP - yb) * sqrt(3) + 1;
    difference() {
        intersection() {
            translate([0, 0, d0]) linear_extrude(GOEWS_T - d0 + e)
                polygon([[0, yb], [reach, yb + reach / sqrt(3)], [-reach, yb + reach / sqrt(3)]]);
            // The top edge, 45 degrees: GOEWS_RECESS_TOP at the back.
            translate([-reach, 0, 0]) rotate([90, 0, 90]) linear_extrude(2 * reach)
                polygon([[yb - 1, d0 - e], [GOEWS_RECESS_TOP - (GOEWS_T - d0) - e, d0 - e],
                         [GOEWS_RECESS_TOP + e, GOEWS_T + e], [yb - 1, GOEWS_T + e]]);
        }
        translate([0, GOEWS_HEX_SCREW_Y, d0 - e]) {
            cylinder(r1 = GOEWS_RECESS_BOSS + GOEWS_RECESS_BOSS_FLARE + e, r2 = GOEWS_RECESS_BOSS,
                     h = GOEWS_RECESS_BOSS_FLARE + e);
            cylinder(r = GOEWS_RECESS_BOSS, h = GOEWS_T);
        }
    }
}

// The thread, front to back, full depth to both faces (no blunt start:
// BOSL2's opens an internal thread's first turn to its major diameter),
// turned to start where the designer's does, with a 45-degree lead-in at
// the front down to the thread's minor diameter.
module goews_thread_hole() {
    translate([0, GOEWS_THREAD_Y, -0.01]) {
        rotate(90)
            threaded_rod(d = GOEWS_THREAD_D, pitch = GOEWS_THREAD_PITCH, l = GOEWS_T + 0.02, internal = true,
                         bevel = false, blunt_start = false, anchor = BOTTOM, $fn = 48);
        cylinder(r1 = GOEWS_THREAD_MINOR / 2 + GOEWS_THREAD_LEAD + 0.01, r2 = GOEWS_THREAD_MINOR / 2,
                 h = GOEWS_THREAD_LEAD + 0.01, $fn = 48);
    }
}

// One cell of either style, in the cell frame.
module goews_cell(style = "hex", thread = true) {
    difference() {
        goews_cell_body(style);
        goews_window();
        if (thread) goews_thread_hole();
        if (style == "hex") {
            translate([0, GOEWS_HEX_SCREW_Y, 0]) goews_screw_hole();
            goews_hex_recess();
        } else {
            for (sx = [-1, 1]) translate([sx * GOEWS_GRID_SCREW.x, GOEWS_GRID_SCREW.y, 0]) goews_screw_hole();
        }
    }
}

// A whole tile, centred on its own box in x and y, front on z = 0.
module goews_tile_body(style = "hex", cols = 2, rows = 2, thread = true) {
    centres = style == "hex" ? goews_hex_centres(cols, rows) : goews_grid_centres(cols, rows);
    for (c = centres) translate([c.x, c.y, 0]) goews_cell(style, thread);
}

// The hanger plate. Frame: x across, y up the wall from the plate's
// bottom (the hanger's bottom too) at y = 0, z from the hanger's back
// (z = 0, against the tile's ledge when hung) to the plate's front at
// GOEWS_HANGER_DEPTH + plate. `units` side by side, a hanger and a notch
// each, centred on x = 0.
module goews_hanger_plate(units = 1, plate = GOEWS_PLATE_T) {
    e = 0.01;
    w = units * GOEWS_PITCH - (GOEWS_PITCH - GOEWS_PLATE_W);
    xs = [for (i = [0 : units - 1]) (i - (units - 1) / 2) * GOEWS_PITCH];
    // The plate: its top corners and the notches' corners rounded by
    // GOEWS_PLATE_R (an opening, offset in then out), the bottom left
    // square by the rectangle it is unioned with.
    translate([0, 0, GOEWS_HANGER_DEPTH]) linear_extrude(plate)
        union() {
            offset(r = GOEWS_PLATE_R) offset(delta = -GOEWS_PLATE_R) difference() {
                translate([-w / 2, 0]) square([w, GOEWS_PLATE_H]);
                for (x = xs) translate([x, GOEWS_NOTCH_Y]) circle(r = GOEWS_NOTCH_R);
            }
            translate([-w / 2, 0]) square([w, GOEWS_PLATE_H / 2]);
        }
    for (x = xs) translate([x, 0, 0]) difference() {
        hw = GOEWS_HANGER_W / 2;
        f = GOEWS_HANGER_T / 2;
        // The bar in section: flanks out at 45 degrees to its widest
        // halfway through, and the gap to the plate at its narrow width.
        rotate([-90, 0, 0]) linear_extrude(GOEWS_HANGER_H)
            polygon([[-hw + f, 0], [hw - f, 0], [hw, -f], [hw - f, -GOEWS_HANGER_T],
                     [hw - f, -GOEWS_HANGER_DEPTH - e], [-hw + f, -GOEWS_HANGER_DEPTH - e],
                     [-hw + f, -GOEWS_HANGER_T], [-hw, -f]]);
        // Its bottom back edge, at 45 degrees from the back to the gap: it
        // sits on the window's ramp.
        translate([-hw - e, 0, 0]) rotate([90, 0, 90]) linear_extrude(GOEWS_HANGER_W + 2 * e)
            polygon([[-e, -e], [GOEWS_HANGER_T + e, -e], [-e, GOEWS_HANGER_T + e]]);
        translate([0, GOEWS_HANGER_NOTCH_Y, -e]) cylinder(r = GOEWS_HANGER_NOTCH_R, h = GOEWS_HANGER_DEPTH + 2 * e);
    }
}
