// MultiConnect snap: an openGrid snap carrying a MultiConnect head, so
// Multiboard accessories — and anything the Holes tab has cut a
// MultiConnect slot into (lib/multiconnect.scad) — hang off an openGrid
// board. Functional face is BOTTOM: the snap goes into a board cell,
// head out; "mount" is on TOP, at the head's disc. Prints as it stands,
// snap on the bed; the disc's 45° underside needs no support.
//
// The snap body is openGrid-projects' base_snap() via lib/opengrid.scad
// (mitufy, CC-BY 4.0 — see README "Licensing"); the head is this repo's
// own mc_head(), from the published numbers (lib/constants.scad MC_*),
// which references.yaml checks against the head upstream's generator
// renders. The directional body is recentred for its deeper back nub
// exactly as in openconnect.scad, and body = "none" is the head alone
// for fusing onto another part on the Bench (disc as BOTTOM, pointing
// out; the neck's base as "mount"), as there, and body = "screw" the
// head on a male openGrid thread (lib/multiconnect.scad's mc_screw()),
// for a threaded snap or the Holes tab's thread, also as there.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../lib/opengrid.scad>
use <../../lib/multiconnect.scad>

module og_multiconnect(variant = "full", body = "directional",
                       anchor = BOTTOM, spin = 0, orient = UP) {
    assert(variant == "full" || variant == "lite",
           "variant must be \"full\" or \"lite\"");
    assert(body == "directional" || body == "symmetric" || body == "none" || body == "screw",
           "body must be \"directional\", \"symmetric\", \"none\" or \"screw\"");

    if (body == "screw") {
        t = variant == "lite" ? OG_SNAP_H_LITE : OG_SNAP_H_FULL;
        size = [MC_HEAD_D, MC_HEAD_D, t + MC_HEAD_H];
        attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
            // Facets as the head-only body's, for the same reason.
            translate([0, 0, -size.z / 2]) mc_screw(t, $fn = 128);
            children();
        }
    } else if (body == "none") {
        size = [MC_HEAD_D, MC_HEAD_D, MC_HEAD_H];
        attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
            // A facet count divisible by four, so the disc's extent is
            // exactly MC_HEAD_D on both axes and the box anchors land on it.
            mc_head(anchor = CENTER, $fn = 128);
            children();
        }
    } else
        og_multiconnect_on_snap(variant, body, anchor, spin, orient) children();
}

module og_multiconnect_on_snap(variant, body, anchor, spin, orient) {
    t = variant == "lite" ? OG_SNAP_H_LITE : OG_SNAP_H_FULL;
    dir_extra = body == "directional" ? OG_SNAP_DIR_NUB - OG_SNAP_NUB : 0;
    size = [OG_SNAP_BODY + 2 * OG_SNAP_NUB, OG_SNAP_BODY + 2 * OG_SNAP_NUB + dir_extra, t + MC_HEAD_H];

    // keep_color skips BOSL2's colour layer around the shape (two module
    // levels; nothing an STL can see) and the transforms are builtins, not
    // BOSL2's (one level each, not two) — see lib/opengrid.scad on why
    // every level counts here.
    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)], keep_color = true) {
        translate([0, -dir_extra / 2, -size.z / 2]) {
            og_snap_body(t, body);
            // Neck down on the snap's top face, disc out (a half turn
            // about Y, as in openconnect.scad); the neck's excess sinks
            // a hundredth into the body so the union is one solid.
            translate([0, 0, t + MC_HEAD_H]) rotate([0, 180, 0])
                mc_head(excess = 0.01, anchor = BOTTOM, $fa = detail_fa(1), $fs = detail_fs(0.4));
        }
        children();
    }
}
