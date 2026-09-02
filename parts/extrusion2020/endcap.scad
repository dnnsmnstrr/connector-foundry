// 2020-extrusion end-face plate. A EX_PROFILE x EX_PROFILE cap with a
// center bore, plus four locating keys on its underside, one per slot,
// so the cap self-centers and can't spin.
//
// Four separate keys and not one cross: the arms of a cross meet at the
// middle of the profile, and the middle of a 20-series extrusion is
// solid — spars and the centre boss. The cross this replaced reached
// 8.5mm in from each face, and 332mm3 of it lands inside the rail's
// core (measured against NopSCADlib's E2020t), so the cap could not be
// pushed on at all. Each key now spans only the depth its own slot
// actually offers: through the lip, then into the channel.
//
// Functional face is BOTTOM (the keys + bore side, mates flush against
// the extrusion's cut end), "mount" anchor on TOP — same convention as
// the rest of this system. Judgment call: the plate is wider than the
// keys, so its four corners overhang them with no support underneath;
// documented honestly in catalogue.yaml's print_note rather than
// silently dropping the convention.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module ex_endcap(plate_t = 3, boss_h = 2,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    key_w   = EX_SLOT_OPEN - 2 * FIT_CLEARANCE; // key fits the slot mouth
    key_len = EX_LIP_T + EX_CHANNEL_D;          // lip, then into the channel
    bore_r  = EX_BORE_R + FIT_CLEARANCE;

    total_h = boss_h + plate_t;
    size = [EX_PROFILE, EX_PROFILE, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        difference() {
            union() {
                for (a = [0, 90, 180, 270])
                    zrot(a)
                        right(EX_PROFILE / 2 - key_len / 2)
                            cuboid([key_len, key_w, boss_h], anchor = BOTTOM);
                translate([0, 0, boss_h])
                    cuboid([EX_PROFILE, EX_PROFILE, plate_t], rounding = 1, edges = "Z", anchor = BOTTOM);
            }
            through_hole(bore_r, total_h + 1);
        }
        children();
    }
}
