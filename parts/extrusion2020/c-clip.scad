// 2020-extrusion profile C-clip. A square ring sized to EX_PROFILE plus
// FIT_CLEARANCE, with one wall slotted open so it can flex over a
// corner and hug the OUTSIDE of the extrusion — a snap-on cable/wire
// clip or positional stop, no fasteners.
//
// The ring's axis runs along the extrusion's length, so a plain
// extrusion of the C cross-section prints with zero overhang regardless
// of which end is "up" — the BOTTOM/mount split used elsewhere in this
// catalogue doesn't map onto a wrap-around clamp, so anchor defaults to
// BOTTOM purely for print-orientation consistency, and "mount" sits on
// the top rim as a reference point rather than a real attachment face.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module ex_c_clip(clip_len = 10, wall = 3,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    inner_w = EX_PROFILE + 2 * FIT_CLEARANCE;
    outer_w = inner_w + 2 * wall;
    gap_w   = EX_PROFILE * 0.4; // wide enough to flex open over the corner, narrow enough to keep grip

    size = [outer_w, outer_w, clip_len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -clip_len / 2])
        difference() {
            cuboid([outer_w, outer_w, clip_len], anchor = BOTTOM);
            cuboid([inner_w, inner_w, clip_len + 1], anchor = BOTTOM);
            translate([0, outer_w / 2 - wall / 2, 0])
                cuboid([gap_w, wall + 2, clip_len + 1], anchor = BOTTOM);
        }
        children();
    }
}
