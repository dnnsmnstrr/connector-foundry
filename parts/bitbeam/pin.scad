// BitBeam friction pin — which is a LEGO Technic pin: bitbeam.cc's
// system is Technic-compatible by design, and the pin that joins two
// 8mm beams through their 4.8mm holes is LEGO part 2780 (or its longer
// sibling 6558). Geometry comes from vendor/technic.scad (cfinke, MIT) —
// a real split pin: hollow body, collar between the halves, a lip at
// each tip that clicks past the far face, friction ridges, the flex slit
// and cross slot. The former version here was a plain chamfered
// cylinder, which is not a pin anyone would recognise.
//
// Lengths are per half, in Technic units (technic_height_in_mm, 7.8mm —
// LEGO's beam thickness, a hair under BitBeam's 8mm, so a tip lip lands
// just shy of an 8mm beam's far face rather than past it; the friction
// ridges grip either way). Every dimension is technic.scad's own,
// deliberately not overridden from lib/constants.scad: a pin has to
// match LEGO's holes, not this repo's restatement of them.
//
// Functional face is BOTTOM (the bottom half's tip); "mount" on TOP.
// Prints standing up, as the library intends.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../vendor/technic.scad/Technic.scad>

// Technic.scad sets $fa/$fs to very fine values at file level, which —
// as an include — would apply to every curve in the whole compile, not
// just the pin (a Bench assembly with a pin in it would tessellate its
// Gridfinity base at 0.05mm). Put OpenSCAD's defaults back; the pin
// itself gets an explicit $fn inside its module below.
$fa = 12;
$fs = 2;

// Segment count for every curve of the pin. A multiple of 4, so the
// collar's polygon has vertices on both axes and the rendered bounding
// box is exactly the declared size (tests/test_anchors.py holds it to
// 0.001mm).
BITBEAM_PIN_FN = 32;

// Total length for `top_length`/`bottom_length` halves: each half is a
// Technic unit, and the two halves share one collar.
function bitbeam_pin_len(top_length = 1, bottom_length = 1) =
    (top_length + bottom_length) * technic_height_in_mm - technic_pin_collar_thickness;

// Length of the default pin — what lib/joints.scad's pin joint (via the
// web Bench's codegen, `overlap = BITBEAM_PIN_LEN / 2`) centres on the
// seam between its two flanges, collar in the seam.
BITBEAM_PIN_LEN = bitbeam_pin_len();

module bitbeam_pin(top_length = 1, bottom_length = 1, friction = true,
                   anchor = BOTTOM, spin = 0, orient = UP) {
    assert(top_length >= 1 && bottom_length >= 1,
        "bitbeam_pin: each half is at least one Technic unit — for a half-pin or a stud end, call technic_pin() directly");
    $fn = BITBEAM_PIN_FN;
    len = bitbeam_pin_len(top_length, bottom_length);
    // The collar is the pin's widest point.
    size = [technic_pin_collar_diameter, technic_pin_collar_diameter, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(len / 2)]) {
        // technic_pin() stands on the origin; attachable() wants it centred.
        translate([0, 0, -len / 2])
            technic_pin(top_length = top_length, top_friction = friction,
                        bottom_length = bottom_length, bottom_friction = friction);
        children();
    }
}
