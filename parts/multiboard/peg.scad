// Multiboard peg: a plug that screws into one of a Multiboard tile's
// small holes (lib/multiboard.scad's small thread), the ones at the
// corners between four cells, with a round head to fuse a part onto.
// Functional face is BOTTOM, the thread's tip; "mount" is on TOP, the
// head's face. "bot" is the tip.
//
// The thread is a tile's thickness long, so the head seats on the tile's
// face. A small hole's centre is 17.68 mm (25 mm / sqrt 2) from the big
// holes round it, and a Multiboard snap's head reaches 13 mm from its
// own, so a head up to 9 mm across clears a snap in each of them.
// Multiboard compatible, not Multiboard's: nothing of theirs is used
// (see lib/multiboard.scad).
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/multiboard.scad>

module multiboard_peg(length = MB_TILE_T, head_d = 9, head = 2, clearance = MB_THREAD_CLEARANCE,
                      anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length > 0, "length must be positive");
    assert(head_d >= MB_SMALL[0] + 1, "head_d must be at least 1mm wider than the thread");
    assert(head > 0, "head must be positive");
    assert(clearance >= 0, "clearance must not be negative");

    size = [head_d, head_d, length + head];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) mb_plug("small", length, head_d, head, 48, clearance);
        children();
    }
}
