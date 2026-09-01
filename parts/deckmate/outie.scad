// DeckMate sliding-dovetail rail ("Outie", the male half). Cross-section
// tapers from DM_WIDTH_TOP (narrow tip) to DM_WIDTH_BASE (wide base) —
// a classic dovetail key that can't pull straight off in Z, only slide
// out lengthwise.
//
// Functional face is BOTTOM: the rail hangs down from a flat mount face,
// tip at z=0, base flush with "mount" on TOP — same prongs-down /
// mount-up split as parts/gopro/_body.scad's hinge block. The taper gets
// narrower going down, so it prints self-supporting with no overhangs.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module deckmate_outie(rail_len = DM_RAIL_LEN, end_stop = false,
                       anchor = BOTTOM, spin = 0, orient = UP) {
    stop_h   = 3; // rise above the rail top, blocks the Innie sliding past this end
    stop_len = 3;
    size = [DM_WIDTH_BASE, rail_len, DM_RAIL_H];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -DM_RAIL_H / 2])
        union() {
            prismoid(size1 = [DM_WIDTH_TOP, rail_len], size2 = [DM_WIDTH_BASE, rail_len],
                      h = DM_RAIL_H, anchor = BOTTOM);
            if (end_stop)
                translate([0, rail_len / 2 - stop_len / 2, 0])
                    cuboid([DM_WIDTH_BASE, stop_len, DM_RAIL_H + stop_h], anchor = BOTTOM);
        }
        children();
    }
}
