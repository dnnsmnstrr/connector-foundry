// SOLDR base: the bottom of a SOLDR module, any number of units each
// way, for standing a part on a SOLDR frame. SOLDR is by soldr.pro,
// CC BY-NC-SA 4.0 — NOT MIT, see the README's "Licensing";
// lib/soldr.scad has the numbers and where they come from.
//
// One tapered foot per unit on a 30.5mm pitch, under a 1mm plate: a base
// is exactly units x 30.5 - 1.7mm each way and 3mm tall. magnets "two"
// gives each foot the designer's two 6mm magnet holes, "one" one in its
// middle, "four" four on a regular 15.25mm grid (lib/soldr.scad says
// where); all are open at the top:
// press the magnets in before anything closes them over (on a fused part,
// pause the print at 3mm).
//
// Functional face is BOTTOM (also the print orientation); mates through
// the "mount" anchor on TOP, or through the "mount_<i>_<j>" slot over
// each unit's centre; from 2 x 2 up, "mount_0_0" is the base's middle
// too, when no unit is centred there.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/soldr.scad>

module soldr_base(gx = 2, gy = 1, magnets = "two", anchor = BOTTOM, spin = 0, orient = UP) {
    assert(gx >= 1 && gy >= 1, "gx and gy must be at least 1");
    assert(gx == round(gx) && gy == round(gy), "gx and gy must be whole numbers");
    size = soldr_base_size(gx, gy);
    anchors = concat([mount_anchor(size.z / 2)],
                     grid_mount_anchors(size, SOLDR_PITCH, size.z / 2, count = [gx, gy]),
                     center_slot_anchor([gx, gy], size.z / 2));

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        translate([0, 0, -size.z / 2])
            soldr_base_body(gx, gy, magnets, $fa = detail_fa(4), $fs = detail_fs(0.25));
        children();
    }
}
