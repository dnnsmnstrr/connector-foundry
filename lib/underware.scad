// Underware channel bodies — Hands on Katie and BlackjackDuck's under-desk
// cable channels: a base that mounts to a surface and a top that snaps
// onto it, both one cross-section swept along the channel. The cross-
// sections are upstream's own, from QuackWorks' Underware_I_Channel.scad
// (vendored as vendor/QuackWorks, CC-BY-NC-SA 4.0): baseProfile() and
// topProfileHalf(), Katie's coordinates from her master Fusion sketch.
// parts/underware/*.scad wrap what is here.
//
// Why not call upstream's channel modules (straightChannelBase(),
// lChannelTop(), ...): they read the script's customizer variables, not
// their parameters, for most of what makes a channel — the mounting
// method, the width in units that places the mounting holes, the inside
// height the top's profile is drawn at — and `use <>` cannot change
// those (it leaves Mounting_Method at "Threaded Snap Connector" and the
// height at 12mm for every channel). So the sweeps are written out here
// with upstream's profile functions, and the mounting holes with
// upstream's numbers:
//
//  - a straight channel is a linear_extrude() of the profile, which is
//    what path_sweep() along a straight turtle path makes;
//  - an L channel is BOSL2's path_sweep2d() along upstream's own turtle
//    path, as lChannelBase() / lChannelTop() call it;
//  - each mounting hole is one cut at a grid position — upstream's
//    chained cyl()s placed side by side, so a base stays well inside the
//    browser OpenSCAD's nesting limit (web/README.md, "Known limit").
//
// references.yaml holds every body to upstream's own script, run with
// its customizer variables set to match, so a drift fails `make verify`.
// Left out: upstream's beta "v2.5" inverse profile and its Additional
// Holding Strength (both "not backwards compatible"), cord cutouts in
// the top (the Holes tab cuts those, anywhere) and text labels.
include <../vendor/BOSL2/std.scad>
include <../vendor/BOSL2/threading.scad>
use <../vendor/QuackWorks/Underware/Underware_I_Channel.scad>

// Grid_Size: the unit a channel's width and length come in (Multiboard's
// 25mm hole spacing).
UW_GRID = 25;
// baseHeight / topHeight: a base's outside height, and a top's at the
// standard 12mm inside height (it grows by what the inside height adds).
UW_BASE_HEIGHT = 9.63;
UW_TOP_HEIGHT = 10.968;
// interlockFromFloor: a fitted top's bottom edge sits this far above the
// base's.
UW_INTERLOCK_Z = 6.533;
// Flex_Compensation_Scaling: a straight top wider than one unit or
// taller than 18mm inside is drawn this much narrower, so its walls
// grip the base harder.
UW_FLEX_SCALING = 0.99;

// The mounting methods, spelled as upstream's customizer spells them.
UW_MOUNTINGS = ["Threaded Snap Connector", "Direct Multiboard Screw", "Direct Multipoint Screw",
                "Magnet", "Wood Screw", "Flat"];

// The threaded snap connector's thread (the script's "Small Screw
// Profile"), and the Slop it adds to the internal thread.
UW_SNAP_THREAD_D = 6.747;
UW_SNAP_THREAD_PITCH = 3;
UW_SNAP_THREAD_FLANK = 60;
UW_SNAP_THREAD_DEPTH = 0.5;
UW_SNAP_THREAD_SLOP = 0.075;
// Direct screw mount: a shank hole under a counterbore that leaves this
// much floor for the head to sit on (Base_Screw_Hole_*), 15mm across for
// Multiboard's screws and 16mm for Multipoint's.
UW_SCREW_SHANK_D = 7;
UW_SCREW_SEAT = 1;
UW_SCREW_HEAD_D_MULTIBOARD = 15;
UW_SCREW_HEAD_D_MULTIPOINT = 16;
// The floor's thickness under the channel, which the counterbore and
// the wood screw's head cone reach.
UW_FLOOR = 3.5;
UW_MAGNET_D = 4;
UW_MAGNET_T = 1.5;
UW_MAGNET_TOLERANCE = 0.1;
UW_WOOD_SCREW_D = 3.5;
UW_WOOD_SCREW_HEAD_D = 7;
UW_WOOD_SCREW_HEAD_H = 1.75;

// The base's cross-section: x across the channel, centred; y up from the
// floor's underside. `width` is the channel's width in mm (units x 25).
function uw_base_profile(width) = baseProfile(widthMM = width);

// The top's cross-section, legs down at y = 0. Upstream's topProfile()
// draws its halves at the script's own Channel_Internal_Height whatever
// `heightMM` says (it reads selectTopProfile, a customizer value), so
// this is topProfile() with the halves drawn at `height`.
function uw_top_profile(width, height) =
    let(half = topProfileHalf(height))
    union(
        left((width - 25) / 2, half),
        right((width - 25) / 2, mirror([1, 0], half)),
        back(UW_TOP_HEIGHT - 1 + height - 12, rect([width - 25 + 0.02, 2]))
    );

function uw_top_height(height) = UW_TOP_HEIGHT + height - 12;

// A straight top's drawn width: straightChannelTop()'s widthMM, with the
// flex compensation upstream's I channel script applies.
function uw_straight_top_width(width_units, height) =
    width_units * UW_GRID * (width_units > 1 || height > 18 ? UW_FLEX_SCALING : 1);

// `profile` swept `length` along Y, centred, its y becoming Z.
module uw_straight_sweep(profile, length) {
    rotate([90, 0, 0]) linear_extrude(height = length, center = true) region(profile);
}

// Half a cross-section's outside width: 0.017mm more than half the
// channel's width, since Katie's profile reaches 12.517 either side of a
// 25mm channel's centre.
function uw_half_width(profile) = max([for (path = profile) each column(path, 0)]);

// The bounding box of uw_l_sweep(): its outside walls stand that 0.017mm
// past the grid, its open ends are flush with it.
function uw_l_extent(profile, x_len, y_len, depth) =
    let(hw = uw_half_width(profile))
    [depth / 2 + x_len + hw, depth / 2 + y_len + hw];

// `profile` swept round upstream's L path: `x_len` along +X, a 90° turn,
// then `y_len` along +Y, measured to the far end of each leg from the
// outside of the other. `depth` is the channel's width. Centred on its
// own bounding box, which is lChannelBase()'s placement but for the
// profile's 0.017mm overhang, split evenly here so every face anchor
// lands on the geometry. Children are cut from the sweep in the path's
// frame: the start of the path on the origin, the corner at
// [depth / 2 + x_len, 0].
module uw_l_sweep(profile, x_len, y_len, depth) {
    hw = uw_half_width(profile);
    extent = uw_l_extent(profile, x_len, y_len, depth);
    translate([-extent.x / 2, hw - extent.y / 2, 0]) difference() {
        path_sweep2d(profile, turtle(["move", depth / 2 + x_len, "turn", 90, "move", depth / 2 + y_len]));
        children();
    }
}

// One mounting hole of `mounting`, centred on the origin, the base's
// underside on z = 0. Each method's cut is upstream's, in the same
// order, at the same heights.
module uw_mounting_hole(mounting) {
    if (mounting == "Direct Multiboard Screw" || mounting == "Direct Multipoint Screw") {
        head_d = mounting == "Direct Multiboard Screw" ? UW_SCREW_HEAD_D_MULTIBOARD : UW_SCREW_HEAD_D_MULTIPOINT;
        translate([0, 0, UW_SCREW_SEAT - 8]) cylinder(h = 8, d = UW_SCREW_SHANK_D, $fn = 25);
        translate([0, 0, UW_SCREW_SEAT - 0.01])
            cylinder(h = UW_FLOOR - UW_SCREW_SEAT + 0.02, d = head_d, $fn = 25);
    } else if (mounting == "Magnet") {
        h = UW_MAGNET_T + UW_MAGNET_TOLERANCE;
        translate([0, 0, -0.01]) cylinder(h = h, d = UW_MAGNET_D + UW_MAGNET_TOLERANCE, $fn = 50);
    } else if (mounting == "Wood Screw") {
        shank = UW_FLOOR - UW_WOOD_SCREW_HEAD_H;
        translate([0, 0, -0.05]) cylinder(h = shank + 0.05, d = UW_WOOD_SCREW_D, $fn = 25);
        translate([0, 0, shank - 0.01])
            cylinder(h = UW_WOOD_SCREW_HEAD_H + 0.05, d1 = UW_WOOD_SCREW_D, d2 = UW_WOOD_SCREW_HEAD_D, $fn = 25);
    } else if (mounting == "Threaded Snap Connector") {
        translate([0, 0, 5.99])
            trapezoidal_threaded_rod(d = UW_SNAP_THREAD_D, l = 6, pitch = UW_SNAP_THREAD_PITCH,
                                     flank_angle = UW_SNAP_THREAD_FLANK, thread_depth = UW_SNAP_THREAD_DEPTH,
                                     $fn = 50, internal = true, bevel2 = true, blunt_start = false,
                                     anchor = TOP, $slop = UW_SNAP_THREAD_SLOP);
    }
    // "Flat": no hole, for tape or glue.
}

// A straight base, `length_units` long (Y) and `width_units` wide (X),
// centred, its underside on z = 0. One mounting hole per grid square,
// each turned a quarter turn as straightChannelBase() cuts them (inside
// the zrot(90) it sweeps the channel in): that sets where the snap's
// thread starts and how the 25-sided screw holes' facets lie.
module uw_straight_base(length_units, width_units, mounting) {
    width = width_units * UW_GRID;
    length = length_units * UW_GRID;
    difference() {
        uw_straight_sweep(uw_base_profile(width), length);
        for (i = [0 : width_units - 1], j = [0 : length_units - 1])
            translate([(i - (width_units - 1) / 2) * UW_GRID, (j - (length_units - 1) / 2) * UW_GRID, 0])
                rotate(90) uw_mounting_hole(mounting);
    }
}

// A straight top, legs down on z = 0 (fitted the right way up: it prints
// roof down).
module uw_straight_top(length_units, width_units, height) {
    uw_straight_sweep(uw_top_profile(uw_straight_top_width(width_units, height), height),
                      length_units * UW_GRID);
}

// An L base. lChannelBase() lays its hole grid over the whole bounding
// box, one hole per grid square, and the holes in the empty quadrant the
// L wraps round cut nothing; only the ones on the channel are cut here.
module uw_l_base(x_units, y_units, width_units, mounting) {
    depth = width_units * UW_GRID;
    x_len = x_units * UW_GRID;
    uw_l_sweep(uw_base_profile(depth), x_len, y_units * UW_GRID, depth)
        for (i = [0 : width_units + x_units - 1], j = [0 : width_units + y_units - 1])
            let(p = [(i + 0.5) * UW_GRID, (j + 0.5) * UW_GRID - depth / 2])
                if (p.x > x_len || p.y < depth / 2)
                    translate([p.x, p.y, 0]) uw_mounting_hole(mounting);
}

// An L top, legs down on z = 0. Upstream's L script applies no flex
// compensation.
module uw_l_top(x_units, y_units, width_units, height) {
    uw_l_sweep(uw_top_profile(width_units * UW_GRID, height), x_units * UW_GRID, y_units * UW_GRID,
               width_units * UW_GRID);
}
