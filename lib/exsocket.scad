// A socket for the end of a 2020 extrusion: the Holes tab's "2020
// socket" (web/src/lib/screwHoles.js), cut into a part so a length of
// rail pushes into it endwise, along the hole's axis, and stands in it.
//
// The profile's square (EX_PROFILE) plus `clearance` per side, and —
// with `keys` — a key standing in from each wall into that face's slot
// mouth, so the rail can't turn in the socket. The keys are the end
// cap's (parts/extrusion2020/endcap.scad): EX_SLOT_OPEN less the
// clearance either side, reaching through the lip and EX_CHANNEL_D into
// the channel — the depth references.yaml's extrusion2020/endcap-on-end
// fit check holds clear of E2020t. They run the socket's full depth,
// which a slot open at the rail's cut end takes; a rail cut square
// slides straight in.
//
// `bolt`, when more than 0, also cuts an M5 clearance hole (ISO 273
// medium, Ø5.5) that long down from the socket's floor, on the axis: a
// bolt from the part's far side into the rail's centre bore, tapped M5
// on most 20-series profiles, pulls the rail down onto the floor.
//
// `chamfer` bevels the mouth at 45° that far down — the walls and the
// keys' tops alike — as a lead-in for the rail and to take up the
// flared first layers of a socket printed opening-down. `teardrop`, when
// given, makes the bolt hole a teardrop pointing that many degrees
// round from the frame's +Y, so a hole in a wall prints without its top
// drooping (the Holes tab passes the angle that points it up).
//
// Plain OpenSCAD, no BOSL2: the Holes tab `use`s this file, and the
// EX_* numbers come with it (a used file's modules see its includes).
//
// Frame: the socket's axis is z, the surface it is cut into at z = 0 and
// the material below it; it reaches `overshoot` above the surface so the
// cut's top face never meets the part's.
include <constants.scad>

module ex_socket(depth, clearance = FIT_CLEARANCE, keys = true, bolt = 0, bolt_d = 5.5,
                 chamfer = 0, teardrop = undef, overshoot = 1) {
    side    = EX_PROFILE + 2 * clearance;
    key_w   = EX_SLOT_OPEN - 2 * clearance;
    key_in  = EX_PROFILE / 2 - (EX_LIP_T + EX_CHANNEL_D); // the key's inner end
    // No deeper than the keys are wide, or a key's bevelled top would
    // have no width left.
    c = min(chamfer, key_w / 2 - 0.5, depth);
    translate([0, 0, -depth])
        linear_extrude(height = depth + overshoot)
            difference() {
                square(side, center = true);
                if (keys) ex_socket_keys(key_in, key_w, side, 0);
            }
    // The bevel: a frustum from the square at z = -c out to the square
    // grown by c at the surface, less each key bevelled the same way —
    // full at z = -c, its sides and inner end in by c at the surface.
    if (c > 0)
        difference() {
            hull() {
                translate([0, 0, -c]) linear_extrude(height = 0.01) square(side, center = true);
                linear_extrude(height = overshoot) square(side + 2 * c, center = true);
            }
            if (keys)
                for (a = [0, 90, 180, 270])
                    rotate(a)
                        hull() {
                            translate([0, 0, -c]) linear_extrude(height = 0.01) ex_socket_key(key_in, key_w, side, 0);
                            linear_extrude(height = overshoot) ex_socket_key(key_in, key_w, side, c);
                        }
        }
    // Up into the socket a little, so it opens cleanly through the floor.
    if (bolt > 0)
        translate([0, 0, -depth - bolt])
            linear_extrude(height = bolt + 1)
                if (is_undef(teardrop)) circle(d = bolt_d, $fn = 32);
                else rotate(teardrop) ex_teardrop(bolt_d);
}

// One key in 2D, on the +X wall: from its inner end out past the wall
// (so it stays joined to the material around it), `inset` narrower each
// side and that much further out at its inner end.
module ex_socket_key(key_in, key_w, side, inset) {
    translate([key_in + inset, -key_w / 2 + inset])
        square([side / 2 + 1 - key_in, key_w - 2 * inset]);
}

module ex_socket_keys(key_in, key_w, side, inset) {
    for (a = [0, 90, 180, 270]) rotate(a) ex_socket_key(key_in, key_w, side, inset);
}

// A circle of diameter d with a 45° point on +Y: the shape a horizontal
// hole prints without its top sagging.
module ex_teardrop(d) {
    r = d / 2;
    hull() {
        circle(d = d, $fn = 32);
        polygon([[0, r * sqrt(2)], [-r / sqrt(2), r / sqrt(2)], [r / sqrt(2), r / sqrt(2)]]);
    }
}
