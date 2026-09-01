// 2020-extrusion end-face plate. A EX_PROFILE x EX_PROFILE cap with a
// center bore, plus a locating cross on its underside whose four arms
// drop into the four slot mouths so the cap self-centers and can't spin.
//
// Functional face is BOTTOM (the cross + bore side, mates flush against
// the extrusion's cut end), "mount" anchor on TOP — same convention as
// the rest of this system. Judgment call: the plate is wider than the
// cross, so its four corners overhang the boss with no support under
// them; documented honestly in catalogue.yaml's print_note rather than
// silently dropping the convention.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module ex_endcap(plate_t = 3, boss_h = 2,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    arm_w   = EX_SLOT_OPEN - 2 * FIT_CLEARANCE; // key fits the slot mouth
    arm_len = EX_PROFILE - 3;                   // stays inboard of the profile edge
    bore_r  = EX_BORE_R + FIT_CLEARANCE;

    total_h = boss_h + plate_t;
    size = [EX_PROFILE, EX_PROFILE, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        difference() {
            union() {
                cuboid([arm_len, arm_w, boss_h], anchor = BOTTOM);
                cuboid([arm_w, arm_len, boss_h], anchor = BOTTOM);
                translate([0, 0, boss_h])
                    cuboid([EX_PROFILE, EX_PROFILE, plate_t], rounding = 1, edges = "Z", anchor = BOTTOM);
            }
            through_hole(bore_r, total_h + 1);
        }
        children();
    }
}
