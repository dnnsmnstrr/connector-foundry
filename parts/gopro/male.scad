// GoPro-standard two-prong male buckle — a thin wrapper over GoProScad's
// gopro_mount_m(), as carried in _body.scad. See there for what this
// repo adds on top.
//
// leg_dia is the round leg ends' diameter: the standard 15, adjustable
// from 14 to 20 for a little more or less material around the bolt.
// A diameter over leg_h needs leg_h raised to match (see _body.scad).
include <_body.scad>

module gopro_male(base_h = GP_BASE_T, base_w = GP_BASE_W, leg_h = GP_LEG_H, leg_dia = GP_LEG_DIA,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    _gopro_buckle("male", base_h, base_w, leg_h, 0, 0, 4, false, leg_dia, anchor, spin, orient)
        children();
}
