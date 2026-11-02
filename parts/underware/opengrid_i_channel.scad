// Underware for openGrid, straight (I) channel: one piece, no base, its
// walls ending in grips that snap into an openGrid board's cells.
// Functional face is BOTTOM, the grips, which reach 3.4mm past the walls
// into the board; the roof is TOP, with "mount" and a slot grid of one
// "mount_<i>_<j>" per 28mm grid square on it, for a hook or a clip along
// the channel. Print it roof down, as upstream does: flip it in the
// slicer.
//
// The openGrid adaptation of Underware is David D's; the geometry is
// Pedro Leite's OpenSCAD version of it, Monokini, called from
// vendor/Monokini through lib/underware_opengrid.scad, whose header says
// what is re-expressed there and why.
//
// LICENSE: Monokini's files are CC-BY-NC-SA 4.0, not MIT. Rendering this
// part runs that code, so this part is NOT under the repository's MIT
// licence — see catalogue.yaml's `license` field and the README
// "Licensing" section.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/underware_opengrid.scad>

module uw_og_i_channel(length_units = 4, width_units = 1, height = 22,
                       anchor = BOTTOM, spin = 0, orient = UP) {
    assert(is_int(length_units) && length_units >= 1, "length_units must be a whole number from 1");
    assert(is_int(width_units) && width_units >= 1, "width_units must be a whole number from 1");
    // Upstream's customizer starts at 10mm: the walls then run from the
    // roof's 4mm chamfer to 6.6mm, where the grips begin.
    assert(is_num(height) && height >= 10, "height must be at least 10 (mm, grips included)");
    size = uwog_straight_size(length_units, width_units, height);
    // One slot per grid square, over the grips' cells.
    anchors = concat([mount_anchor(size.z / 2)],
                     grid_mount_anchors(size, UWOG_GRID, size.z / 2, count = [width_units, length_units]));
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        down(size.z / 2) uwog_straight(length_units, width_units, height);
        children();
    }
}
