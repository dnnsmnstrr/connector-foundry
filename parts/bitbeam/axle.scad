// BitBeam axle — a LEGO Technic axle (parts 3704/3705/3706/... by
// length), the cross-section shaft that turns freely in a beam's round
// hole and locks in a gear's or wheel's axle hole. Geometry comes from
// vendor/technic.scad (cfinke, MIT); see pin.scad's header for why a
// BitBeam fastener is a LEGO one and why nothing here is overridden
// from lib/constants.scad. The former "shaft" here was a plain
// chamfered cylinder, which turns in a hole but drives nothing.
//
// `length` is in Technic units (7.8mm), so 4 is LEGO's 3705.
// Functional face is BOTTOM; "mount" on TOP. Prints standing up.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../vendor/technic.scad/Technic.scad>

// Same reset as pin.scad — see there.
$fa = 12;
$fs = 2;

BITBEAM_AXLE_FN = 32;

module bitbeam_axle(length = 4, anchor = BOTTOM, spin = 0, orient = UP) {
    $fn = BITBEAM_AXLE_FN;
    h = technic_height_in_mm * length;
    // technic_axle() rounds its corners with a minkowski() sphere, and a
    // tessellated sphere has no vertex exactly at its equator or poles:
    // its reach in every axis is r * cos(90° / rings), rings being
    // floor(($fn + 1) / 2). Declare the size the mesh really has rather
    // than the nominal one, or every anchor on the part would sit that
    // far off (tests/test_anchors.py holds it to 0.001mm; the deficit at
    // $fn = 32 is 0.0039mm).
    rings = floor((BITBEAM_AXLE_FN + 1) / 2);
    shrink = 2 * technic_axle_spline_corner_radius * (1 - cos(90 / rings));
    w = technic_axle_spline_width - shrink;
    size = [w, w, h - shrink];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        // technic_axle() stands on the origin (nominally — the mesh's
        // bottom sits shrink/2 above it, symmetric with its top, so
        // centring the nominal length centres the mesh).
        translate([0, 0, -h / 2]) technic_axle(length = length);
        children();
    }
}
