// GoPro-standard three-prong female buckle — a thin wrapper over
// GoProScad's gopro_mount_f(), as carried in _body.scad. See there for
// what this repo adds.
//
// outer_w is the width of the far outer leg. Everything beyond the
// standard GP_LEG_T (3mm) is a captive nut pocket, which is how the
// standard joint is actually tightened: the default 6 is a 3mm leg with
// a 3mm pocket. outer_w = GP_LEG_T makes all three prongs the same
// width, with no room for a pocket — a plain through-hole. The pocket is
// a hex M5 nut by default (nut_sides = 6, nut_dia across corners — see
// lib/constants.scad); nut_sides = 4 with nut_dia = 11.5 is upstream's
// square nut.
//
// A wider far leg leaves the near one at GP_LEG_T, so the plain buckle
// is not symmetric about its middle prong. symmetric = true pads the
// near leg out to outer_w as well (plain through-hole, no second
// pocket), giving the same outer-leg width on both sides and a plate
// centred on the prongs.
//
// leg_dia is the round leg ends' diameter: the standard 15, adjustable
// from 14 to 20 for a little more or less material around the bolt.
// A diameter over leg_h needs leg_h raised to match (see _body.scad).
include <_body.scad>

module gopro_female(base_h = GP_BASE_T, base_w = GP_BASE_W, leg_h = GP_LEG_H,
                    outer_w = GP_OUTER_W, nut_dia = GP_NUT_DIA, nut_sides = GP_NUT_SIDES,
                    symmetric = false, leg_dia = GP_LEG_DIA,
                    anchor = BOTTOM, spin = 0, orient = UP) {
    assert(outer_w >= GP_LEG_T, str("outer_w must be at least the standard leg width, ", GP_LEG_T, "mm"));
    _gopro_buckle("female", base_h, base_w, leg_h, outer_w - GP_LEG_T, nut_dia, nut_sides, symmetric, leg_dia,
                  anchor, spin, orient) children();
}
