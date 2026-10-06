// The openGrid snap body the connector parts sit on — the snap that
// openGrid-projects' generator (mitufy, CC-BY 4.0, vendored as
// vendor/opengrid-projects) puts an openConnect or MultiConnect head
// on. Its features (the corner lugs, the wing nubs, the flex cuts) are
// upstream's own modules from opengrid_snap_lib.scad, called here as
// upstream's base_snap() calls them; parts/opengrid/openconnect.scad
// and multiconnect.scad call this and set the head on top themselves.
//
// Why not just call base_snap(): depth. The browser's openscad-wasm
// build runs out of stack 70 nested module levels down (measured in
// Chrome and in Node alike: 69 renders, 70 traps), and upstream's snap
// reaches 69 at its deepest BOSL2 attachable — one more level of
// anything around base_snap() (a translate, a parent attachable, a
// Bench attach()) traps it (see web/README.md, "Known limits"). Two
// things here buy the room a catalogue part needs:
//
//  - base_snap() spends 14 levels on its own attachable()/tag_scope()
//    envelope, which the part supplies itself anyway. Its body is
//    written out here instead — one diff(), one cuboid, the feature
//    calls — the same geometry, shallower.
//  - its uninstall notch, three cuboids chained through attach(), is
//    the deepest feature of all (61 levels where the flex cuts reach
//    55). og_snap_notch() below is the same two boxes placed by
//    arithmetic in the body's own frame.
//
// references.yaml holds the result to upstream's own render, so a
// drift in either rewrite fails `make verify`. Upstream's snap also
// carries a debossed text label (a thickness and a direction arrow,
// in fonts the WASM build does not ship); it is left off. $fa/$fs are
// upstream's generator defaults, so a render here matches a render
// there to the facet.
include <../vendor/BOSL2/std.scad>
include <constants.scad>
use <../vendor/opengrid-projects/lib/opengrid_snap_lib.scad>

// `thickness`: 6.8 (a full tile) or 3.4 (the half-height "lite" snap).
// `body`: "directional" — the shape for a wall-mounted board, with the
// deeper nub and bottom corners that take the load on its back (+Y) —
// or "symmetric" for a horizontal board. Bottom on z = 0, centred on
// the 24.8 mm body; the nubs stand proud of it (see OG_SNAP_NUB).
module og_snap_body(thickness = 6.8, body = "directional", $fa = detail_fa(1), $fs = detail_fs(0.4)) {
    assert(body == "directional" || body == "symmetric",
           "body must be \"directional\" or \"symmetric\"");
    cfg = snap_body_cfg(snap_thickness = thickness,
                        snap_body_shape = body == "directional" ? "Directional" : "Symmetric");
    // base_snap()'s body, verbatim but for the text and the notch. The
    // notch replaces the front side cut (base_snap() disables that cut
    // exactly when the notch is on). The cuboid stays centred, as
    // upstream's is, and the whole thing is lifted onto z = 0 instead:
    // anchoring the cuboid BOTTOM shifts where its corner attachments
    // land, and the directional corner slants then miss the chamfer by
    // a sliver (measured: 0.55 mm off on the front-left corner).
    translate([0, 0, thickness / 2]) tag_scope() diff()
        cuboid([OG_SNAP_BODY, OG_SNAP_BODY, thickness], chamfer = OG_SNAP_CHAMFER, edges = "Z") {
            snap_corner(snapbody_cfg = cfg);
            snap_nub(snapbody_cfg = cfg);
            snap_cut(snapbody_cfg = cfg, snapcut_cfg = ["disable_front_side_cut", true]);
            og_snap_notch(thickness);
        }
}

// Upstream's snap_uninstall_notch() as base_snap() places it, written
// as two boxes: a groove across the top front edge (where a tool goes
// in to lever the snap out), and under it a slit that runs 1.8 mm into
// the body and 1.8 mm out through the front nub. Its numbers are
// snap_notch_cfg()'s defaults; a half-height snap gets the lite pair.
// Positioned in the frame a cuboid's attached children see — the body
// centred on the origin — including upstream's EPS overshoots, so the
// solid is the same to the last facet.
module og_snap_notch(thickness) {
    lite = thickness < 6.8;
    w = 5;
    surface_inset = 1;
    gap_inset = 1.8;
    surface_h = lite ? 0.8 : 1.2;
    gap_h = lite ? 0.6 : 1;
    eps = 0.005;
    top = thickness / 2;
    front = -OG_SNAP_BODY / 2;
    tag("remove") {
        translate([-w / 2, front, top - surface_h + eps])
            cube([w, surface_inset, surface_h]);
        translate([-w / 2, front - gap_inset, top - surface_h - gap_h + 2 * eps])
            cube([w, 2 * gap_inset, gap_h]);
    }
}
