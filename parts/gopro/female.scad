// GoPro-standard three-prong female buckle — a thin wrapper over
// GoProScad's gopro_mount_f(). See _body.scad for what this repo adds.
//
// nut_depth > 0 sinks a captive nut pocket in the far leg, which is how
// the standard joint is actually tightened; set it to 0 for a plain
// through-hole. The pocket is a hex M5 nut by default (nut_sides = 6,
// nut_dia across corners — see lib/constants.scad); nut_sides = 4 with
// nut_dia = 11.5 is upstream's square nut.
//
// The pocket makes the far outer leg nut_depth thicker than the near
// one, so the plain buckle is not symmetric about its middle prong.
// symmetric = true pads the near leg out to match (plain through-hole,
// no second pocket), giving the same outer-leg width on both sides and
// a plate centred on the prongs.
include <_body.scad>

module gopro_female(base_h = GP_BASE_T, base_w = GP_BASE_W, leg_h = GP_LEG_H,
                    nut_depth = GP_NUT_DEPTH, nut_dia = GP_NUT_DIA, nut_sides = GP_NUT_SIDES,
                    symmetric = false,
                    anchor = BOTTOM, spin = 0, orient = UP) {
    _gopro_buckle("female", base_h, base_w, leg_h, nut_depth, nut_dia, nut_sides, symmetric,
                  anchor, spin, orient) children();
}
