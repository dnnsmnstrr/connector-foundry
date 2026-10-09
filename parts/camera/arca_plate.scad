// Arca-Swiss-style quick-release plate: the dovetail a tripod head's
// Arca clamp closes on. Functional face is BOTTOM, the clamp face, which
// is also the print orientation (flat on the bed, flanks up); "mount" is
// on TOP, the face a camera, a lens foot or anything on the Bench sits
// on. "bot" is the clamp face.
//
// The profile is lib/camera.scad's arca_profile(), run along y for
// `length`, each side FIT_CLEARANCE narrower than nominal so it goes into
// a clamp printed or machined to size. With screw on, a 1/4"-20 camera
// screw goes up through it from the clamp face, its head sunk in a
// counterbore, as on a camera plate (a slot, so the camera can slide to
// balance). Fused onto a part, leave it off.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/camera.scad>

// A 1/4"-20 camera screw: clearance through the plate, and a counterbore
// for its head (D-ring and slotted camera screws' heads are about 11mm).
ARCA_SCREW_D      = 6.6;
ARCA_SCREW_HEAD_D = 12.5;
ARCA_SCREW_HEAD_H = 4;
ARCA_SCREW_SLOT   = 10;   // how far the screw can slide along the plate

module arca_plate(length = 50, thickness = 10, screw = false,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    assert(length >= 20, "length must be at least 20");
    assert(thickness > ARCA_EDGE_H + 1, str("thickness must be over ", ARCA_EDGE_H + 1));
    assert(!screw || thickness >= ARCA_SCREW_HEAD_H + 3, "a screw needs a plate at least 7mm thick");
    size = [ARCA_WIDTH - 2 * FIT_CLEARANCE, length, thickness];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) difference() {
            // The profile in the xz plane, run along y.
            rotate([90, 0, 0]) linear_extrude(length, center = true)
                polygon(arca_profile(thickness, FIT_CLEARANCE));
            if (screw) {
                slot = min(ARCA_SCREW_SLOT, length - ARCA_SCREW_HEAD_D - 4);
                for (part = [[ARCA_SCREW_D, -1, thickness + 2], [ARCA_SCREW_HEAD_D, -1, ARCA_SCREW_HEAD_H + 1]])
                    translate([0, 0, part[1]]) linear_extrude(part[2])
                        hull() for (y = [-slot / 2, slot / 2]) translate([0, y]) circle(d = part[0], $fn = 48);
            }
        }
        children();
    }
}
