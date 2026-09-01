// openGrid snap: the small clip that mounts into a board's cell grid (see
// board.scad). Functional face is BOTTOM (also print orientation, tip
// down); mates through the "mount" anchor on TOP, for stacking any other
// part onto a board.
//
// Original design (not reverse-engineered — see README "Licensing"): a
// square post sized to the board's OG_TILE_INNER aperture, with a barb
// near the tip that flares past the aperture width and springs out below
// the board once fully seated, and a flange on top that seats flush in
// the board's rabbet. Two perpendicular relief slits split the post into
// four independent corner fingers so the barb can actually compress on
// the way in; the barb's entry ramp is long and gentle (easy insertion),
// its return ramp short and steep (the retaining shoulder).
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

_OG_SNAP_BARB_H_IN  = 1.6; // entry ramp height, gentle
_OG_SNAP_BARB_H_OUT = 0.6; // return ramp height, steep — the retaining shoulder
_OG_SNAP_BARB_OVERSIZE = 0.7; // barb flare beyond OG_TILE_INNER, each side
_OG_SNAP_SLIT_W = 1.2;         // flex-relief slit width, splits the post into 4 fingers

module og_snap(board_t = OG_THICKNESS_FULL, anchor = BOTTOM, spin = 0, orient = UP) {
    shaft_w = OG_TILE_INNER - 2 * FIT_CLEARANCE;
    barb_w  = OG_TILE_INNER + 2 * _OG_SNAP_BARB_OVERSIZE;
    barb_h  = _OG_SNAP_BARB_H_IN + _OG_SNAP_BARB_H_OUT;
    tab_h   = board_t + barb_h; // barb clears the board's far face and springs open flush with it

    flange_w = OG_TILE_INNER + 2 * OG_CHAMFER_MID - 2 * FIT_CLEARANCE; // seats in the board's rabbet
    flange_t = OG_TOP_INSET - FIT_CLEARANCE;

    total_h = tab_h + flange_t;
    size    = [flange_w, flange_w, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        difference() {
            union() {
                prismoid(size1 = [shaft_w, shaft_w], size2 = [barb_w, barb_w], h = _OG_SNAP_BARB_H_IN, anchor = BOTTOM);
                up(_OG_SNAP_BARB_H_IN)
                    prismoid(size1 = [barb_w, barb_w], size2 = [shaft_w, shaft_w], h = _OG_SNAP_BARB_H_OUT, anchor = BOTTOM);
                up(barb_h)
                    cuboid([shaft_w, shaft_w, tab_h - barb_h], anchor = BOTTOM);
                up(tab_h)
                    cuboid([flange_w, flange_w, flange_t], rounding = 1.5, edges = "Z", anchor = BOTTOM);
            }
            for (rot = [0, 90])
                zrot(rot)
                    up(tab_h / 2)
                        cuboid([barb_w + 2, _OG_SNAP_SLIT_W, tab_h + 2]);
        }
        children();
    }
}
