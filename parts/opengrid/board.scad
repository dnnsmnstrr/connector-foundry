// openGrid mounting board: a panel of square cells on OG_PITCH spacing that
// accessories snap into (see snap.scad). Functional face is BOTTOM (also
// print orientation, grid face up); mates through the "mount" anchor on TOP.
//
// Per-cell hole, original design (not reverse-engineered — see README
// "Licensing"): a plain OG_TILE_INNER square aperture runs the full board
// thickness, capped by a shallow rabbet let into the top face. The rabbet
// is OG_TOP_INSET deep and OG_CHAMFER_MID wider than the aperture on each
// side, so a mating part's flange (og_snap's cap) seats flush in it; the
// rabbet's outer edge gets a small OG_CHAMFER_TOP lead-in bevel so it prints
// clean and is easy to locate a part into by feel.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

_OG_BOARD_CORNER_R = 2;

module _og_cell_cut(t) {
    rabbet_w = OG_TILE_INNER + 2 * OG_CHAMFER_MID;
    // Through aperture.
    cuboid([OG_TILE_INNER, OG_TILE_INNER, t + 1]);
    // Top rabbet (the "capture inset"), plus its lead-in bevel.
    up(t / 2 - OG_TOP_INSET / 2 + 0.5)
        cuboid([rabbet_w, rabbet_w, OG_TOP_INSET + 1]);
    up(t / 2 + 0.5 - OG_CHAMFER_TOP / 2)
        prismoid(size1 = [rabbet_w, rabbet_w], size2 = [rabbet_w + 2 * OG_CHAMFER_TOP, rabbet_w + 2 * OG_CHAMFER_TOP],
                 h = OG_CHAMFER_TOP + 1, anchor = CENTER);
}

module og_board(cells_x = 2, cells_y = 2, variant = "full", anchor = BOTTOM, spin = 0, orient = UP) {
    t = variant == "lite" ? OG_THICKNESS_LITE : OG_THICKNESS_FULL;
    bw = cells_x * OG_PITCH + 2 * OG_OUTSIDE_EXT;
    bd = cells_y * OG_PITCH + 2 * OG_OUTSIDE_EXT;
    size = [bw, bd, t];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        difference() {
            cuboid(size, rounding = _OG_BOARD_CORNER_R, edges = "Z");
            for (i = [0 : cells_x - 1])
                for (j = [0 : cells_y - 1])
                    translate([(i - (cells_x - 1) / 2) * OG_PITCH, (j - (cells_y - 1) / 2) * OG_PITCH, 0])
                        _og_cell_cut(t);
        }
        children();
    }
}
