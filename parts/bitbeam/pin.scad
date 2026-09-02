// BitBeam friction pin: a round peg sized to grip a beam's hole
// (BITBEAM_HOLE_DIA, 4.8mm) by interference — the standard way two
// beams join without an M4 screw. Nominal diameter is the published
// spec; the working diameter adds FIT_CLEARANCE, same as the barbed
// snap peg in lib/joints.scad (`JOINT_PEG_BARB_R + FIT_CLEARANCE`) —
// how oversized a friction peg needs to be to actually grip is
// filament- and printer-dependent (BitBeam's own docs say the same),
// so it's not a number to bake in here. Increase FIT_CLEARANCE for
// more grip, decrease (even negative) for an easier push.
//
// BitBeam's own docs describe a forked-tip pin variant for a firmer
// grip; this is a plain round peg — there's no published drawing of
// the fork to build from, and guessing at unpublished geometry is
// exactly what got the old DeckMate dovetail moved out of that system
// (see parts/basics/dovetail_rail.scad).
//
// Functional face is BOTTOM: chamfered at both ends so either can lead
// into a hole; prints standing up, no supports needed.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module bitbeam_pin(dia = BITBEAM_PIN_DIA, len = BITBEAM_PIN_LEN,
                    anchor = BOTTOM, spin = 0, orient = UP) {
    d = dia + FIT_CLEARANCE;
    size = [d, d, len];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        cyl(d = d, h = len, chamfer = min(len, d) * 0.2, anchor = CENTER, $fn = max(24, $fn));
        children();
    }
}
