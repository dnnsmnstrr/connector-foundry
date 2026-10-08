// A KLIPPT clip's channel, as a cutter: the Holes tab's "KLIPPT" hole
// (web/src/lib/screwHoles.js). Cut into a part, the part slides onto a
// KLIPPT base (parts/klippt/base.scad) the way a KLIPPT clip does —
// klippt/clip_mount's job, done in place on any face.
//
// KLIPPT is by FH (printables.com/@bequ3), printables.com/model/424351,
// CC BY-SA 4.0 — NOT MIT, see the README's "Licensing"; a part cut with
// this is an adaptation of it.
//
// The cutter is the clip's own negative, from its "cable clip small
// smooth" STL (parts/klippt/, unmodified): within the channel's box —
// between the clip's lips' faces and its floor, across the channel and
// its full 15mm length — everything that is not clip. So the lips, the
// 1mm gap the base's flange slides into, the lock (the lips close to
// 15.46mm near one end, onto the base neck's corners) and the springy
// arm's face on one side are all the clip's.
//
// The surface the cutter goes into sits at the highest point of the
// lips' faces (they slope up ~0.6mm toward their tips), so the cut
// leaves no sliver wedges under them; the base's neck face then sits
// 0.35mm short of the surface — the part stands just off whatever the
// base is mounted on.
//
// Cut into the middle of a face, the channel is closed at both ends, so
// `pocket` adds a drop-in pocket at its entry: the base goes in there
// and slides (the frame's +Y) into the channel to seat. The entry is the
// channel's wider end (its lips 17.16mm apart; the lock end's are
// 15.46mm, which the 18mm neck can only meet with its chamfered
// corners, seated). Without the pocket, `runout` continues the channel
// past its entry, at the entry end's profile, so a channel placed by an
// edge can run out of it.
//
// `clearance` moves each side of the channel out by that much (see
// klippt_negative()): 0, the default here, is the clip exactly; the web
// app cuts 0.3, for a rigid part.
//
// Frame: the surface at z = 0, the material below it; +Y the way the
// base travels to seat; the origin where the seated base's centre is.
// The cut reaches `overshoot` above the surface.

// Measured once on the clip STL with trimesh, in its own coordinates
// (profile in XY, sliding along Z).
KLIPPT_LIPS_MID_X  = 154.62;   // midway between the lips' tips
KLIPPT_MID_Z       = 7.5;      // half its 15mm length
KLIPPT_LENGTH      = 15;
KLIPPT_SURFACE_Y   = 112.35;   // just above the lips' faces (112.32 at most)
KLIPPT_FLOOR_Y     = 115.9;    // just above the floor's underside (115.81 at most)
// The channel's box across: inside the hollow in the clip's left wall
// (out to 143.4), and on the right inside the springy arm (its outside
// comes in to 165.50 mid-length, where its lower edge rounds off at the
// surface). The room behind that arm is open air on a clip, for it to
// flex into; cut into a part it was only a groove in the surface beside
// the channel, so the part keeps it — the arm's channel face is still
// the clip's. At the clip's ends, where the wall stands further out
// (167.02), that leaves a sliver of the flange gap uncut, 0.68mm
// outside the base's flange.
KLIPPT_BOX_X       = [143.6, 165.3];
// The entry end's lip profile, for the runout: a section through the
// entry end's constant stretch (z 11.5 to 15).
KLIPPT_ENTRY_Z     = 13.5;
// How deep the lips go below the surface: down to the flange gap (the
// clip's 114, under KLIPPT_SURFACE_Y).
KLIPPT_LIP_DEPTH   = 114 - KLIPPT_SURFACE_Y + 0.05;
// The runout's lips stand this far apart: the base's 18mm neck, 0.3mm
// clear each side.
KLIPPT_RUNOUT_GAP  = 18 + 2 * 0.3;
// A base (20mm across its flange's flats, an octagon) drops into the
// pocket with this much room all round.
KLIPPT_POCKET      = 20 + 2 * 0.3;

module klippt_channel(pocket = true, runout = 0, clearance = 0, overshoot = 1) {
    depth = KLIPPT_FLOOR_Y - KLIPPT_SURFACE_Y;
    union() {
        // The clip's negative, over its length — stopped 0.01mm inside
        // the clip's end faces, which a box face exactly on them meets
        // edge-on (non-manifold); the pieces below each reach past.
        klippt_negative(clearance, overshoot, 0.01, KLIPPT_LENGTH - 0.01);
        // Room past the far end for the seated base's tip: the base is
        // 20mm long, the clip 15, and on a clip that last 2.5mm stands
        // out into the air.
        translate([-KLIPPT_POCKET / 2, KLIPPT_LENGTH / 2 - 0.05, -depth])
            cube([KLIPPT_POCKET, KLIPPT_POCKET / 2 - KLIPPT_LENGTH / 2 + 0.05, depth + overshoot]);
        // The pocket: the base's flange square, past the entry, as deep
        // as the channel.
        if (pocket)
            translate([-KLIPPT_POCKET / 2, -KLIPPT_LENGTH / 2 - KLIPPT_POCKET, -depth])
                cube([KLIPPT_POCKET, KLIPPT_POCKET + 0.05, depth + overshoot]);
        // The runout: the entry end's cross-section, carried on toward
        // -Y. It starts at the section it was taken from, inside the
        // entry stretch (constant from clip Z 11.5 to 15), so it overlaps
        // the channel where the two are the same shape, 0.01mm smaller
        // all round so its faces are not the channel's (coplanar faces
        // from the two leave non-manifold edges; so does butting it on
        // the channel's end). linear_extrude() runs along its Z;
        // rotate([90, 0, 0]) takes (x, z2d, along) to (x, -along, z2d).
        if (!pocket && runout > 0)
            translate([0, KLIPPT_MID_Z - KLIPPT_ENTRY_Z, 0])
                rotate([90, 0, 0])
                    linear_extrude(height = runout + KLIPPT_ENTRY_Z - KLIPPT_LENGTH / 2)
                        offset(delta = -0.01) union() {
                            klippt_entry_profile(clearance, overshoot);
                            // The lips held apart: the runout is a lead-in,
                            // and the neck should slide down it freely
                            // rather than spread the lips the whole way.
                            translate([-KLIPPT_RUNOUT_GAP / 2, -KLIPPT_LIP_DEPTH])
                                square([KLIPPT_RUNOUT_GAP, KLIPPT_LIP_DEPTH + overshoot]);
                        }
    }
}

// The clip in the hole's frame: clip (X, Y, Z) -> (mid - X, mid_z - Z,
// surface - Y). A proper rotation (a half turn about the vertical, then
// the clip laid lips-up): the lips' faces at z ~ 0, the floor below, the
// entry end (the clip's high Z) toward -Y.
module klippt_clip_in_hole_frame() {
    multmatrix([[-1, 0, 0, KLIPPT_LIPS_MID_X],
                [0, 0, -1, KLIPPT_MID_Z],
                [0, -1, 0, KLIPPT_SURFACE_Y],
                [0, 0, 0, 1]])
        import("../parts/klippt/cable_clip_small_smooth.stl", convexity = 6);
}

// The channel's box in the hole frame, from y0 to y1 along the clip
// (measured from its entry end, y0 = 0 at -KLIPPT_LENGTH/2). Across, the
// clip's X range turned with it: mid - X.
module klippt_channel_box(y0, y1, overshoot) {
    depth = KLIPPT_FLOOR_Y - KLIPPT_SURFACE_Y;
    translate([KLIPPT_LIPS_MID_X - KLIPPT_BOX_X[1], -KLIPPT_LENGTH / 2 + y0, -depth])
        cube([KLIPPT_BOX_X[1] - KLIPPT_BOX_X[0], y1 - y0, depth + overshoot]);
}

// The clip's negative within the channel's box, from y0 to y1 along it —
// and, with `clearance`, widened: each side of it (the lips, the flange
// gap's ends, the lock) moved out by that much, the gap left between the
// two halves filled with the negative's own section along the middle.
// The clip grips the base's neck with its lips spread 0.27mm a side
// (0.42 at its entry end), which a clip's thin body bends to take; cut
// into a rigid part, nothing bends, so the slot is opened instead. Every
// width grows by 2 x clearance, every depth stays the clip's.
module klippt_negative(clearance, overshoot, y0 = 0, y1 = KLIPPT_LENGTH) {
    module half(side) {
        translate([side * clearance, 0, 0])
            intersection() {
                difference() {
                    klippt_channel_box(y0, y1, overshoot);
                    klippt_clip_in_hole_frame();
                }
                translate([side > 0 ? 0 : -40, -40, -40]) cube([40, 80, 80]);
            }
    }
    if (clearance <= 0)
        difference() {
            klippt_channel_box(y0, y1, overshoot);
            klippt_clip_in_hole_frame();
        }
    else
        union() {
            half(-1);
            half(1);
            // The middle: the negative's section at x = 0, carried across
            // the 2 x clearance between the halves (and 0.01mm into each,
            // 0.01mm smaller all round, so no face of it is one of
            // theirs). rotate([0, 90, 0]) takes (x, y, z) to (z, y, -x),
            // putting x = 0 on the cutting plane with 2D (z, y);
            // rotate([0, -90, 0]) takes the extrusion back.
            rotate([0, -90, 0])
                linear_extrude(height = 2 * clearance + 0.02, center = true)
                    offset(delta = -0.01)
                        projection(cut = true)
                            rotate([0, 90, 0])
                                difference() {
                                    klippt_channel_box(y0, y1, overshoot);
                                    klippt_clip_in_hole_frame();
                                }
        }
}

// The entry end's cross-section, 2D in (x, z): the channel's negative
// sliced at the entry stretch (clip Z = KLIPPT_ENTRY_Z, hole-frame
// y = mid_z - that). rotate([-90, 0, 0]) takes (x, y, z) to (x, z, -y),
// so the slice's plane lands on z = 0 for projection(cut = true) with
// its depth as 2D y.
module klippt_entry_profile(clearance, overshoot) {
    y = KLIPPT_MID_Z - KLIPPT_ENTRY_Z;
    projection(cut = true)
        translate([0, 0, y])
            rotate([-90, 0, 0])
                klippt_negative(clearance, overshoot);
}
