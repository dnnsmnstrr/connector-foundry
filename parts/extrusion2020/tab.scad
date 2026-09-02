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

module ex_tab(tab_len = 6, head_t = 2.0, shaft_len = 8,
              anchor = BOTTOM, spin = 0, orient = UP) {
    head_w  = EX_CHANNEL_W - 2 * FIT_CLEARANCE;  // locks against the channel walls
    shaft_r = EX_SLOT_OPEN / 2 - FIT_CLEARANCE;  // round: fits the slot mouth at any twist

    // The channel floor rises at EX_FLOOR_ANGLE toward its walls, so a
    // head that is a plain slab can only ever be EX_CHANNEL_D thick
    // before its outer corners foul. Chamfering the flanks at the same
    // angle follows the floor down, which is what real hammer-head nuts
    // do and what lets head_t exceed EX_CHANNEL_D.
    floor_w = head_w - 2 * head_t / tan(EX_FLOOR_ANGLE);
    assert(floor_w > EX_SLOT_OPEN,
           "head_t is so deep the head narrows past the slot mouth and stops locking");

    total_h = head_t + shaft_len;
    size = [tab_len, head_w, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        union() {
            // Wide face up: that is the one that bears on the lip.
            prismoid(size1 = [tab_len, floor_w], size2 = [tab_len, head_w],
                     h = head_t, rounding = min(tab_len, floor_w) / 4,
                     anchor = BOTTOM);
            translate([0, 0, head_t])
                cyl(r = shaft_r, h = shaft_len, anchor = BOTTOM);
        }
        children();
    }
}
