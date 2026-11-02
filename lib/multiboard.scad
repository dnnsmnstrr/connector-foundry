// Multiboard's tile threads: the two threads a Multiboard tile's holes
// are cut with, so a part here can screw into a tile and a hole here can
// take Multiboard's own bolts. Used by parts/multiboard/*.scad and the
// Holes tab (web/src/lib/screwHoles.js's "thread" kind, profiles
// "mb-big" and "mb-small").
//
// Multiboard (now MultiBuild, multibuild.io) is Keep Making's, and its
// designs are under the MultiBuild Licence: personal use, no
// redistribution, revocable. Nothing here is taken from a Multiboard
// file, and no tile is modelled — only the two threads a part needs to
// mate with one, the way lib/multiconnect.scad models MultiConnect from
// its published numbers. Multiboard publishes no specification; the
// numbers are the community's measurements as shaggyone's
// multiboard-parametric (github.com/shaggyone/multiboard-parametric)
// cuts a tile with them, not yet checked against a printed tile here,
// so the parts are `parametric`.
//
// A tile is 6.4 mm thick on a 25 mm grid. A big hole in every cell is an
// octagon, narrowest (21.4 mm across its flats) in the middle of the
// tile, with a helical groove cut into its flats out to Ø22.5 at a
// 2.5 mm pitch. A small hole at every corner between four cells is a
// Ø6.07 mm bore with a groove out to Ø7.03 at a 3 mm pitch. Each groove
// is a trapezoid, narrow at its floor (the crest of a thread that
// screws in) and wide at the bore.
include <../vendor/BOSL2/std.scad>
include <../vendor/BOSL2/threading.scad>
include <constants.scad>

MB_PITCH  = 25;    // grid, both ways: big hole to big hole
MB_TILE_T = 6.4;   // tile thickness, so how long a thread has to be

// [groove floor Ø, bore Ø, pitch, width at the floor, width at the bore]
MB_BIG   = [22.5, 21.4, 2.5, 0.5, 1.583];
MB_SMALL = [7.025, 6.069, 3, 0.768, 2.5];

// A male thread is cut this much narrower across than the tile's
// groove, which is the clearance the community reports Multiboard's own
// bolts have (0.125 a side).
MB_THREAD_CLEARANCE = 0.25;

function mb_thread_spec(size) =
    assert(size == "big" || size == "small", "size must be \"big\" or \"small\"")
    size == "big" ? MB_BIG : MB_SMALL;

// The thread as a solid, z = 0 to `height`, its axis z: the core at the
// bore and the helix out to the groove's floor, both `clearance` wider
// across. clearance -MB_THREAD_CLEARANCE is a male thread that screws
// into a tile; 0 is the tile's own hole, as a cutter. The ridge has the
// groove's trapezoid, so a male thread sits in a female one with the
// clearance all round its flanks. `lead_in` softens the helix's start at
// z = 0, where a male thread is pushed into the hole.
module mb_thread(size, height, clearance = 0, lead_in = true) {
    spec = mb_thread_spec(size);
    d = spec[0] + clearance;
    bore = spec[1] + clearance;
    pitch = spec[2];
    depth = (spec[0] - spec[1]) / 2;
    profile = [[-spec[4] / 2, -depth], [-spec[3] / 2, 0], [spec[3] / 2, 0], [spec[4] / 2, -depth]] / pitch;
    fn = size == "big" ? 128 : 48;
    big = d + 2;
    intersection() {
        union() {
            cylinder(d = bore + 0.01, h = height, $fn = fn);
            // Half a turn either side, cut off flat below, so the thread
            // runs full depth right to both ends.
            translate([0, 0, -pitch / 2])
                thread_helix(d = d, pitch = pitch, turns = height / pitch + 1, profile = profile,
                             anchor = BOTTOM, internal = false, $fn = fn,
                             lead_in1 = lead_in ? pitch / 2 : undef);
        }
        translate([-big / 2, -big / 2, 0]) cube([big, big, height]);
    }
}

// The tile's own hole as the Holes tab cuts it, in a hole's frame: z up
// out of the face, the surface at z = 0, the thread `depth` into the
// material below it. `overshoot` carries the bore on past the surface so
// the cut opens cleanly. A Multiboard bolt then screws in as it does
// into a tile.
module mb_thread_hole(size = "big", depth = MB_TILE_T, clearance = 0, overshoot = 1) {
    spec = mb_thread_spec(size);
    rotate([0, 180, 0]) mb_thread(size, depth, clearance, lead_in = false);
    translate([0, 0, -0.01])
        cylinder(d = spec[0] + clearance, h = overshoot + 0.01, $fn = size == "big" ? 128 : 48);
}

// A male thread under a flat head: what parts/multiboard/snap.scad and
// peg.scad are. The thread's tip on z = 0, the head from `length` up,
// `head_t` thick, `head_d` across its flats with `head_sides` sides. The
// head's underside seats on the tile, so `length` is how far the thread
// reaches into it: a tile's thickness to fill the hole.
module mb_plug(size, length, head_d, head_t, head_sides, clearance) {
    mb_thread(size, length, -clearance);
    translate([0, 0, length])
        rotate(180 / head_sides) cylinder(d = head_d / cos(180 / head_sides), h = head_t, $fn = head_sides);
}
