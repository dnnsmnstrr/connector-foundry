// A BitBeam (LEGO Technic-compatible) pin hole: the Holes tab's "BitBeam
// pin hole" (web/src/lib/screwHoles.js), cut into a part so a BitBeam /
// Technic friction pin (parts/bitbeam/pin.scad) goes into it as it does
// into a beam.
//
// The hole is a beam's, as vendor/bitbeam-lib's holes() cuts it (its
// default, rim = false): BITBEAM_HOLE_DIA through, and a groove 0.2 mm
// wider and 0.75 mm tall centred 0.8 mm in from each face — what a pin's
// tip lip springs out into. A beam has a face at both ends; a hole cut
// into a part knows only the one it is cut from, so the far groove goes
// at the bottom of a blind hole (`far_groove`): a hole one beam deep
// (BITBEAM_UNIT) is then a beam's hole exactly — references.yaml's
// bitbeam/pinhole-vs-beam-hole holds it to bitbeam-lib's. A through hole
// gets the entry groove only.
//
// `teardrop`, when given, makes the bore and grooves teardrops pointing
// that many degrees round from the frame's +Y, for a hole in a wall
// (lib/exsocket.scad's bolt hole does the same).
//
// Frame: the hole's axis is z, the surface at z = 0 and the material
// below it; the cut reaches `overshoot` above the surface.
include <constants.scad>

BITBEAM_GROOVE_D  = BITBEAM_HOLE_DIA + 0.2; // bitbeam-lib's hole + 0.2
BITBEAM_GROOVE_H  = 0.75;
BITBEAM_GROOVE_IN = 0.8;                    // face to the groove's centre

module bb_pinhole(depth = BITBEAM_UNIT, far_groove = true, teardrop = undef, overshoot = 1) {
    translate([0, 0, -depth])
        linear_extrude(height = depth + overshoot) bb_pinhole_outline(BITBEAM_HOLE_DIA, teardrop);
    grooves = far_groove && depth >= 2 * BITBEAM_GROOVE_IN + BITBEAM_GROOVE_H
        ? [BITBEAM_GROOVE_IN, depth - BITBEAM_GROOVE_IN]
        : [BITBEAM_GROOVE_IN];
    for (z = grooves)
        translate([0, 0, -z - BITBEAM_GROOVE_H / 2])
            linear_extrude(height = BITBEAM_GROOVE_H) bb_pinhole_outline(BITBEAM_GROOVE_D, teardrop);
}

// A circle, or with `teardrop` a circle with a 45° point that way.
module bb_pinhole_outline(d, teardrop) {
    if (is_undef(teardrop)) circle(d = d);
    else
        rotate(teardrop)
            hull() {
                circle(d = d);
                polygon([[0, d / 2 * sqrt(2)], [-d / 2 / sqrt(2), d / 2 / sqrt(2)], [d / 2 / sqrt(2), d / 2 / sqrt(2)]]);
            }
}
