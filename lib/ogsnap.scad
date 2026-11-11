// The openGrid snap — the clip parts/opengrid/snap.scad is — as
// QuackWorks' openGridSnap() builds it (vendor/QuackWorks, openGrid by
// David D, the OpenSCAD snap by metasyntactic), the same solid written
// flat.
//
// LICENSE: CC-BY-NC-SA 4.0, as the module this re-expresses. See
// parts/opengrid/board.scad's header and the README "Licensing" section.
//
// Why not just call openGridSnap(): depth. The browser's openscad-wasm
// build runs out of stack 70 nested module levels down (see
// web/README.md, "Known limit — nesting depth"), and upstream's snap is
// 68 deep on its own: its click holes are rounded BOSL2 cuboids (a
// hull() of corner cylinders, each an attachable of its own) inside
// zrot_copies() inside the snap's attachable. It rendered alone and
// trapped attached to anything — a Bench attach() costs 13 levels, so
// a snap on a Gridfinity bin base stood at 81.
//
// Here every solid is a polyhedron() or a linear_extrude() with its
// placement already in its points or in one multmatrix(), so the
// deepest module is three levels below og_snap_solid(). The shapes are
// still BOSL2's — wedge(), prismoid(), cube(), cylinder() and rect() in
// their function forms, which return the points the modules upstream
// calls would have built — and the numbers are upstream's, in
// upstream's order, so a change there is a change to one line here.
// references.yaml holds each of the four variants to upstream's own
// render (opengrid/snap-vs-quackworks-*), so a drift fails
// `make verify`.
include <../vendor/BOSL2/std.scad>

_OGS_W        = 24.80; // the body across, upstream's `w`
_OGS_FULLDIFF = 3.4;   // what a full snap has over a lite one, in z
_OGS_EPS      = 0.01;  // upstream's overlap between stacked solids

// One of upstream's four zrot_copies() places: its $idx, a quarter turn
// each.
function _ogs_turn(i) = zrot(90 * i);

// A solid from BOSL2's function form of a shape (a VNF), placed by `m`.
module _ogs_vnf(m, vnf) {
    placed = apply(m, vnf);
    polyhedron(placed[0], placed[1], convexity = 4);
}

// A prism: `path` from z = 0 up to `h`, placed by `m`.
module _ogs_prism(m, path, h) {
    multmatrix(m) linear_extrude(height = h) polygon(path);
}

// Upstream's cuboid(..., rounding = r, edges = "Z", $fn = 2): at two
// "sides" BOSL2 rounds a corner with one straight segment, so it is a
// square with its corners cut off.
function _ogs_octagon(r) = rect([_OGS_W, _OGS_W], chamfer = r);

// Upstream's click hole outline, cuboid([0.6, 12.4, h], rounding = 0.3,
// $fn = 100, edges = "Z"): a slot with round ends.
function _ogs_slot() = rect([0.6, 12.4], rounding = 0.3, $fn = 100);

// Upstream's openGridSnapNub(): a wing on the +X side, a box with a
// wedge off its top and one off its bottom, cut to the round of an
// ellipse standing in the body. The ellipse is upstream's
// yscale(r_s) cyl($fn = 600), which comes down to OpenSCAD's own
// cylinder: BOSL2's cylinder() function returns that mesh. Not a
// linear_extrude() of the same 600 points — the front directional
// nub's lower wedge starts on the ellipse's bottom face (both z = 0),
// and with the extruded mesh Manifold left the wedge's bottom there as
// a skin of no thickness (6.7 mm² of surface upstream's render does
// not have; same volume).
module _ogs_nub(m, nub_h, nub_w, nub_d, b_y, top_wedge_h, bot_wedge_h, r_x, r_r, r_s) {
    at = m * move([_OGS_W / 2 - _OGS_EPS, 0, 0]);
    intersection() {
        difference() {
            // bounding box - add 0.01 to height for overlap with core
            _ogs_vnf(at * move([0, 0, nub_h - _OGS_EPS]),
                     cube([nub_d, nub_w, 2 - nub_h + _OGS_EPS], anchor = CENTER + LEFT + BOTTOM));
            // top part
            _ogs_vnf(at * move([0, 0, 2]) * rot([0, 180, 90]),
                     wedge([nub_w, nub_d, top_wedge_h], anchor = CENTER + BOTTOM + BACK));
            // bottom part
            _ogs_vnf(at * move([0, 0, nub_h]) * rot([0, 0, 90]) * move([0, b_y, 0]),
                     wedge([nub_w, 0.4, bot_wedge_h], anchor = CENTER + BOTTOM + BACK));
        }
        // rounding - add 0.01 to height for overlap
        _ogs_vnf(at * move([r_x, 0, 0]) * yscale(r_s), cylinder(r = r_r, h = 2 + _OGS_EPS, $fn = 600));
    }
}

// `lite`: half height (3.4 mm) instead of a full tile's 6.8.
// `directional`: the snap for a wall-mounted board, its deeper nub on
// +X. Bottom on z = 0, centred on the 24.8 mm body in x and y; the nubs
// stand proud of it.
module og_snap_solid(lite = false, directional = false) {
    w = _OGS_W;
    h = lite ? 3.4 : _OGS_FULLDIFF * 2;
    core = 3 + (lite ? 0 : _OGS_FULLDIFF);
    lift = move([0, 0, lite ? 0 : _OGS_FULLDIFF]);
    top_h = 0.4;
    top_nub_h = 1.1;
    difference() {
        union() {
            // top
            _ogs_prism(move([0, 0, h - top_h - _OGS_EPS]), _ogs_octagon(3.262743), top_h + _OGS_EPS);
            // core
            _ogs_prism(ident(4), _ogs_octagon(4.81837), core);
            // top nub
            offs = 2.02;
            intersection() {
                _ogs_prism(move([0, 0, core - top_nub_h - _OGS_EPS]), _ogs_octagon(3.262743),
                           top_nub_h + _OGS_EPS);
                for (i = [0 : 3])
                    _ogs_vnf(_ogs_turn(i) * move([w / 2 - offs, w / 2 - offs, core]) * rot([180, 0, 135]),
                             wedge(size = [6.817, top_nub_h, top_nub_h], anchor = CENTER + BOTTOM));
            }
            // bottom nub
            for (i = [0 : 3])
                if (!directional || i == 1 || i == 3)
                    _ogs_nub(lift * _ogs_turn(i), nub_h = 0.2, nub_w = 11, nub_d = 0.4,
                             top_wedge_h = 0.6, bot_wedge_h = 0.6,
                             r_x = -12.36, r_s = 1.36, r_r = 13.025, b_y = -0);
            // directional nubs
            if (directional) {
                // front directional nub
                _ogs_nub(lift, nub_h = 0, nub_w = 14, nub_d = 0.8,
                         top_wedge_h = 1.0, bot_wedge_h = 0.4,
                         r_x = -11.75, r_s = 1.26, r_r = 13.025, b_y = -0.4);
                // rear directional nub
                _ogs_nub(zrot(180) * lift, nub_h = 0.65, nub_w = 10.8, nub_d = 0.4,
                         top_wedge_h = 0.6, bot_wedge_h = 0.6,
                         r_x = -12.41, r_s = 1.37, r_r = 13.025, b_y = 0);
            }
        }
        // bottom click holes
        for (i = [0 : 3])
            if (!directional || i == 1 || i == 3)
                _ogs_prism(_ogs_turn(i) * move([w / 2 - 1, 0, 0]), _ogs_slot(),
                           lite ? 1.5 : 2.8 + _OGS_FULLDIFF);
        // bottom click holes for rear directional
        if (directional) {
            _ogs_prism(zrot(180) * move([w / 2 - 1, 0, 0.599]), _ogs_slot(),
                       lite ? 0.9 : 2.2 + _OGS_FULLDIFF);
            _ogs_vnf(zrot(180) * move([w / 2 - 1.2, 0, 0]),
                     prismoid(size1 = [0.6, 12.4], size2 = [0.6, 12.4], h = 0.6, shift = [0.2, 0],
                              rounding = 0.3, $fn = 100));
            _ogs_vnf(zrot(180) * move([w / 2 - 0.1, 0, 0]),
                     prismoid(size1 = [0.2, 20], size2 = [0, 20], shift = [0.1, 0], h = 0.6,
                              anchor = BOTTOM));
        }

        // bottom wall click holes
        for (i = [0 : 3])
            if (!directional || i > 0)
                _ogs_vnf(_ogs_turn(i) * move([w / 2, 0, 2.2 + (lite ? 0 : _OGS_FULLDIFF)]),
                         cube([1.4, 12, 0.4], anchor = BOTTOM));

        // directional indicator: upstream's cylinder($fn = 2), which is
        // a three-sided one, a corner pointing the way the snap goes in.
        if (directional)
            _ogs_vnf(move([9.5, 0, 0]), cylinder(r1 = 2, r2 = 1.5, h = 0.4, $fn = 2));
    }
}
