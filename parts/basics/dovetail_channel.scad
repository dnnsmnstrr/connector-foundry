// Generic dovetail receiver (the female half). A floor plus two
// undercut lips forming a channel that dovetail_rail's rail slides into
// lengthwise. The channel is the rail's cross-section exactly negated
// and expanded by `clearance`, walled in by `wall`. See
// dovetail_rail.scad's header for why this lives in Basics and not
// DeckMate.
//
// Functional face is BOTTOM: the channel mouth opens downward — narrow
// at z=0, widening toward the floor at the top — same prongs-down /
// mount-up split as the rail and parts/gopro/_body.scad. The void
// widens going up, so the solid walls only get thinner with height,
// never overhang; prints self-supporting.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module dovetail_channel(rail_len = DOVETAIL_RAIL_LEN, wall = DOVETAIL_WALL_T,
                         clearance = DOVETAIL_SLIDE_CLEARANCE,
                         anchor = BOTTOM, spin = 0, orient = UP) {
    mouth_w = DOVETAIL_WIDTH_TOP + 2 * clearance;  // channel opening, at z=0
    floor_w = DOVETAIL_WIDTH_BASE + 2 * clearance; // channel width at the floor, at z=DOVETAIL_RAIL_H
    total_w = floor_w + 2 * wall;
    total_h = DOVETAIL_RAIL_H + wall;
    size = [total_w, rail_len, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        difference() {
            cuboid([total_w, rail_len, total_h], anchor = BOTTOM);
            prismoid(size1 = [mouth_w, rail_len + 1], size2 = [floor_w, rail_len + 1],
                      h = DOVETAIL_RAIL_H, anchor = BOTTOM);
        }
        children();
    }
}
