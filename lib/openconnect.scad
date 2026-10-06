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
use <ogthread.scad>

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

// The head on a male snap thread instead of a snap: upstream's
// openconnect_screw() (unfolded, no text), which screws into a threaded
// openGrid snap — or into the thread the Holes tab cuts (og_thread_hole()
// in lib/ogthread.scad). In the pose it is used in, thread down: its
// tip on z = 0, the head on top at `thread_h`, pocket face out at
// thread_h + OC_HEAD_H — the snap part's pose, the thread standing in
// for the snap. Screwed home, the head points the way the snap's
// does, so the slot's +Y is still up.
//
// Upstream builds it head-down and turns it over (xrot(180) zrot(180),
// the same half turn about Y the snap part gives its head); this is
// that, written out:
//  - the thread, sunk a hundredth into the neck;
//  - the head trimmed by a cone, Ø15.6 at the neck widening at 45°
//    (and 0.32 / 0.45 off centre, upstream's numbers), so it turns
//    clear of the board as it is screwed in;
//  - a coin slot across the pocket face, and a screwdriver slot down
//    its middle.
module oc_screw(thread_h = OG_SNAP_H_FULL) {
    coin_r = OG_COIN_SLOT_H / 2 + OG_COIN_SLOT_W ^ 2 / (8 * OG_COIN_SLOT_H);
    translate([0, 0, thread_h + OC_HEAD_H]) rotate([0, 180, 0]) difference() {
        union() {
            translate([0, 0, OC_HEAD_H - 0.005]) og_thread(thread_h);
            intersection() {
                oc_head(anchor = BOTTOM);
                translate([0.32, 0.45, -0.005])
                    cylinder(d1 = 15.6 + 2 * OC_HEAD_H, d2 = 15.6, h = OC_HEAD_H);
            }
        }
        // Upstream's coin slot, call for call (connector_slot_cfg()'s
        // flat-slot numbers inline).
        translate([0, 0, OG_COIN_SLOT_H]) rotate([0, 0, 90]) rotate([90, 0, 0])
            cyl(r = coin_r, h = OG_COIN_SLOT_T, $fn = 128, anchor = BACK) {
                fwd(0.7) attach(BACK, BOTTOM)
                    prismoid(size1 = [6.5, 1.8], size2 = [undef, 1.2], h = 5 - OG_COIN_SLOT_H + 0.7, xang = [90, 90]);
                left(OG_COIN_SLOT_W / 2) attach(BACK, BACK, inside = true)
                    cuboid([OG_COIN_SLOT_W, coin_r, OG_COIN_SLOT_T]);
            }
    }
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
