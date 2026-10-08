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
// Plain OpenSCAD, no BOSL2: the Holes tab `use`s this file, and the
// EX_* numbers come with it (a used file's modules see its includes).
//
// Frame: the socket's axis is z, the surface it is cut into at z = 0 and
// the material below it; it reaches `overshoot` above the surface so the
// cut's top face never meets the part's.
include <constants.scad>

module ex_socket(depth, clearance = FIT_CLEARANCE, keys = true, overshoot = 1) {
    side    = EX_PROFILE + 2 * clearance;
    key_w   = EX_SLOT_OPEN - 2 * clearance;
    key_in  = EX_PROFILE / 2 - (EX_LIP_T + EX_CHANNEL_D); // the key's inner end
    translate([0, 0, -depth])
        linear_extrude(height = depth + overshoot)
            difference() {
                square(side, center = true);
                if (keys)
                    for (a = [0, 90, 180, 270])
                        rotate(a)
                            // From its inner end out past the wall, so it
                            // stays joined to the material around it.
                            translate([key_in, -key_w / 2])
                                square([side / 2 + 1 - key_in, key_w]);
            }
}
