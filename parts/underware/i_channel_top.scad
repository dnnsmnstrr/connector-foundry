// Underware straight (I) channel top: the cover that snaps onto
// i_channel_base.scad. Modelled as fitted, legs down (its functional
// face, the snap that grips the base, is BOTTOM) so its roof — the face
// that shows under the desk — is TOP: "mount" and a slot grid of one
// "mount_<i>_<j>" per 25mm grid square sit on it, for a hook or a clip
// along the channel. Print it roof down, as upstream does: flip it in
// the slicer.
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

module uw_i_channel_top(length_units = 4, width_units = 1, height = 12,
                        anchor = BOTTOM, spin = 0, orient = UP) {
    assert(is_int(length_units) && length_units >= 1, "length_units must be a whole number from 1");
    assert(is_int(width_units) && width_units >= 1, "width_units must be a whole number from 1");
    // Upstream's customizer starts at 12mm; below about 10.4mm the
    // profile's inner wall would fold back through its own snap ledge.
    assert(is_num(height) && height >= 12, "height must be at least 12 (mm inside the channel)");
    profile = uw_top_profile(uw_straight_top_width(width_units, height), height);
    size = [2 * uw_half_width(profile), length_units * UW_GRID, uw_top_height(height)];
    // One slot per grid square, the base's mounting holes' positions.
    anchors = concat([mount_anchor(size.z / 2)],
                     grid_mount_anchors(size, UW_GRID, size.z / 2, count = [width_units, length_units]));
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        down(size.z / 2) uw_straight_top(length_units, width_units, height);
        children();
    }
}
