// A plain octagonal peg for a Multiboard tile's large octagonal opening.
// The across-flats size follows the measured narrow section of the opening;
// shorten or narrow it for a looser fit on a particular printer.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>

module multiboard_octagon_peg(length = 25, across_flats = 14.5, clearance = 0.25,
                              anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length > 0, "length must be positive");
    assert(across_flats > 0, "across_flats must be positive");
    assert(clearance >= 0, "clearance must not be negative");

    d = (across_flats - clearance) / cos(22.5);
    attachable(anchor, spin, orient, size = [d, d, length],
               anchors = [mount_anchor(length / 2)]) {
        linear_extrude(height = length)
            rotate(-22.5) circle(d = d, $fn = 8);
        children();
    }
}
