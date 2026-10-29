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
// layout = "folded" lays any of these out to print on its side, as
// openGrid-projects' "openConnect (Folded)" snap and screw do: cut
// across just in front of the head, the head's half on its cut face and
// the rest of the body beside it, joined by a one-layer hinge, to fold
// up after printing (lib/fold.scad). A head printed standing has its
// layers across the neck, where a hanging load pulls them apart; on its
// side they run along it. "split" is the same with the halves apart, to
// glue. A folded screw's head keeps its flat front edge (upstream's: see
// oc_screw()'s `folded`), and the head alone has nothing in front of
// the cut, so for it either one is the head lying on that edge. These
// are for printing the part on its own: they are print layouts, centred
// on their own box like the rest, and nothing attached to one would
// land anywhere useful. The Bench folds a whole assembly instead
// (web/src/lib/benchFold.js).
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
use <../../lib/fold.scad>

module og_openconnect(variant = "full", body = "directional", layout = "upright",
                      anchor = BOTTOM, spin = 0, orient = UP) {
    assert(variant == "full" || variant == "lite",
           "variant must be \"full\" or \"lite\"");
    assert(body == "directional" || body == "symmetric" || body == "none" || body == "screw",
           "body must be \"directional\", \"symmetric\", \"none\" or \"screw\"");
    assert(layout == "upright" || layout == "folded" || layout == "split",
           "layout must be \"upright\", \"folded\" or \"split\"");

    if (layout != "upright")
        og_openconnect_laid_out(variant, body, layout == "split", anchor, spin, orient) children();
    else if (body == "screw") {
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

// Where og_openconnect_laid_out() cuts: just in front of the head's flat
// front edge (its pocket runs from OC_HEAD_SHIFT_Y - OC_HEAD_L / 2 up),
// in the frame the part stands in before it is centred — the cell
// centre on the origin, the snap's (or the thread tip's) end on z = 0.
// It is upstream's fold_position, OCHEAD_MIDDLE_TO_BOTTOM + EPS, from
// the other side. The Bench's fold table (web/src/lib/benchFold.js) holds
// the same cut in each body's centred frame.
function og_openconnect_fold_y() = OC_HEAD_SHIFT_Y - OC_HEAD_L / 2 - FOLD_EPS;

// The part in that standing frame, laid out by fold_print(). Its box is
// worked out from what each half holds: the head's half (A) is as tall
// on the bed's Y as the part stood, the other half (B: snap or thread
// only — the head is all in A) as tall as the snap or thread, `gap` off
// the other way, and on Z each half is as deep as the part reached past
// the cut on its side.
module og_openconnect_laid_out(variant, body, split, anchor, spin, orient) {
    t = variant == "lite" ? OG_SNAP_H_LITE : OG_SNAP_H_FULL;
    cut = og_openconnect_fold_y();
    snap = body == "directional" || body == "symmetric";
    dir_extra = body == "directional" ? OG_SNAP_DIR_NUB - OG_SNAP_NUB : 0;
    half_w = snap ? OG_SNAP_BODY / 2 + OG_SNAP_NUB : OC_HEAD_W / 2;
    // The standing part's extent on Y, and how tall each half stands.
    y0 = snap ? -(OG_SNAP_BODY / 2 + OG_SNAP_NUB) : body == "screw" ? -OG_THREAD_D / 2 : cut;
    y1 = snap ? OG_SNAP_BODY / 2 + OG_SNAP_NUB + dir_extra : OC_HEAD_SHIFT_Y + OC_HEAD_L / 2;
    h_a = body == "none" ? OC_HEAD_H : t + OC_HEAD_H;
    // The screw's thread stands its sink (oc_screw()'s 0.005) taller.
    h_b = snap ? t : body == "screw" ? t + 0.005 : 0;
    sliceoff = body == "screw" ? FOLD_GAP / 2 : 0;
    // B's offset from the hinge: fold_print()'s, and the first-layer
    // fill below reaches FOLD_GAP + t on a folded snap.
    b_off = split ? FOLD_SPLIT_GAP : FOLD_GAP - FOLD_EPS;
    y_min = h_b == 0 ? 0 : snap && !split ? -(FOLD_GAP + t) : -(b_off + h_b);
    // The head alone isn't cut at all (the cut runs FOLD_EPS in front of
    // it), so it stands that far off the bed's z = 0, and with nothing
    // on the other side there's nothing for a hinge to join.
    z_lo = body == "none" ? FOLD_EPS : 0;
    size = [2 * half_w, h_a - y_min, max(y1 - cut, cut - sliceoff - y0) - z_lo];
    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, -(y_min + h_a) / 2, -size.z / 2 - z_lo]) {
            fold_print(cut, split = split || body == "none", sliceoff = sliceoff)
                og_openconnect_standing(t, body);
            // Upstream's folded snap fills its body's side cuts on the
            // first layer, across both halves and the hinge, so each
            // half starts on a whole layer; a split one gets the same
            // fill on each half alone.
            if (snap) {
                if (split) {
                    translate([-OG_SNAP_BODY / 2, 0, 0]) cube([OG_SNAP_BODY, t, FOLD_HINGE_H]);
                    translate([-OG_SNAP_BODY / 2, -FOLD_SPLIT_GAP - t, 0]) cube([OG_SNAP_BODY, t, FOLD_HINGE_H]);
                } else
                    translate([-OG_SNAP_BODY / 2, -FOLD_GAP - t, 0]) cube([OG_SNAP_BODY, 2 * t + FOLD_GAP, FOLD_HINGE_H]);
            }
        }
        children();
    }
}

// The part standing in og_openconnect_fold_y()'s frame, uncentred.
module og_openconnect_standing(t, body) {
    if (body == "screw")
        oc_screw(t, folded = true, $fa = detail_fa(1), $fs = detail_fs(0.4));
    else if (body == "none")
        translate([0, 0, OC_HEAD_H]) rotate([0, 180, 0])
            oc_head(anchor = BOTTOM, $fa = detail_fa(1), $fs = detail_fs(0.4));
    else {
        og_snap_body(t, body);
        translate([0, 0, t + OC_HEAD_H]) rotate([0, 180, 0])
            oc_head(excess = 0.01, anchor = BOTTOM, $fa = detail_fa(1), $fs = detail_fs(0.4));
    }
}
