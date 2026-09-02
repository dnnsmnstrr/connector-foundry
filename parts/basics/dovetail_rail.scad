// Generic sliding-dovetail rail (the male half). Cross-section tapers
// from DOVETAIL_WIDTH_TOP (narrow tip) to DOVETAIL_WIDTH_BASE (wide
// base) — a classic dovetail key that can't pull straight off in Z,
// only slide out lengthwise. Not tied to any external spec — this
// started life as a guess at DeckMate's dimensions, was confirmed wrong
// against a real DeckMate part, and is kept here as what it actually
// is: a generic parametric dovetail, useful on its own merits. If you
// want a part that mates with a real DeckMate accessory, import the
// actual Mechanism model into the web Bench instead — see the root
// README's "Bench" section.
//
// Functional face is BOTTOM: the rail hangs down from a flat mount face,
// tip at z=0, base flush with "mount" on TOP — same prongs-down /
// mount-up split as parts/gopro/_body.scad's hinge block. The taper gets
// narrower going down, so it prints self-supporting with no overhangs.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module dovetail_rail(rail_len = DOVETAIL_RAIL_LEN, end_stop = false,
                      anchor = BOTTOM, spin = 0, orient = UP) {
    stop_h   = 3; // rise above the rail top, blocks the channel sliding past this end
    stop_len = 3;
    size = [DOVETAIL_WIDTH_BASE, rail_len, DOVETAIL_RAIL_H];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -DOVETAIL_RAIL_H / 2])
        union() {
            prismoid(size1 = [DOVETAIL_WIDTH_TOP, rail_len], size2 = [DOVETAIL_WIDTH_BASE, rail_len],
                      h = DOVETAIL_RAIL_H, anchor = BOTTOM);
            if (end_stop)
                translate([0, rail_len / 2 - stop_len / 2, 0])
                    cuboid([DOVETAIL_WIDTH_BASE, stop_len, DOVETAIL_RAIL_H + stop_h], anchor = BOTTOM);
        }
        children();
    }
}
