// Corner bracket: a flat mounting plate with a post standing perpendicular
// off it, via a snap joint — a right-angle transition from a flat surface
// mount to a post-style connector (e.g. a wall plate holding a standoff).
// Print both halves separately (part = "a" / "b") and snap them together;
// see lib/joints.scad for the snap peg/hole fit.
//
// Part b is rooted at the flange (not the post) so it prints flange-down,
// post standing straight up — flat and stable on the bed, no overhangs.
//
// snap_flange_a's pegs are built on its "mount"-anchor side, and attach()
// puts whichever anchor you name on the child as the face that touches
// the parent — so the child anchor here is the flange's implicit BOTTOM
// (not "mount"), leaving "mount" (and its pegs) on the exposed face for
// the next hop. Same reasoning chains the rest: BOTTOM to attach a flange,
// "mount" to reach past it.
include <../vendor/BOSL2/std.scad>
include <../lib/joints.scad>
include <../parts/basics/plate.scad>
include <../parts/basics/post.scad>

part = "all"; // ["all", "a", "b"]

module _half_a() { basics_plate() attach("mount", BOTTOM) snap_flange_a(); }
module _half_b() { snap_flange_b() attach("mount", "bot") basics_post(); }

if (part == "a") _half_a();
if (part == "b") _half_b();
if (part == "all")
    basics_plate()
        attach("mount", BOTTOM)
            snap_flange_a()
                attach("mount", BOTTOM)
                    snap_flange_b()
                        attach("mount", "bot")
                            basics_post();
