// 2020-extrusion corner bracket. A right-angle gusset joining two
// perpendicular extrusion lengths, one bore per flange for a bolt into
// each extrusion's T-nut / center bore.
//
// Functional face is BOTTOM: flange A lies flat (its outer face is the
// print bed, and the face that bolts to the first extrusion); flange B
// rises as a vertical wall off its back edge and bolts to the second,
// perpendicular extrusion — self-supporting, no overhang. Only one
// "mount" anchor is exposed, on flange B's top edge, for API
// consistency with the rest of the catalogue; flange B's own bolt face
// is a plain feature, not a named anchor — a bracket bolts straight to
// hardware rather than composing with another printed part.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module ex_corner_bracket(leg = EX_PROFILE, wall = 4,
                          anchor = BOTTOM, spin = 0, orient = UP) {
    bore_r  = EX_BORE_R + FIT_CLEARANCE;
    total_h = wall + leg;
    size    = [leg, leg, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        difference() {
            union() {
                cuboid([leg, leg, wall], anchor = BOTTOM);
                translate([0, -leg / 2 + wall / 2, wall])
                    cuboid([leg, wall, leg], anchor = BOTTOM);
            }
            translate([0, 0, wall / 2])
                through_hole(bore_r, wall + 1);
            translate([0, -leg / 2 + wall / 2, wall + leg / 2])
                rotate([90, 0, 0])
                    through_hole(bore_r, wall + 1);
        }
        children();
    }
}
