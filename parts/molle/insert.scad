// MOLLE panel insert: plugs into one opening of a rigid MOLLE panel
// (a truck's steel panel, or molle/rigid_panel) and gives a flat face to
// bolt or fuse things onto. Functional face is BOTTOM, the base plate's
// back, behind the panel, which is also the print orientation (base
// down, no supports); "mount" is on TOP, the boss's face in the opening,
// where a holder, a GoPro mount or anything else on the Bench fuses on.
// "bot" is the base's back.
//
// Two stacked bodies: a boss `boss_w` x `boss_h` that fits the opening,
// and a base plate `margin` mm bigger than the boss all round, behind
// the panel. The boss is the insert's own size, not the opening's: the
// defaults (lib/molle.scad's RIGID_INSERT_*) are a tenth under a real
// panel's nominal 38.1 x 25.4 opening, and 0.3 mm a side under
// molle/rigid_panel's printed one. A bigger boss_r fits a tighter corner.
// The boss stands `panel_t - 0.2` tall, a little short of the panel's
// front, so whatever is bolted to it clamps the panel between itself and
// the base instead of bottoming on the boss.
// `hole` drills one through-hole in the middle (0 for none); for heat-set
// insert bores, nut traps or a grid of holes, use the Holes tab on the
// boss face.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/molle.scad>

module molle_insert(boss_w = RIGID_INSERT_W, boss_h = RIGID_INSERT_H, boss_r = RIGID_OPEN_R,
                    panel_t = RIGID_PANEL_T, margin = 6, base = 3, hole = 0,
                    anchor = BOTTOM, spin = 0, orient = UP) {
    assert(boss_w > 4 && boss_h > 4, "boss_w and boss_h must be over 4mm");
    assert(boss_r >= 0, "boss_r must not be negative");
    assert(panel_t >= 0.5, "panel_t must be at least 0.5mm");
    assert(margin >= 1, "margin must be at least 1mm");
    assert(base >= 1, "base must be at least 1mm");
    assert(hole >= 0 && hole < min(boss_w, boss_h) - 2, "hole must fit inside the boss");
    boss_t = max(0.3, panel_t - 0.2);
    size = [boss_w + 2 * margin, boss_h + 2 * margin, base + boss_t];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) difference() {
            union() {
                linear_extrude(base) rigid_opening_outline(size.x, size.y, boss_r + margin);
                translate([0, 0, base - 0.01]) linear_extrude(boss_t + 0.01)
                    rigid_opening_outline(boss_w, boss_h, boss_r);
            }
            if (hole > 0) translate([0, 0, -1]) cylinder(d = hole, h = size.z + 2, $fn = 48);
        }
        children();
    }
}
