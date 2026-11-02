// Underware straight (I) channel base: the half of an under-desk cable
// channel that mounts to the surface, which the top (i_channel_top.scad)
// snaps onto. Functional face is BOTTOM, the side against the desk or
// board, with one mounting hole per 25mm grid square; that is also the
// print orientation. "mount" sits on TOP, over the open channel, and
// "bot" on the underside, for a connector that mounts the channel some
// other way.
//
// Underware is by Hands on Katie and BlackjackDuck (Andy). The cross-
// section is upstream's own, called from QuackWorks
// (vendor/QuackWorks/Underware) through lib/underware.scad, whose header
// says what is re-expressed there and why.
//
// LICENSE: QuackWorks is CC-BY-NC-SA 4.0, not MIT. Rendering this part
// runs that code, so this part is NOT under the repository's MIT licence
// — see catalogue.yaml's `license` field and the README "Licensing"
// section.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/underware.scad>

module uw_i_channel_base(length_units = 4, width_units = 1, mounting = "Threaded Snap Connector",
                         anchor = BOTTOM, spin = 0, orient = UP) {
    assert(is_int(length_units) && length_units >= 1, "length_units must be a whole number from 1");
    assert(is_int(width_units) && width_units >= 1, "width_units must be a whole number from 1");
    assert(in_list(mounting, UW_MOUNTINGS), str("mounting must be one of ", UW_MOUNTINGS));
    width = width_units * UW_GRID;
    size = [2 * uw_half_width(uw_base_profile(width)), length_units * UW_GRID, UW_BASE_HEIGHT];
    anchors = [
        mount_anchor(size.z / 2),
        named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        down(size.z / 2) uw_straight_base(length_units, width_units, mounting);
        children();
    }
}
