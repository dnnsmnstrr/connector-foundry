// Underware L channel top: the cover that snaps onto l_channel_base.scad.
// Modelled as fitted, legs down (its functional face, the snap that grips
// the base, is BOTTOM) so its roof is TOP, with "mount" over the corner
// square rather than the bounding box's centre, which is the empty
// inside of the L. Print it roof down, as upstream does: flip it in the
// slicer. x_units and y_units are the legs' lengths beyond the corner
// square.
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

module uw_l_channel_top(x_units = 1, y_units = 1, width_units = 1, height = 12,
                        anchor = BOTTOM, spin = 0, orient = UP) {
    assert(is_int(x_units) && x_units >= 1, "x_units must be a whole number from 1");
    assert(is_int(y_units) && y_units >= 1, "y_units must be a whole number from 1");
    assert(is_int(width_units) && width_units >= 1, "width_units must be a whole number from 1");
    // Upstream's customizer starts at 12mm; below about 10.4mm the
    // profile's inner wall would fold back through its own snap ledge.
    assert(is_num(height) && height >= 12, "height must be at least 12 (mm inside the channel)");
    depth = width_units * UW_GRID;
    extent = uw_l_extent(uw_top_profile(depth, height), x_units * UW_GRID, y_units * UW_GRID, depth);
    size = [extent.x, extent.y, uw_top_height(height)];
    // As on the base: the corner square's centre, to the grid.
    anchors = [mount_anchor(size.z / 2, [x_units * UW_GRID / 2, -y_units * UW_GRID / 2])];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        down(size.z / 2) uw_l_top(x_units, y_units, width_units, height);
        children();
    }
}
