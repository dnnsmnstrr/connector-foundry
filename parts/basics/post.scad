// Basics post: a round standoff/spacer. Functional face is BOTTOM (also
// print orientation, stands upright on its "bot" anchor); "mount" is the
// standard top anchor, per lib/slots.scad.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module basics_post(dia = 10, h = 20, bore = 0, anchor = BOTTOM, spin = 0, orient = UP) {
    size = [dia, dia, h];
    anchors = [
        mount_anchor(h / 2),
        named_anchor("bot", [0, 0, -h / 2], DOWN, 0),
    ];

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        difference() {
            cyl(d = dia, h = h);
            if (bore > 0)
                through_hole(bore / 2 + FIT_CLEARANCE, h);
        }
        children();
    }
}
