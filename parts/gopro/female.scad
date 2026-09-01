// GoPro-standard three-prong female buckle. See _body.scad for the
// shared generator and lib/constants.scad for the sourced dimensions.
include <_body.scad>

module gopro_female(prong_len = GP_PRONG_LEN, hinge_t = GP_HINGE_T,
                     anchor = BOTTOM, spin = 0, orient = UP) {
    gopro_body(3, prong_len, hinge_t, anchor, spin, orient) children();
}
