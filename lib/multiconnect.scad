// MultiConnect — David D's connector for Multiboard, which openConnect
// (lib/openconnect.scad) stays compatible with: a Ø20 disc on a 45°
// cone down to a Ø15 neck, hung in a keyhole channel whose dovetail
// section holds the disc behind a Ø15.3 slit. Written here from the
// published numbers in lib/constants.scad (MC_*) — see the note there
// on where they come from. MIT.
//
// Frame, both modules: z up out of the mating face. The head's disc
// face is on z = 0 (mc_head) — the snap part turns it over so the disc
// points out. The slot's origin is the centre of the round end where
// the head rests when the item hangs; the channel runs toward -Y,
// which is "down" on the wall, to the on-ramp the head enters through.
include <../vendor/BOSL2/std.scad>
include <constants.scad>

// Disc on z = 0, neck on top at MC_HEAD_H, so putting it on a snap is
// a half turn about Y at thickness + MC_HEAD_H. `dimple` sinks a Ø2 cone
// into the disc face, as openGrid-projects' generator does. `excess`
// lengthens the neck past MC_HEAD_H (outside the declared envelope), to
// sink into whatever the head is unioned onto.
module mc_head(dimple = true, excess = 0, anchor = BOTTOM, spin = 0, orient = UP) {
    attachable(anchor, spin, orient, d = MC_HEAD_D, h = MC_HEAD_H) {
        down(MC_HEAD_H / 2) difference() {
            union() {
                cylinder(d = MC_HEAD_D, h = MC_HEAD_DISC_H);
                up(MC_HEAD_DISC_H - 0.005)
                    cylinder(d1 = MC_HEAD_D, d2 = MC_HEAD_NECK_D, h = MC_HEAD_CONE_H + 0.005);
                up(MC_HEAD_DISC_H + MC_HEAD_CONE_H - 0.005)
                    cylinder(d = MC_HEAD_NECK_D, h = MC_HEAD_NECK_H + 0.005 + excess);
            }
            if (dimple)
                down(0.005) cylinder(d1 = 2, d2 = 0.005, h = 1, $fn = 128);
        }
        children();
    }
}

// The slot, as a solid to subtract: slit on z = 0, pocket at
// MC_SLOT_DEPTH below it.
//   length     how far the channel runs from the round end to the entry
//              (Multiboard spaces slots MC_SLOT_PITCH apart; the item
//              needs to slide at least the disc's diameter)
//   on_ramp    a funnel at the entry end (Ø24 at the mouth, Ø20.3 at
//              the pocket floor) so the head can be pushed straight in
//              there; without it the channel is open-ended and the item
//              has to slide on from its edge
//   detent     the v2 detent: the channel narrows 0.4 mm just below the
//              round end so a seated head clicks in
//   clearance  added to every radius (mm)
//   overshoot  how far the slit continues above z = 0
module mc_slot(length = MC_SLOT_PITCH, on_ramp = true, detent = true, clearance = 0, overshoot = 1) {
    r_pocket = MC_SLOT_D / 2 + clearance;
    r_slit   = MC_SLOT_NECK_D / 2 + clearance;
    z_floor  = -MC_SLOT_DEPTH;
    z_pocket = z_floor + MC_SLOT_POCKET_H;
    z_slit   = z_pocket + MC_SLOT_CONE_H;
    // Half profile, (radius, z): floor to the surface and on past it.
    half = [[0, z_floor], [r_pocket, z_floor], [r_pocket, z_pocket], [r_slit, z_slit],
            [r_slit, overshoot], [0, overshoot]];
    full = concat(half, [for (i = [len(half) - 1 : -1 : 0]) [-half[i].x, half[i].y]]);

    // Round end — the shape of the head, where it rests.
    rotate_extrude($fn = 96) polygon(half);
    // The channel, running from the round end toward -Y. The detent
    // is taken out of the channel alone, so the round end keeps its
    // full width (upstream does the same).
    difference() {
        rotate([90, 0, 0]) linear_extrude(length) polygon(full);
        if (detent)
            for (side = [-1, 1])
                scale([side, 1, 1])
                    translate([0, 0, z_floor - 0.005])
                        linear_extrude(MC_SLOT_DEPTH + overshoot + 0.01)
                            polygon([[r_pocket, 0], [r_pocket - MC_DETENT_DEPTH, 0], [r_pocket, -MC_DETENT_LEN]]);
    }
    // The entry funnel, centred on the channel's far end.
    if (on_ramp)
        translate([0, -length, z_floor])
            cylinder(r1 = r_pocket, r2 = MC_ONRAMP_D / 2 + clearance,
                     h = MC_SLOT_DEPTH + MC_ONRAMP_LIFT, $fn = 96);
}
