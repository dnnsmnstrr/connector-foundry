// openConnect — openGrid's own connector system (mitufy, see
// https://www.printables.com/model/1559478): a keyhole slot in the
// item being hung, and a matching head on an openGrid snap. The head
// enters the slot through its on-ramp and the item slides until the
// head's pocket seats; a lock nub on one side of the slot clicks over
// the head's. Backwards compatible with MultiConnect (lib/multiconnect.scad).
//
// Thin wrappers over openconnect_lib.scad from openGrid-projects
// (mitufy, CC-BY 4.0, vendored as vendor/opengrid-projects). The two
// callers: parts/opengrid/openconnect.scad puts oc_head() on a snap,
// and the web app's Holes tab subtracts oc_slot() from whatever it is
// given (web/src/lib/screwHoles.js).
//
// Frame: both are in the snap's frame — the origin is the centre of
// the openGrid cell the snap sits in, +Y is "up" on a wall-mounted
// board, the direction the head travels along the slot to seat (the
// item slides down). The head's pocket is NOT centred on the cell: it
// runs from y = -1.7 to 8.9, so a seated head sits 3.6 mm above the
// cell centre.
include <../vendor/BOSL2/std.scad>
include <constants.scad>
use <../vendor/opengrid-projects/lib/openconnect_lib.scad>

// The head as it sits on a snap, before the snap turns it over: pocket
// face (the wide 17 x 10.6 rectangle) on z = 0, neck on top at
// OC_HEAD_H. Lock nubs on both sides, as every openConnect head has.
// `excess` lengthens the neck past OC_HEAD_H, to sink into whatever
// the head is unioned onto so the two are one solid rather than two
// touching on a plane.
module oc_head(excess = 0, anchor = BOTTOM, spin = 0, orient = UP) {
    openconnect_head(add_nubs = "Both", excess_thickness = excess,
                     anchor = anchor, spin = spin, orient = orient)
        children();
}

// The slot, as a solid to subtract: slit on z = 0, pocket below it,
// on-ramp toward -Y. One openGrid cell (28 mm) of footprint.
//   lock             which side gets the lock nub: "left" (upstream's
//                    default), "right", "both", or "none" — more nubs
//                    hold tighter and install harder
//   side_clearance   added around the head, per side (mm)
//   depth_clearance  added under the pocket (mm)
//   overshoot        how far the slit continues above z = 0, so a
//                    subtraction cuts cleanly through the surface
module oc_slot(lock = "left", side_clearance = 0.1, depth_clearance = 0.1, overshoot = 1) {
    assert(lock == "left" || lock == "right" || lock == "both" || lock == "none",
           "lock must be \"left\", \"right\", \"both\" or \"none\"");
    nubs = lock == "left" ? "Left" : lock == "right" ? "Right" : lock == "both" ? "Both" : "";
    openconnect_slot(slot_cfg = ocslot_cfg(side_clearance = side_clearance, depth_clearance = depth_clearance),
                     add_nubs = nubs, excess_thickness = max(overshoot, 0.005), anchor = TOP);
}
