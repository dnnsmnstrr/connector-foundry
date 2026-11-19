// The openGrid snap body the connector parts sit on — the snap that
// openGrid-projects' generator (mitufy, CC-BY 4.0, vendored as
// vendor/opengrid-projects) puts an openConnect or MultiConnect head
// on: its base_snap(), with the corner lugs, the wing nubs, the flex
// cuts and the uninstall notch (opengrid_snap_lib.scad), the same solid
// written flat. parts/opengrid/openconnect.scad and multiconnect.scad
// call this and set the head on top themselves.
//
// Why not just call base_snap(): depth. The browser's openscad-wasm
// build runs out of stack 70 nested module levels down (see
// web/README.md, "Known limit — nesting depth"), and upstream's snap
// is about that deep on its own. An earlier version of this file kept
// upstream's feature modules and only dropped base_snap()'s envelope
// and its notch; that rendered (68 levels in a part) and no further:
// the flex cuts are rounded BOSL2 cuboids placed by attach() inside a
// diff(), 59 levels below the body's own call, the lugs 50, the nubs
// 47. A Bench attach() costs 13, so a connector with its snap body
// could not be attached to anything.
//
// Here every solid is a polyhedron() or a linear_extrude() placed by
// one matrix, at most seven module levels below og_snap_body() (a
// part is as deep as its head now: 48 for openConnect's, 28 for
// MultiConnect's). What upstream builds by attaching a child to a face
// of the body is built on that face directly: _ogb_face() is the frame
// attach() gives such a child, and each feature below names the
// upstream line it stands for, with upstream's numbers (its *_cfg()
// defaults, which the parts never change). The shapes are BOSL2's own
// — prismoid(), cube() and rect() in their function forms, and the
// section rounding_edge_mask() cuts for the fillets — so the solid is
// upstream's to the facet.
//
// references.yaml holds the parts to upstream's own generator render,
// so a drift here fails `make verify`. Upstream's snap also carries a
// debossed text label (a thickness and a direction arrow, in fonts the
// WASM build does not ship); it is left off.
include <../vendor/BOSL2/std.scad>
include <constants.scad>

_OGB_EPS    = 0.005;              // upstream's EPS: how far a feature is sunk into the body
_OGB_CORNER = 2.7 + 1 / sqrt(2);  // OG_SNAP_CORNER_OUTER_DIAGONAL: the corner cut, along the diagonal
_OGB_CUT_W  = OG_SNAP_BODY - 2 * 6.2; // a flex cut's length: the body less cut_width_inset each end

// The frame of something built on a side of the body, as BOSL2's
// attach(side, BOTTOM) leaves a child: x along the side, y up the body
// (+z), z out of it. `a` is the side's direction in degrees (0 RIGHT,
// 90 BACK, 180 LEFT, 270 FRONT; the corner chamfers in between), `r`
// how far out from the body's axis, `z` how far up from its middle.
function _ogb_face(a, r, z) = zrot(a) * move([r, 0, z]) * frame_map(y = UP, z = RIGHT);

// A solid from BOSL2's function form of a shape (a VNF), placed by `m`.
module _ogb_vnf(m, vnf) {
    placed = apply(m, vnf);
    polyhedron(placed[0], placed[1], convexity = 4);
}

// BOSL2's prismoid() given angles instead of a second size, as its
// module form asks its function form for one (the function alone
// defaults to a shift of [0, 0], which it then refuses beside an angle).
function _ogb_prismoid(size1, size2, xang, yang, h) =
    prismoid(size1 = size1, size2 = size2, shift = [undef, undef], xang = xang, yang = yang, h = h,
             anchor = BOTTOM);

// A prism: `path` extruded by `h` (from z = 0, or about it), placed by
// `m`.
module _ogb_prism(m, path, h, center = false) {
    multmatrix(m) linear_extrude(height = h, center = center) polygon(path);
}

// Upstream's directional slant: a wedge along side `a` of the body, its
// upright face `r` out from the axis, its foot on the body's underside
// and `depth` thick there, tapering to nothing `height` up — what
// attach(side, BACK, inside = true) makes of prismoid(size1 = [length,
// depth], size2 = [length, 0], shift = [0, depth / 2], h = height).
//
// `beyond` carries the upright face that much further out, the slope
// staying where it is (the wedge becomes a prismoid with a flat top):
// for a wedge whose upright face lies in a wall of something else. Two
// solids that only touch are left to Manifold's tie-break, which went
// the other way here than in upstream's render and kept the shared wall
// as a skin of no thickness; where the far side of the wall is void
// already (or solid already, for the wedge that is put back), a wedge
// reaching into it is the same solid with nothing to tie.
module _ogb_slant(a, r, depth, height, length, thickness, beyond = 0) {
    _ogb_vnf(zrot(a) * move([r + beyond, 0, -thickness / 2]) * frame_map(y = RIGHT, z = UP)
                 * move([0, -(depth + beyond) / 2, 0]),
             prismoid(size1 = [length, depth + beyond], size2 = [length, beyond], shift = [0, depth / 2],
                      h = height, anchor = BOTTOM));
}

// The section BOSL2's rounding_edge_mask(r = r, $fn = 64) cuts from an
// edge whose two faces meet at `ang` degrees: the corner at the origin,
// one face along +x, the other at `ang`, the arc between them, and the
// 0.01 the mask stands proud of both faces. Its points are that
// module's own (its make_path(), cp and the two shifted ends).
function _ogb_fillet(r, ang) =
    let(excess = 0.01,
        steps = max(2, segs(r, 180 - ang, $fn = 64)),
        curve = arc(n = steps + 1, r = r, corner = [polar_to_xy(r, ang), [0, 0], [r, 0]]))
    [curve[0] + polar_to_xy(excess, 90 + ang),
     [-excess / tan(ang / 2), -excess],
     last(curve) - [0, excess],
     each reverse(curve)];

// Upstream's edge_mask([TOP + LEFT, TOP + RIGHT])
// rounding_edge_mask(l = length, r = r) on a prismoid in frame `m`: the
// two edges where its top (`top_w` wide, `h` up) meets its sloping
// ends, each `inset` in from the foot, rounded. The fillet's first
// face lies along the top, pointing in from the edge; frame_map() turns
// the section into the plane across the edge.
module _ogb_fillets(m, top_w, inset, h, r, length) {
    section = _ogb_fillet(r, 180 - atan2(h, inset));
    _ogb_prism(m * move([top_w / 2, 0, h]) * frame_map(x = LEFT, y = DOWN), section, length, center = true);
    _ogb_prism(m * move([-top_w / 2, 0, h]) * frame_map(x = RIGHT, y = DOWN), section, length, center = true);
}

// `thickness`: 6.8 (a full tile) or 3.4 (the half-height "lite" snap).
// `body`: "directional" — the shape for a wall-mounted board, with the
// deeper nub and bottom corners that take the load on its back (+Y) —
// or "symmetric" for a horizontal board. Bottom on z = 0, centred on
// the 24.8 mm body; the nubs stand proud of it (see OG_SNAP_NUB).
//
// Upstream's diff() is the outline: what it adds less what it tags
// "remove", and then what it tags "keep" put back.
module og_snap_body(thickness = 6.8, body = "directional") {
    assert(body == "directional" || body == "symmetric",
           "body must be \"directional\" or \"symmetric\"");
    directional = body == "directional";
    full = thickness >= 6.8;
    // The body is centred on the origin, as upstream's cuboid is, and
    // lifted onto z = 0 by every placement.
    lift = move([0, 0, thickness / 2]);
    // snap_cut()'s directional slant: its height and depth.
    slant_h = full ? 3.4 : 1.2;
    slant_d = full ? 0.8 : 0.2;
    multmatrix(lift) union() {
        difference() {
            union() {
                // cuboid([w, w, thickness], chamfer = OG_SNAP_CORNER_CHAMFER, edges = "Z")
                _ogb_prism(move([0, 0, -thickness / 2]),
                           rect([OG_SNAP_BODY, OG_SNAP_BODY], chamfer = OG_SNAP_CHAMFER), thickness);
                _ogb_corners(thickness, directional && full);
                _ogb_nubs(thickness, directional);
            }
            // One solid to take away, as diff() makes one of everything
            // tagged "remove".
            union() {
                _ogb_cuts(thickness, directional, slant_h, slant_d);
                _ogb_notch(thickness);
            }
        }
        // snap_cut()'s tag_diff("keep", "inner_remove"): the strip
        // between the front flex cut and the slant under the front
        // face, which the slants above would otherwise take with them.
        // It stands in the flex cut against the cut's outer wall and
        // its two ends, so it reaches 0.1 mm into each: all three are
        // solid behind (the slant under the front face is cut out of it
        // here as it is out of them).
        if (directional)
            difference() {
                _ogb_slant(270, OG_SNAP_BODY / 2 - 0.7, slant_d, slant_h, _OGB_CUT_W + 0.2, thickness,
                           beyond = 0.1);
                _ogb_slant(270, OG_SNAP_BODY / 2, slant_d, slant_h, OG_SNAP_BODY, thickness);
            }
    }
}

// snap_corner(): a lug on each corner chamfer, flush with the top,
// 1.5 mm tall and 1.1 mm proud, sloped underneath; and on a full
// directional snap two more on the back corners, flush with the
// bottom, 0.6 mm proud with their ends rounded off.
module _ogb_corners(thickness, bottom_corners) {
    edge_h = 1.5;                              // snap_corner_edge_height
    width = OG_SNAP_CHAMFER * sqrt(2);         // the chamfer face, across
    out = OG_SNAP_BODY / sqrt(2) - _OGB_CORNER - _OGB_EPS; // attach(shiftout = -...DIAGONAL - EPS)
    for (a = [225, 315, 135, 45])
        _ogb_vnf(_ogb_face(a, out, thickness / 2 - edge_h / 2),
                 _ogb_prismoid(size1 = [width, edge_h], xang = 45, yang = [45, 90], h = 1.1));
    if (bottom_corners) {
        proud = 0.6;                           // snap_body_bottom_corner_extrude
        for (a = [135, 45]) {
            m = _ogb_face(a, out, -(thickness / 2 - edge_h / 2));
            difference() {
                _ogb_vnf(m, _ogb_prismoid(size1 = [width, edge_h], xang = 45, yang = [90, 45], h = proud));
                // xang = 45: the top is `proud` in from the foot at each end.
                _ogb_fillets(m, width - 2 * proud, proud, proud, r = 1.5, length = 6.8);
            }
        }
    }
}

// snap_nub(): a wing on each side, 1.4 mm below the top, its ends
// rounded off. A directional body's back (+Y) wing is the deep one that
// carries the load, and its front one is shorter.
module _ogb_nubs(thickness, directional) {
    full = thickness >= 6.8;
    difference() {
        union() {
            for (a = [270, 180, 0, 90]) {
                deep = directional && a == 90;
                inset_w = deep ? 5 : 7;                    // *_nub_width_inset
                nub_h = deep ? (full ? 4 : 2.4)            // directional_nub_height_*
                      : directional && a == 270 ? (full ? 2 : 1.4) // antidirect_nub_height_*
                      : (full ? 2 : 1.8);                  // basic_nub_height_*
                taper = deep ? 1.6 : 4;                    // *_nub_width_tip_taper
                yang = [35, deep && !full ? 45 : 35];      // [*_nub_top_angle, *_nub_bottom_angle]
                depth = deep ? 0.8 : 0.4;                  // *_nub_depth
                width = OG_SNAP_BODY - 2 * inset_w;
                // attach(side, BOTTOM, align = TOP, inset = nub_offset_to_top,
                // shiftout = -EPS): EPS into the side, and EPS further down.
                m = _ogb_face(a, OG_SNAP_BODY / 2 - _OGB_EPS, thickness / 2 - 1.4 - _OGB_EPS - nub_h / 2);
                difference() {
                    _ogb_vnf(m, _ogb_prismoid(size1 = [width, nub_h], size2 = [width - taper, undef],
                                              yang = yang, h = depth));
                    _ogb_fillets(m, width - taper, taper / 2, depth, r = deep ? 2.8 : 15, length = 8);
                }
            }
        }
        // attach(BOTTOM, TOP) cuboid([2 w, 2 w, 2 thickness]): nothing
        // of a wing below the body's underside (a lite body's deep wing
        // would reach 0.4 mm past it).
        _ogb_vnf(move([0, 0, -1.5 * thickness]),
                 cube([2 * OG_SNAP_BODY, 2 * OG_SNAP_BODY, 2 * thickness], center = true));
    }
}

// snap_cut(), as base_snap() calls it with its uninstall notch on (no
// side cut at the front): what makes the sides springs.
module _ogb_cuts(thickness, directional, slant_h, slant_d) {
    half = OG_SNAP_BODY / 2;
    for (a = [270, 180, 0, 90]) {
        // The bottom cut: a slot 0.6 mm wide, 0.7 mm in from the side,
        // from below up to 0.6 mm under the top. Round ends, but for a
        // directional body's front one, and it has none at the back.
        if (!(directional && a == 90))
            _ogb_prism(zrot(a) * move([half - 0.7 - 0.3, 0, -thickness / 2 - 0.6]),
                       rect([0.6, _OGB_CUT_W], rounding = directional && a == 270 ? 0 : 0.3, $fn = 64),
                       thickness);
        // The side cut: a groove 0.8 mm into the side, 0.4 mm tall,
        // 0.8 mm under the top.
        if (a != 270)
            _ogb_vnf(zrot(a) * move([half - 0.4, 0, thickness / 2 - 0.8 - 0.2]),
                     cube([0.8, _OGB_CUT_W, 0.4], center = true));
    }
    if (directional) {
        // tag_diff("remove", "inner_remove"): the front bottom cut
        // widened towards the underside, as far as the slant behind it.
        // Its upright face is the cut's inner wall, so it reaches
        // 0.3 mm into the cut, which is void from below to well above
        // it.
        difference() {
            _ogb_slant(270, half - 0.7 - 0.6, slant_d, slant_h, _OGB_CUT_W, thickness, beyond = 0.3);
            _ogb_slant(270, half - 0.7, slant_d, slant_h, _OGB_CUT_W, thickness);
        }
        // The slant under the front face and under the two front
        // corner chamfers, which lets the snap tilt into a wall board.
        for (a = [225, 315])
            _ogb_slant(a, OG_SNAP_BODY / sqrt(2) - _OGB_CORNER, slant_d / sqrt(2), slant_h, OG_SNAP_BODY,
                       thickness);
        _ogb_slant(270, half, slant_d, slant_h, OG_SNAP_BODY, thickness);
    }
}

// Upstream's snap_uninstall_notch() as base_snap() places it: a groove
// across the top front edge (where a tool goes in to lever the snap
// out), and under it a slit that runs 1.8 mm into the body and 1.8 mm
// out through the front nub. Its numbers are snap_notch_cfg()'s
// defaults; a half-height snap gets the lite pair. Upstream chains
// three cuboids through attach(); these are the same two boxes, with
// its EPS overshoots, in the body's own frame. (Its shiftout = EPS
// moves the groove EPS out through the front as well as up, which the
// first version of this missed: 0.015 mm³ of the web over the front
// flex cut.)
module _ogb_notch(thickness) {
    lite = thickness < 6.8;
    w = 5;
    surface_inset = 1;
    gap_inset = 1.8;
    surface_h = lite ? 0.8 : 1.2;
    gap_h = lite ? 0.6 : 1;
    top = thickness / 2;
    front = -OG_SNAP_BODY / 2;
    _ogb_vnf(move([-w / 2, front - _OGB_EPS, top - surface_h + _OGB_EPS]), cube([w, surface_inset, surface_h]));
    _ogb_vnf(move([-w / 2, front - gap_inset, top - surface_h - gap_h + 2 * _OGB_EPS]),
             cube([w, 2 * gap_inset, gap_h]));
}
