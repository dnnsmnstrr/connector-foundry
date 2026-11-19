// Flic smart buttons and hubs: the devices' outside sizes, and the cup
// every Flic holder in parts/flic/ is built from.
//
// Flic (Shortcut Labs) published simplified outside-only models of all
// their devices in November 2026, for people to design holders around:
// https://flic.io/3d-print-community. The numbers below were measured off
// those models (their STLs; millimetres, Z up, each device lying on its
// back), not copied from the page's own table, which gives the Flic 2 as
// 34.3mm across where its model is 30.0. The page states no licence for
// the files, so this repository does not ship them: references.yaml
// fetches them by URL and checksum for the fit checks, which seat each
// device's own model in its holder.
//
// A holder is a cup the device lies in face out. Its mouth is BOTTOM (the
// functional face, the slot convention's), the device's back against the
// cup's floor and the "mount" anchor on the floor's far side, so a Bench
// attaches the cup by its back and the device faces away from whatever it
// is on. Flic suggest 0.2 to 0.3mm round a device; the pockets here are
// FIT_CLEARANCE (0.15 by default) bigger all round, so the global setting
// loosens all of them at once.
//
// A lip round the mouth keeps the device in: it stands `lip` mm in from
// the pocket wall, chamfered 45° on both sides (a lead-in at the mouth, an
// overhang a printer can make on the inside). Every Flic narrows into a
// rounded front edge, and the lip sits over that edge, just in front of
// where the device is as wide as the lip's opening (each device's FRONT
// table, measured off its model). So the lip clears a seated device by
// FLIC_LIP_GAP a side, catches it after FIT_CLEARANCE of travel, and slits
// in the wall let it spring open as the device goes in.
include <constants.scad>

// --- The devices (measured off Flic's models, see above) ---------------

// Flic 2: a round puck, 30.0 across its back, narrowing 0.07mm per mm of
// height to 29.57 at 6.8mm, then rounding into its face at 8.47mm.
FLIC_BUTTON_D = 30.0;
FLIC_BUTTON_H = 8.47;
// [width, height]: how high up the puck it is still that wide.
FLIC_BUTTON_FRONT = [[28.2, 8.27], [28.76, 8.02], [29.08, 7.76], [29.27, 7.51],
                     [29.42, 7.26], [29.52, 7.01], [29.57, 6.76]];

// Flic Duo (and the Cue and Mic, which share its housing): a stadium
// 51.02 x 29.43, its ends 14.715 in radius, 8.0 tall; straight-sided to
// 7.0mm, then rounding into its face.
FLIC_DUO_L = 51.02;
FLIC_DUO_W = 29.43;
FLIC_DUO_H = 8.0;
// As FLIC_BUTTON_FRONT, along its length and across it.
FLIC_DUO_FRONT_L = [[49.3, 7.95], [50.0, 7.75], [50.41, 7.5], [50.61, 7.25], [50.68, 7.0]];
FLIC_DUO_FRONT_W = [[27.71, 7.95], [28.41, 7.75], [28.82, 7.5], [29.02, 7.25], [29.09, 7.0]];

// The Duo's steel wall plate, which the Duo's magnets hold on to, 0.8
// thick: a stadium 55.95 long and 27.5 wide (its ends 13.75 in radius)
// with both ends cut off flat at 42.25, the two corners each cut makes
// rounded about 1.5mm. The shallow recess in the Duo's back (a 48.1 x 27.8
// stadium, with a raised pad at one end) is narrower at its ends than the
// plate, so the plate does not nest in it: the Duo lies flat on the plate,
// as on a wall.
FLIC_DUO_PLATE = [42.25, 27.5, 0.8];
FLIC_DUO_PLATE_ARC_L = 55.95;

// Flic Twist: a stationary core, 60.86 across, that stands on rubber feet
// and carries the turning ring (65.5 across) from 3.75mm up. A holder can
// only take the core's exposed band below the ring: its rim has to stop
// short of 3.75, or it rubs the ring.
FLIC_TWIST_CORE_D = 60.86;
FLIC_TWIST_RING_Z = 3.75;
FLIC_TWIST_RING_D = 65.5;
FLIC_TWIST_H = 20.9;

// Flic Hub Mini: a puck 48.0 across and 12.76 tall, its USB-C cable
// leaving from under its back through a 9.9mm channel to one side.
FLIC_HUB_MINI_D = 48.0;
FLIC_HUB_MINI_H = 12.76;
// Its face's edge is rounded only a few tenths: as FLIC_BUTTON_FRONT.
FLIC_HUB_MINI_FRONT = [[47.3, 12.71], [47.6, 11.56]];
FLIC_HUB_MINI_CABLE = 9.9;

// Flic Hub LR: a box 85.99 x 66.0 x 12.69 (86.75 long with the light
// pipe on its port end), every port (two round jacks, Ethernet, micro-USB)
// on that one end face. Its top edges are rounded 0.3mm; the panel inside
// them is 79.2 x 57.6, which leaves 3.3mm of flat edge a lip can bear on.
FLIC_HUB_LR = [85.99, 66.0, 12.69];

// --- The cup ------------------------------------------------------------

// The lip's flat inner face, between its two chamfers: two 0.2mm layers.
FLIC_LIP_FLAT = 0.4;
// What the lip clears a seated device by, a side.
FLIC_LIP_GAP = 0.05;
// Wall and floor below which a printed cup is too weak to grip anything.
FLIC_MIN_WALL = 1.2;
FLIC_MIN_FLOOR = 1;
// A slit through the wall, wide enough that its two sides never fuse.
FLIC_SLIT_W = 1;

// How deep a cup round a pocket `pocket` across, with this lip, has to be
// for a device `h` tall whose front is `front` (a FRONT table): with no
// lip, the device and FIT_CLEARANCE behind it. With one, the lip's flat
// face ends, on its floor side, at the height up the device where it is as
// wide as the lip's opening less FLIC_LIP_GAP a side (lookup() clamps a
// width off the table to its ends), FIT_CLEARANCE further out. A device
// with two widths (the Duo) gives the deeper of the two heights.
function flic_lip_seat(pocket, lip, front) =
    lookup(pocket - 2 * lip - 2 * FLIC_LIP_GAP, front);
function flic_cup_depth(h, lip, seat) =
    lip > 0 ? seat + lip + FLIC_LIP_FLAT + FIT_CLEARANCE : h + FIT_CLEARANCE;

// The three cups' depths, for the parts and their fit checks alike.
function flic_button_depth(lip) =
    flic_cup_depth(FLIC_BUTTON_H, lip,
                   flic_lip_seat(FLIC_BUTTON_D + 2 * FIT_CLEARANCE, lip, FLIC_BUTTON_FRONT));
function flic_duo_depth(lip) =
    flic_cup_depth(FLIC_DUO_H, lip,
                   max(flic_lip_seat(FLIC_DUO_L + 2 * FIT_CLEARANCE, lip, FLIC_DUO_FRONT_L),
                       flic_lip_seat(FLIC_DUO_W + 2 * FIT_CLEARANCE, lip, FLIC_DUO_FRONT_W)));
function flic_hub_mini_depth(lip) =
    flic_cup_depth(FLIC_HUB_MINI_H, lip,
                   flic_lip_seat(FLIC_HUB_MINI_D + 2 * FIT_CLEARANCE, lip, FLIC_HUB_MINI_FRONT));

// A cup round the pocket `path` (a closed 2D path, already FIT_CLEARANCE
// bigger than the device): mouth at z = 0, pocket `depth` deep, `floor`
// behind it, `wall` round it, a `lip` (0 for none) round the mouth.
// `cuts` are cut out of the result as the module's children, after the
// pocket: slits, notches and cable slots, which each part places itself.
// Built from offset_sweep()'s polyhedron rather than hull() or minkowski(),
// which the browser's OpenSCAD still runs through CGAL.
module flic_cup(path, depth, wall, floor, lip = 0) {
    assert(wall >= FLIC_MIN_WALL, str("wall must be at least ", FLIC_MIN_WALL, "mm"));
    assert(floor >= FLIC_MIN_FLOOR, str("floor must be at least ", FLIC_MIN_FLOOR, "mm"));
    assert(lip >= 0, "lip must be 0 (none) or more");
    assert(lip == 0 || lip <= wall, "lip must be no wider than the wall");
    lip_h = lip > 0 ? 2 * lip + FLIC_LIP_FLAT : 0;
    assert(depth > lip_h, "the pocket is shallower than its lip");
    difference() {
        linear_extrude(depth + floor) polygon(offset(path, r = wall, closed = true));
        // The pocket behind the lip (all of it, with no lip).
        translate([0, 0, lip_h - 0.01]) linear_extrude(depth - lip_h + 0.01) polygon(path);
        // The lip's opening: the pocket `lip` smaller, flared back out to
        // the pocket's own size at both ends.
        if (lip > 0)
            translate([0, 0, -0.01])
                offset_sweep(offset(path, delta = -lip, closed = true), height = lip_h + 0.02,
                             bottom = os_chamfer(width = -(lip + 0.01)),
                             top = os_chamfer(width = -(lip + 0.01)));
        children();
    }
}

// A cut through a round cup's wall at `angle` (degrees from +X): `width`
// across, from the mouth to `depth`, starting `from` mm from the centre.
module flic_radial_cut(angle, width, depth, from) {
    rotate(angle) translate([from, -width / 2, -0.01]) cube([100, width, depth + 0.01]);
}
