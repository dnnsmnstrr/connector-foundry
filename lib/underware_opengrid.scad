// Underware for openGrid — David D's one-piece adaptation of Hands on
// Katie and BlackjackDuck's under-desk cable channels: no base and top,
// just a channel whose walls end in grips that snap straight into an
// openGrid board's cells, on openGrid's 28mm grid. The geometry is Pedro
// Leite's OpenSCAD version of it, Monokini (vendored as vendor/Monokini,
// CC-BY-NC-SA 4.0 in its files' headers; the repository's LICENSE file
// says AGPL-3.0 — README "Licensing"): its cross-section,
// monokini_offset_profile(), is called from here, and the rest is its
// modules written out with its numbers. parts/underware/opengrid_*.scad
// wrap what is here.
//
// Why not call upstream's modules (monokiniChannel(), the L script's
// actually_channel()):
//
//  - depth. monokiniChannel() places its grips with path_copies() and
//    draws each with path_extrude2d(), both inside its own attachable(),
//    and a channel built from it traps the browser's OpenSCAD on stack
//    before it renders at all (web/README.md, "Known limit"). Here a
//    run is the same linear_extrude() of the same profile, and each grip
//    the extrusion and two chamfer cuts monokiniGrip() makes, placed
//    with the same turns path_copies() gives them, in builtin
//    transforms;
//  - the L's corner. monokiniChannelCurve() leaves path_extrude2d()'s
//    `s` at BOSL2's default, the diagonal of the path's own bounding box
//    (19.8mm for one unit wide), and the joints between the sweep's
//    segments are the profile cut to a square of that size about the
//    path. Every joint then stops 9.9mm up the wall, and above that the
//    curved wall is a comb of 0.2mm slots (measured with Monokini's own
//    script); David D's original is solid there. Here the corner is
//    the rotate_extrude() that sweep approximates, on the arc's own 89
//    segments;
//  - the L's leg lengths, which actually_channel() reads from the
//    script's own variables, where `use <>` cannot change them.
//
// Monokini builds a channel roof down, the way it prints: the roof on
// z = 0 and the grips' tips at `height`. Here it is turned over
// (xrot(180), which keeps upstream's X and Y legs on +X and +Y) so the
// grips face down, the functional face of the slot convention, and the
// roof is TOP. Left out, at upstream's defaults: the grip flare, the
// decorative profile, separators, suppressed grips, cord cutouts (the
// Holes tab cuts those, anywhere), labels and the filament channel.
// references.yaml holds both bodies to upstream's own scripts, and to
// David D's original files.
include <../vendor/BOSL2/std.scad>
use <../vendor/Monokini/monokini_L_channel.scad>

// Grid_Size: openGrid's cell pitch.
UWOG_GRID = 28;
// channelWidthSeparation: a channel's outside walls stand this far in
// from the grid lines either side, so neighbouring channels clear.
UWOG_SEPARATION = 0.8;
// Nudge: upstream extrudes each run this much longer than its length,
// from 1.5 Nudge before its start to 0.5 Nudge short of its end, so a
// channel's ends sit that far off the grid.
UWOG_NUDGE = 0.01;

// monokiniGrip()'s numbers: a grip is gripSize long, spacingFromChannel
// from its cell's edge, and reaches baseHeight past the wall's end into
// the board; its cross-section is snapWallThickness deep with a
// snapCaptureStrength barb and a topLittleChamfer on its tip.
UWOG_GRIP_LEN = 15;
UWOG_GRIP_INSET = 6.5;
UWOG_GRIP_H = 3.4;
UWOG_GRIP_WALL = 2;
UWOG_GRIP_BARB = 0.7;
UWOG_GRIP_TIP_CHAMFER = 0.4;

// A channel `width_units` cells wide: its outside width in mm.
function uwog_width(width_units) = width_units * UWOG_GRID - 2 * UWOG_SEPARATION;

// The straight channel's envelope: upstream's run, lengthMM + Nudge
// long, `height` tall with the grips.
function uwog_straight_size(length_units, width_units, height) =
    [uwog_width(width_units), length_units * UWOG_GRID + UWOG_NUDGE, height];

// monokiniGrip(): one grip on the -X wall of a channel `w` wide, along Y
// from UWOG_GRIP_INSET to UWOG_GRIP_INSET + UWOG_GRIP_LEN, in Monokini's
// frame (roof on z = 0) for a channel `h` tall. Its ends are cut back by
// two right-angled prisms, as upstream's are, each placed by the same
// zrot / yrot / xrot chain (rotate([x, y, z]) turns about X, then Y,
// then Z).
module uwog_grip(w, h) {
    b = UWOG_GRIP_BARB;
    g = UWOG_GRIP_H;
    t = UWOG_GRIP_WALL;
    profile = [[b, 0], [b, g - t], [0, g - t / 2], [0, g - UWOG_GRIP_TIP_CHAMFER], [b, g], [t, g], [t, 0]];
    // right_triangle([g, g]), anchored on its corner as BOSL2 draws it.
    prism = [[g, 0], [0, 0], [0, g]];
    translate([0, 0, h - g]) difference() {
        translate([-w / 2, UWOG_GRIP_INSET + UWOG_GRIP_LEN / 2, 0]) rotate([90, 0, 0])
            linear_extrude(height = UWOG_GRIP_LEN, center = true) polygon(profile);
        translate([-(w / 2 - t), UWOG_GRIP_INSET - (g - t), g]) rotate([90, 180, -90])
            linear_extrude(height = t) polygon(prism);
        translate([-w / 2, UWOG_GRIP_INSET + UWOG_GRIP_LEN + (g - t), g]) rotate([90, 180, 90])
            linear_extrude(height = t) polygon(prism);
    }
}

// monokiniChannel(): a straight run `length` mm long along Y, `w` wide
// and `h` tall, in Monokini's frame, centred as upstream centres it
// (Nudge off on Y). Upstream's path_copies() spaces one copy of its
// grip pair per cell along the run and turns each a quarter turn to the
// run's normal, inside a right(Grid_Size / 2) zrot(90) of its own: in
// all, half a turn about a point half a cell along from the copy.
module uwog_run(length, w, h) {
    profile = monokini_offset_profile(w, h);
    n = floor((length - UWOG_NUDGE) / UWOG_GRID) + 1;
    translate([0, length / 2 - UWOG_NUDGE / 2, 0]) rotate([90, 0, 0])
        linear_extrude(height = length + UWOG_NUDGE) polygon(profile);
    if (length > UWOG_GRIP_LEN)
        for (k = [0 : n - 1])
            translate([0, -UWOG_NUDGE / 2 + (k - (n - 1) / 2) * UWOG_GRID + UWOG_GRID / 2, 0]) rotate(180) {
                uwog_grip(w, h);
                mirror([1, 0, 0]) uwog_grip(w, h);
            }
}

// A straight channel, centred on its own bounding box, the grips' tips
// on z = 0. Upstream's run sits Nudge off-centre on Y (from -L/2 - 1.5
// Nudge to L/2 - 0.5 Nudge): moved back by that before the turn over.
module uwog_straight(length_units, width_units, height) {
    translate([0, 0, height]) rotate([180, 0, 0]) translate([0, UWOG_NUDGE, 0])
        uwog_run(length_units * UWOG_GRID, uwog_width(width_units), height);
}

// The L's corner square, in Monokini's frame: the corner piece fills a
// square `width_units` cells wide, centred on the origin, and each leg
// runs on from its edge.
function uwog_corner(width_units) = width_units * UWOG_GRID / 2;

// The L's bounding box in its own frame (after the turn over), the
// corner square's centre on the origin: the outside walls stand the
// separation in from the corner square's grid lines on -X and -Y, the
// X leg's end Nudge / 2 short of the grid and the Y leg's 1.5 Nudge
// past it (each leg is a straight run, spun round its own centre).
function uwog_l_bounds(x_units, y_units, width_units) =
    let(c = uwog_corner(width_units), w = uwog_width(width_units))
    [[-w / 2, -w / 2], [c + x_units * UWOG_GRID - UWOG_NUDGE / 2, c + y_units * UWOG_GRID + 1.5 * UWOG_NUDGE]];

// The L's rounded corner, in Monokini's frame: monokiniChannelCurve() at
// Added_Radius = 0, the channel's profile swept a quarter turn round
// (w / 2, -w / 2) with the path's centre line on a radius of half its
// width, from the -X wall's line to the +Y wall's, and the 0.8mm + Nudge
// straight runs either end that bring it to the legs. Upstream's arc is
// arc(90, ...): 90 points, 89 segments, which rotate_extrude() draws at
// $fn = 4 x 89. The profile's -X wall lands on the axis, at a radius
// that rounds to -0.00 and that rotate_extrude() refuses: clamped to 0.
module uwog_corner_curve(width_units, height) {
    w = uwog_width(width_units);
    r = w / 2;
    gap = UWOG_SEPARATION + UWOG_NUDGE;
    profile = monokini_offset_profile(w, height);
    radial = [for (p = profile) [max(0, p.x + r), p.y]];
    translate([r, -r, 0]) {
        rotate(90) rotate_extrude(angle = 90, $fn = 4 * 89) polygon(radial);
        translate([-r, 0, 0]) rotate([90, 0, 0]) linear_extrude(height = gap) polygon(profile);
        translate([0, r, 0]) rotate(90) rotate([90, 0, 0]) linear_extrude(height = gap) polygon(profile);
    }
}

// An L: `x_units` cells along +X from the corner square, `y_units` along
// +Y, the grips' tips on z = 0, the corner square's centre on the
// origin (not centred: parts/underware/opengrid_l_channel.scad centres
// it on its bounding box). Upstream's actually_channel() at
// Added_Radius = 0 and without Mirror_Channel, with its leg lengths and
// width as parameters: the Y leg as monokiniChannel() draws it, the X
// leg spun round to +X (its spin = 270), and the corner above.
module uwog_l(x_units, y_units, width_units, height) {
    c = uwog_corner(width_units);
    w = uwog_width(width_units);
    y_len = y_units * UWOG_GRID;
    x_len = x_units * UWOG_GRID;
    translate([0, 0, height]) rotate([180, 0, 0]) union() {
        translate([0, -(y_len / 2 + c), 0]) uwog_run(y_len, w, height);
        translate([x_len / 2 + c, 0, 0]) rotate(270) uwog_run(x_len, w, height);
        uwog_corner_curve(width_units, height);
    }
}
