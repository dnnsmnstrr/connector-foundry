// openGrid's snap thread — the 16 mm, 3 mm pitch thread that
// openGrid-projects' threaded snaps take (mitufy, CC-BY 4.0, vendored as
// vendor/opengrid-projects): the "screw" snaps, which go into a board
// cell like any snap and take a connector screwed into them from the
// front. Two callers: the openConnect and MultiConnect parts' body =
// "screw" (a head on a male thread, upstream's openconnect_screw() and
// multiconnect_screw()), and the Holes tab, which cuts the female
// thread into anything (web/src/lib/screwHoles.js) so the same screws
// go into it.
//
// Upstream's "Blunt" thread (its default — the end a screw starts on
// is cut blunt, so it cannot cross-thread), from opengrid_threads_lib's
// blunt_threads() as snap_threads() places it, the same solid to the
// facet. Not called directly for the same reason lib/opengrid.scad
// does not call base_snap(): depth. The browser's OpenSCAD runs out of
// stack ~70 module levels down, and upstream's tag/diff() wrappers put
// its thread at 77 levels before anything is built on it (its
// screw: 94). Here the one deep call is BOSL2's thread_helix() (29);
// the rest is builtins.
//
// Frame: the thread's axis is z, the entry end on z = 0 — the face a
// screw goes in through, on a snap the front of the board — and its
// far end at `height`. A male thread runs from its head (z = 0, where
// upstream's is flat) out to its blunt tip; a female thread from the
// face it is cut into. Both are in the same frame, turned the same, so
// a screw whose thread frame meets the hole's is screwed home — that is
// what upstream's OG_SNAP_THREADS_COMPATIBILITY_ANGLE is for: the
// heads end up pointing the way their snap does.
include <../vendor/BOSL2/std.scad>
include <../vendor/BOSL2/threading.scad>
include <constants.scad>

// The thread as a solid, z = 0 to `height`: a male thread with
// clearance 0, the female thread's cutter with OG_THREAD_CLEARANCE.
// blunt_threads() with snap_threads()' turn, step for step:
//  - a core one thread depth (1 mm) in from the crest;
//  - the helix, started half a turn below z = 0 with its blunt lead-in
//    at the top. Upstream places it with zrot(30) up(0.25) zrot(-180)
//    up(-1.5) — the 0.25 a quarter of the profile's flat crest, the
//    -1.5 its half-turn head start — one rotation and one lift here;
//  - cut flat at z = 0 and at `height`.
// $fn 256 is upstream's, so a thread here meets a thread there.
module og_thread(height = 6.8, clearance = 0) {
    d = OG_THREAD_D + clearance;
    turns = max(0, (height - 1.5) / OG_THREAD_PITCH) + 0.5;
    big = d + 2;
    rotate(OG_THREAD_ANGLE) difference() {
        union() {
            cylinder(d = d - 2 + 0.005, h = height, $fn = 256);
            difference() {
                rotate(30 - 180) translate([0, 0, 0.25 - 1.5])
                    thread_helix(d = d, turns = turns, pitch = OG_THREAD_PITCH, profile = OG_THREAD_PROFILE,
                                 anchor = BOTTOM, internal = false, lead_in_ang2 = 10, $fn = 256);
                translate([-big / 2, -big / 2, height]) cube(big);
            }
        }
        translate([-big / 2, -big / 2, -big]) cube(big);
    }
}

// The female thread as the Holes tab cuts it, in a hole's frame: z up
// out of the face, the surface on z = 0, the thread `depth` into the
// material below it (the thread frame above turned over about Y, so a
// screw's +Y — up, on a wall — stays the hole's +Y). `overshoot`
// carries the bore on past the surface so the cut opens cleanly. A
// full-size screw's thread is 6.8 long (a lite one 3.4); the hole wants
// to be at least that deep, and the screw seats when its head meets
// the surface.
module og_thread_hole(depth = 6.8, clearance = OG_THREAD_CLEARANCE, overshoot = 1) {
    rotate([0, 180, 0]) og_thread(depth, clearance);
    // Upstream's own cut starts a hair proud of its face (EPS / 2).
    translate([0, 0, -0.01])
        cylinder(d = OG_THREAD_D + clearance, h = overshoot + 0.01, $fn = 256);
}
