// openConnect snap: an openGrid snap carrying the openConnect head, so
// anything with an openConnect slot (the Holes tab cuts one — see
// lib/openconnect.scad) hangs off a board. Functional face is BOTTOM:
// the snap goes into a board cell, head out; "mount" is on TOP, at the
// head. Prints as it stands — snap on the bed, head up; the head's 45°
// taper needs no support.
//
// body = "none" is the head alone, for fusing onto another part on the
// Bench (the catalogue makes it the default there — see
// `attached_defaults`): pocket face as BOTTOM, pointing out, the neck's
// base as "mount" on TOP, to sit on the host. The head is not centred
// in the snap's frame (its pocket runs OC_HEAD_SHIFT_Y up from the cell
// centre); on its own it is centred on its own box, so a slot marker
// lands on the head's middle.
//
// body = "screw" is the head on a male openGrid thread instead of a
// snap (upstream's openconnect_screw()): it screws into a threaded
// openGrid snap — or into the thread the Holes tab cuts — and, screwed
// home, its head points the way a snap's would. Thread as BOTTOM, tip
// on the bed, head up, as it prints; variant picks the thread length
// (the snap thickness it is for). Centred on its own box, as the head
// alone is, with "mount" on TOP at the pocket face.
//
// A thin wrapper: the snap body is openGrid-projects' base_snap() via
// lib/opengrid.scad, the head its openconnect_head() via
// lib/openconnect.scad (mitufy, CC-BY 4.0 — attribution required, no
// other restriction; see README "Licensing"). What this file adds is
// the envelope and the anchor.
//
// Upstream's directional body has a deeper nub on its back (+Y) than
// on its other three sides, so its real extent is OG_SNAP_DIR_NUB -
// OG_SNAP_NUB longer on +Y only; the body is recentred here or every
// anchor on this part would be half that off (same situation as
// snap.scad's directional variant, on the other axis).
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../lib/opengrid.scad>
use <../../lib/openconnect.scad>

module og_openconnect(variant = "full", body = "directional",
                      anchor = BOTTOM, spin = 0, orient = UP) {
    assert(variant == "full" || variant == "lite",
           "variant must be \"full\" or \"lite\"");
    assert(body == "directional" || body == "symmetric" || body == "none" || body == "screw",
           "body must be \"directional\", \"symmetric\", \"none\" or \"screw\"");

    if (body == "screw") {
        t = variant == "lite" ? OG_SNAP_H_LITE : OG_SNAP_H_FULL;
        // Centred on its own box, as the head alone is: the thread's
        // axis (the cell centre) is not its middle, since the head's
        // pocket reaches OC_HEAD_SHIFT_Y + OC_HEAD_L / 2 up from it and
        // the thread only OG_THREAD_D / 2 down. The thread's tip sits
        // the hundredth upstream sinks it into the neck above z = 0.
        y_min = -OG_THREAD_D / 2;
        y_max = OC_HEAD_SHIFT_Y + OC_HEAD_L / 2;
        sink = 0.005;
        size = [OC_HEAD_W, y_max - y_min, t + OC_HEAD_H - sink];
        attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
            translate([0, -(y_min + y_max) / 2, -size.z / 2 - sink])
                oc_screw(t, $fa = detail_fa(1), $fs = detail_fs(0.4));
            children();
        }
    } else if (body == "none") {
        size = [OC_HEAD_W, OC_HEAD_L, OC_HEAD_H];
        attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
            translate([0, -OC_HEAD_SHIFT_Y, -size.z / 2]) oc_head(anchor = BOTTOM, $fa = detail_fa(1), $fs = detail_fs(0.4));
            children();
        }
    } else
        og_openconnect_on_snap(variant, body, anchor, spin, orient) children();
}

module og_openconnect_on_snap(variant, body, anchor, spin, orient) {
    t = variant == "lite" ? OG_SNAP_H_LITE : OG_SNAP_H_FULL;
    dir_extra = body == "directional" ? OG_SNAP_DIR_NUB - OG_SNAP_NUB : 0;
    size = [OG_SNAP_BODY + 2 * OG_SNAP_NUB, OG_SNAP_BODY + 2 * OG_SNAP_NUB + dir_extra, t + OC_HEAD_H];

    // keep_color skips BOSL2's colour layer around the shape (two module
    // levels; nothing an STL can see) and the transforms are builtins, not
    // BOSL2's (one level each, not two) — see lib/opengrid.scad on why
    // every level counts here.
    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)], keep_color = true) {
        translate([0, -dir_extra / 2, -size.z / 2]) {
            og_snap_body(t, body);
            // The head turned over onto the snap's top face: neck down
            // on the snap, pocket face out — the pose upstream's
            // attach(TOP, TOP) gives, a half turn about Y, which keeps
            // +Y (the slide direction) where it is. The neck's excess
            // sinks a hundredth into the body so the union is one solid.
            translate([0, 0, t + OC_HEAD_H]) rotate([0, 180, 0])
                oc_head(excess = 0.01, anchor = BOTTOM, $fa = detail_fa(1), $fs = detail_fs(0.4));
        }
        children();
    }
}
