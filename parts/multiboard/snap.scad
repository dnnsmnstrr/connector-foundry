// Multiboard snap: a plug that screws into a Multiboard tile's big hole
// (lib/multiboard.scad's big thread), with a flat head to fuse a part
// onto. Functional face is BOTTOM, the thread's tip; "mount" is on TOP,
// the head's face, where a hook, a holder or anything else on the Bench
// goes. "bot" is the tip.
//
// The thread is a tile's thickness long, so the head's underside seats
// on the tile's face with the thread filling the hole. The head is an
// octagon 24 mm across its flats, 1 mm inside a cell, so snaps in
// neighbouring holes clear each other, and its flats give fingers a grip
// to turn it in. Multiboard compatible, not Multiboard's: nothing of
// theirs is used (see lib/multiboard.scad).
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/multiboard.scad>

module multiboard_snap(length = MB_TILE_T, head = 3, clearance = MB_THREAD_CLEARANCE,
                       anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length > 0, "length must be positive");
    assert(head > 0, "head must be positive");
    assert(clearance >= 0, "clearance must not be negative");

    head_d = MB_PITCH - 1;
    size = [head_d, head_d, length + head];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) mb_plug("big", length, head_d, head, 8, clearance);
        children();
    }
}
