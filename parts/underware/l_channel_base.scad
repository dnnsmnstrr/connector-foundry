// Underware L channel base: a 90° corner of the under-desk cable channel,
// the half that mounts to the surface (l_channel_top.scad snaps onto
// it). Functional face is BOTTOM, against the desk or board, with one
// mounting hole per 25mm grid square along the channel; that is also the
// print orientation. "mount" (TOP) and "bot" sit over the corner square,
// not the bounding box's centre, which is the empty inside of the L.
// x_units and y_units are the legs' lengths beyond the corner square.
//
// Underware is by Hands on Katie and BlackjackDuck (Andy). The cross-
// section and the path it is swept along are upstream's own, called from
// QuackWorks (vendor/QuackWorks/Underware) through lib/underware.scad,
// whose header says what is re-expressed there and why.
//
// LICENSE: QuackWorks is CC-BY-NC-SA 4.0, not MIT. Rendering this part
// runs that code, so this part is NOT under the repository's MIT licence
// — see catalogue.yaml's `license` field and the README "Licensing"
// section.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/underware.scad>

module uw_l_channel_base(x_units = 1, y_units = 1, width_units = 1, mounting = "Threaded Snap Connector",
                         anchor = BOTTOM, spin = 0, orient = UP) {
    assert(is_int(x_units) && x_units >= 1, "x_units must be a whole number from 1");
    assert(is_int(y_units) && y_units >= 1, "y_units must be a whole number from 1");
    assert(is_int(width_units) && width_units >= 1, "width_units must be a whole number from 1");
    assert(in_list(mounting, UW_MOUNTINGS), str("mounting must be one of ", UW_MOUNTINGS));
    depth = width_units * UW_GRID;
    extent = uw_l_extent(uw_base_profile(depth), x_units * UW_GRID, y_units * UW_GRID, depth);
    size = [extent.x, extent.y, UW_BASE_HEIGHT];
    // The corner square's centre, to the grid: catalogue.yaml's
    // mount_offset restates it. (The profile's 0.017mm overhang, split
    // across the bounding box, leaves it 0.0085mm off true.)
    corner = [x_units * UW_GRID / 2, -y_units * UW_GRID / 2];
    anchors = [
        mount_anchor(size.z / 2, corner),
        named_anchor("bot", [corner.x, corner.y, -size.z / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        down(size.z / 2) uw_l_base(x_units, y_units, width_units, mounting);
        children();
    }
}
