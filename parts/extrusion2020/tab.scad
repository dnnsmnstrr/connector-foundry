// 2020-extrusion T-slot tab (hammer-head). A round shaft (fits through
// EX_SLOT_OPEN at any rotation) carries a rectangular head sized to lock
// against the EX_CHANNEL_W walls once past the EX_SLOT_OPEN mouth.
//
// `tab_len` is the head's extent along the slot's running length, not
// its across-slot width (that's fixed by the channel/slot constants).
// A short head (<= EX_SLOT_OPEN, ~6mm) can be dropped in face-first at
// any point along the slot and twisted 90 degrees to lock — see
// print_note in catalogue.yaml. A longer head can't be tilted through
// the narrow 6.2mm mouth at a single point; it has to be slid in
// endwise from an open end of the extrusion run instead.
//
// Functional face is BOTTOM: head (the channel-side interface) sits at
// the tip, shaft rises to "mount" on TOP — same prongs-down / mount-up
// split as parts/gopro/_body.scad.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module ex_tab(tab_len = 6, shaft_len = 8,
              anchor = BOTTOM, spin = 0, orient = UP) {
    head_w = EX_CHANNEL_W - 2 * FIT_CLEARANCE; // locks against the channel walls
    head_t = EX_CHANNEL_D - FIT_CLEARANCE;     // fits within the channel depth
    shaft_r = EX_SLOT_OPEN / 2 - FIT_CLEARANCE; // round: fits the slot mouth at any twist

    total_h = head_t + shaft_len;
    size = [tab_len, head_w, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        union() {
            cuboid([tab_len, head_w, head_t], rounding = min(tab_len, head_w) / 4,
                   edges = "Z", anchor = BOTTOM);
            translate([0, 0, head_t])
                cyl(r = shaft_r, h = shaft_len, anchor = BOTTOM);
        }
        children();
    }
}
