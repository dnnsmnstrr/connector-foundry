// GoPro-standard two-prong male buckle — a thin wrapper over GoProScad's
// gopro_mount_m(). See _body.scad for what this repo adds on top.
include <_body.scad>

module gopro_male(base_h = GP_BASE_T, base_w = GP_BASE_W, leg_h = GP_LEG_H,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    _gopro_buckle("male", base_h, base_w, leg_h, 0, 0, 4, anchor, spin, orient)
        children();
}
