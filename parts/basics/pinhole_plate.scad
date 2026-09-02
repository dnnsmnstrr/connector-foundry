// BitBeam-compatible pinhole plate: a sibling of basics_plate with a
// configurable grid of BITBEAM_HOLE_DIA holes on the top face at
// BITBEAM_UNIT pitch, plus an optional single row of matching holes
// along each side face, in register with the top grid — so a beam
// pinned to an edge lines up with the columns/rows on top. Keeps
// basics_plate's six-face anchors (mount/bot/xpos/xneg/ypos/yneg) and
// corner rounding; grid_x/grid_y take over from plate's freeform w/d,
// since an arbitrary size would put the grid out of register with the
// BitBeam pitch — width and depth are exactly grid_x/grid_y units, same
// "beam extends half a unit past its outermost hole" margin a real
// BitBeam beam has, so the plate's own edge lines up the same way.
//
// Side holes run horizontally into the edge at mid-thickness (z=0),
// deep enough to seat a bitbeam_pin (see parts/bitbeam/pin.scad), not a
// hole through the whole plate. They
// need t thick enough to leave sane walls above and below a
// BITBEAM_HOLE_DIA bore; the default thickness (BITBEAM_UNIT, 8mm)
// centers the bore exactly at mid-thickness with 1.6mm of wall on each
// side, and not-coincidentally also matches a beam's own cross-section,
// so a beam butted against the edge sits flush. A thinner plate can
// still take the top grid on its own; asking for side holes on one too
// is a hard error (assert), not a silently undersized or missing bore.
//
// Every hole (top and side) is a fixed BITBEAM_HOLE_DIA bore, same as a
// real beam's — the fit is tuned entirely on the pin side
// (bitbeam_pin's own FIT_CLEARANCE), not here, so there's one knob for
// grip, not two fighting each other.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module pinhole_plate(grid_x = 3, grid_y = 3, t = BITBEAM_UNIT, r = 3,
                      side_xpos = true, side_xneg = true, side_ypos = true, side_yneg = true,
                      anchor = BOTTOM, spin = 0, orient = UP) {
    // Deep enough to seat a bitbeam_pin (parts/bitbeam/pin.scad), no
    // further, and requiring at least this much wall above/below the
    // bore before allowing side holes at all — local to this module,
    // not file-level constants, since nothing outside it needs them.
    side_hole_depth = BITBEAM_PIN_LEN;
    side_hole_min_wall = 1;

    any_side = side_xpos || side_xneg || side_ypos || side_yneg;
    min_t = BITBEAM_HOLE_DIA + 2 * side_hole_min_wall;
    assert(!any_side || t >= min_t,
        str("pinhole_plate: t=", t, "mm is too thin for side holes (needs >= ", min_t,
            "mm for a ", BITBEAM_HOLE_DIA, "mm bore with ", side_hole_min_wall,
            "mm of wall on each side) — disable side_xpos/side_xneg/side_ypos/side_yneg, ",
            "or increase t."));

    w = grid_x * BITBEAM_UNIT;
    d = grid_y * BITBEAM_UNIT;
    size = [w, d, t];

    top_anchors = grid_mount_anchors(size, BITBEAM_UNIT, t / 2, count = [grid_x, grid_y]);
    side_anchors = [
        if (side_xpos) each side_row_anchors("xpos", size, BITBEAM_UNIT, grid_y),
        if (side_xneg) each side_row_anchors("xneg", size, BITBEAM_UNIT, grid_y),
        if (side_ypos) each side_row_anchors("ypos", size, BITBEAM_UNIT, grid_x),
        if (side_yneg) each side_row_anchors("yneg", size, BITBEAM_UNIT, grid_x),
    ];

    anchors = concat([
        mount_anchor(t / 2),
        named_anchor("bot",  [0, 0, -t / 2], DOWN,  0),
        named_anchor("xpos", [w / 2, 0, 0],  RIGHT, 0),
        named_anchor("xneg", [-w / 2, 0, 0], LEFT,  0),
        named_anchor("ypos", [0, d / 2, 0],  BACK,  0),
        named_anchor("yneg", [0, -d / 2, 0], FRONT, 0),
    ], top_anchors, side_anchors);

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        difference() {
            cuboid(size, rounding = r, edges = "Z");
            for (a = top_anchors)
                translate(a[1]) through_hole(BITBEAM_HOLE_DIA / 2, t);
            if (side_xpos) side_row_holes("xpos", size, BITBEAM_UNIT, grid_y, BITBEAM_HOLE_DIA / 2, side_hole_depth);
            if (side_xneg) side_row_holes("xneg", size, BITBEAM_UNIT, grid_y, BITBEAM_HOLE_DIA / 2, side_hole_depth);
            if (side_ypos) side_row_holes("ypos", size, BITBEAM_UNIT, grid_x, BITBEAM_HOLE_DIA / 2, side_hole_depth);
            if (side_yneg) side_row_holes("yneg", size, BITBEAM_UNIT, grid_x, BITBEAM_HOLE_DIA / 2, side_hole_depth);
        }
        children();
    }
}
