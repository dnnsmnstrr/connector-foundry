// Underware for openGrid, L channel: a 90° corner, one piece, its walls
// ending in grips that snap into an openGrid board's cells. Functional
// face is BOTTOM, the grips; the roof is TOP, with "mount" over the
// corner square rather than the bounding box's centre, which is the
// empty inside of the L. x_units and y_units are the legs' lengths
// beyond the corner square, along +X and +Y. Print it roof down, as
// upstream does: flip it in the slicer.
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

module uw_og_l_channel(x_units = 1, y_units = 1, width_units = 1, height = 22,
                       anchor = BOTTOM, spin = 0, orient = UP) {
    assert(is_int(x_units) && x_units >= 1, "x_units must be a whole number from 1");
    assert(is_int(y_units) && y_units >= 1, "y_units must be a whole number from 1");
    assert(is_int(width_units) && width_units >= 1, "width_units must be a whole number from 1");
    // As for the straight channel: upstream's customizer starts at 10mm.
    assert(is_num(height) && height >= 10, "height must be at least 10 (mm, grips included)");
    b = uwog_l_bounds(x_units, y_units, width_units);
    centre = (b[0] + b[1]) / 2;
    size = [b[1].x - b[0].x, b[1].y - b[0].y, height];
    // The corner square's centre, which catalogue.yaml's mount_offset
    // restates: the separation on the outside walls and the legs' Nudge
    // put it 0.3975mm + half a leg off the box's centre on X, 0.4075mm +
    // half a leg on Y.
    anchors = [mount_anchor(size.z / 2, -centre)];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        down(size.z / 2) move(-centre) uwog_l(x_units, y_units, width_units, height);
        children();
    }
}
