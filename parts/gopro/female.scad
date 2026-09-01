// GoPro-standard three-prong female buckle — a thin wrapper over
// GoProScad's gopro_mount_f(). See _body.scad for what this repo adds.
//
// nut_depth > 0 sinks a captive nut pocket in the far leg, which is how
// the standard joint is actually tightened; set it to 0 for a plain
// through-hole.
include <_body.scad>

module gopro_female(base_h = GP_BASE_T, base_w = GP_BASE_W, leg_h = GP_LEG_H,
                    nut_depth = GP_NUT_DEPTH, nut_dia = GP_NUT_DIA, nut_sides = 4,
                    anchor = BOTTOM, spin = 0, orient = UP) {
    _gopro_buckle("female", base_h, base_w, leg_h, nut_depth, nut_dia, nut_sides,
                  anchor, spin, orient) children();
}
