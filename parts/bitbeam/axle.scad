// BitBeam axle — a LEGO Technic axle (parts 3704/3705/3706/... by
// length), the cross-section shaft that turns freely in a beam's round
// hole and locks in a gear's or wheel's axle hole. It is technic_axle()
// from vendor/technic.scad (cfinke, MIT), built from that file's own
// dimensions, so the axle keeps Technic's 7.8mm unit and 4.85mm cross
// and matches its square drive holes. Nothing here is overridden from
// lib/constants.scad. The former "shaft" here was a plain chamfered
// cylinder, which turns in a hole but drives nothing.
//
// Not called directly, for the browser's sake. Upstream rounds each
// blade of the cross with minkowski() and a sphere, which OpenSCAD's
// Manifold backend does by hulling with CGAL, and in openscad-wasm
// 0.0.4 that hull asserts on some inputs (parts/basics/plate.scad met
// the same one). The render then falls back to Nef: 3.7s for an axle
// instead of 0.5s, at lengths that follow the heap's layout rather than
// the geometry (2, 4, 6 and 11 of 1..12 when measured; others once a
// comment in this file had moved). A native OpenSCAD never falls back,
// so no test here can catch it. _bitbeam_axle_blade() below is the same
// solid as a polyhedron, with no hull in it.
//
// `length` is in Technic units (7.8mm), so 4 is LEGO's 3705.
// Functional face is BOTTOM; "mount" on TOP. Prints standing up.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../vendor/technic.scad/Technic.scad>

// Technic.scad sets $fa = 1, $fs = 0.05 at its top level, which would
// stand for every part of a Bench assembly that includes this file:
// reset them (lib/constants.scad, at DETAIL_FA, says why to these
// values). constants.scad has to be included before Technic.scad:
// OpenSCAD evaluates a reassigned variable where it was first assigned,
// and if that were Technic.scad's `$fa = 1`, DETAIL_FA would not exist
// yet there. Both then come out undef and are clamped to 0.01, and a
// 10mm sphere elsewhere in the assembly has 19.7 million facets.
$fa = DETAIL_FA;
$fs = DETAIL_FS;

BITBEAM_AXLE_FN = 32;

// One blade of the cross, centred on the origin: a slab
// technic_axle_spline_width along x, technic_axle_spline_thickness
// along y and `h` along z, whose outline in the xz plane has
// technic_axle_cross_section_radius corners and whose edges are rounded
// all the way round with technic_axle_spline_corner_radius. That is
// upstream's technic_axle_spline(): a rounded rectangle, extruded,
// minkowski()ed with a sphere of the edge radius.
//
// The sum of a prism and a sphere is the prism's outline, offset by the
// radius of each of the sphere's rings and placed at that ring's
// height. The outline's corners and the rings have their vertices at
// the same angles, so every offset outline has the same 4 * (n + 1)
// points, and the solid is that stack skinned with quads and capped
// with its two flat faces: index arithmetic. It is the solid upstream's
// minkowski() makes at $fn = 32 (every vertex here is one of its
// vertices; its hull leaves more along the edges, on the same faces),
// and the two axles' volumes agree to 6e-7 %.
//
// That includes the sphere's shortfall, on purpose. A sphere() has no
// vertex on its equator or at its poles: its rings sit half a step off
// them (the `+ 0.5` below), so the blade is r * (1 - cos(90° / rings))
// = 0.0019mm short of nominal on every face. Starting the rings on the
// equator instead gives the nominal 4.85mm, and fails this part's
// reference check against technic_axle(), which is that much smaller
// all over: volume 0.18% off against 0.1% allowed, section IoU 0.9978
// against 0.999 (references.yaml, bitbeam/axle-4L).
module _bitbeam_axle_blade(h) {
    // Facets per quarter turn, in the corners and across the edge
    // rounding alike: circle() and sphere() at $fn = BITBEAM_AXLE_FN.
    n = BITBEAM_AXLE_FN / 4;
    edge = technic_axle_spline_corner_radius;
    // The corners' centres, the same for every outline: only the radius
    // around them grows with the offset.
    cx = technic_axle_spline_width / 2 - edge - technic_axle_cross_section_radius;
    cz = h / 2 - edge - technic_axle_cross_section_radius;
    flat = technic_axle_spline_thickness / 2 - edge;
    // [y, offset] of each outline, from the face at -y to the one at
    // +y: the sphere's lower rings under the prism's lower face, its
    // upper rings on the upper face.
    levels = [
        for (i = [n - 1:-1:0]) let (a = (i + 0.5) * 90 / n) [-flat - edge * sin(a), edge * cos(a)],
        for (i = [0:n - 1]) let (a = (i + 0.5) * 90 / n) [flat + edge * sin(a), edge * cos(a)],
    ];
    m = 4 * (n + 1);
    points = [
        for (level = levels, corner = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]], i = [0:n])
            let (r = technic_axle_cross_section_radius + level[1], a = corner[2] + i * 90 / n)
            [corner[0] * cx + r * cos(a), level[0], corner[1] * cz + r * sin(a)],
    ];
    last = (len(levels) - 1) * m;
    faces = [
        [for (j = [m - 1:-1:0]) j],
        for (k = [0:len(levels) - 2], j = [0:m - 1])
            [k * m + j, k * m + (j + 1) % m, (k + 1) * m + (j + 1) % m, (k + 1) * m + j],
        [for (j = [0:m - 1]) last + j],
    ];
    polyhedron(points, faces, convexity = 2);
}

module bitbeam_axle(length = 4, anchor = BOTTOM, spin = 0, orient = UP) {
    // The blades no longer read $fn; a part attached to the axle still
    // inherits it, as it did when technic_axle() needed it here.
    $fn = BITBEAM_AXLE_FN;
    h = technic_height_in_mm * length;
    // The size the mesh really has rather than the nominal one (the
    // sphere's shortfall, see _bitbeam_axle_blade()), or every anchor
    // on the part would sit that far off: tests/test_anchors.py holds
    // it to 0.001mm, and the shortfall at $fn = 32 is 0.0039mm across.
    rings = floor((BITBEAM_AXLE_FN + 1) / 2);
    shrink = 2 * technic_axle_spline_corner_radius * (1 - cos(90 / rings));
    w = technic_axle_spline_width - shrink;
    size = [w, w, h - shrink];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        // The cross: one blade and the same one a quarter turn on.
        union() {
            _bitbeam_axle_blade(h);
            rotate(90) _bitbeam_axle_blade(h);
        }
        children();
    }
}
