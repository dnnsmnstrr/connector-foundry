// BitBeam shaft: a round axle sized to spin freely inside a beam's
// hole (BITBEAM_HOLE_DIA, 4.8mm), for a wheel/gear/lever joint rather
// than a fixed grip — the opposite fit intent from bitbeam_pin. Nominal
// diameter is the published spec; the working diameter subtracts
// FIT_CLEARANCE, same as extrusion2020/tab.scad's round `shaft_r`
// (`EX_SLOT_OPEN / 2 - FIT_CLEARANCE`) — a rotating fit needs LESS
// material as the printer runs tighter, the opposite correction from
// bitbeam_pin's grip fit. Increase FIT_CLEARANCE for a freer spin,
// decrease for less play.
//
// Functional face is BOTTOM: chamfered at both ends so either can lead
// into a hole; prints standing up, no supports needed.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module bitbeam_shaft(dia = BITBEAM_SHAFT_DIA, len = BITBEAM_SHAFT_LEN,
                      anchor = BOTTOM, spin = 0, orient = UP) {
    d = dia - FIT_CLEARANCE;
    size = [d, d, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        cyl(d = d, h = len, chamfer = min(len, d) * 0.2, anchor = CENTER, $fn = max(24, $fn));
        children();
    }
}
