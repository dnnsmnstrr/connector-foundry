// Honeycomb Storage Wall insert: a clip that pushes into an HSW cell
// (see wall.scad) and locks behind its lip, under a base to build on.
// Functional face is BOTTOM, the clip; "mount" is on TOP, the base's top
// face, where a hook, a holder or anything else on the Bench fuses on.
// "bot" is the clip's tip. Prints the other way up: base on the bed,
// clip up.
//
// A thin wrapper over hsw_clip() from geru's 3d-scad-hsw-clip (Hugh
// Kern, MIT), vendored as vendor/hsw-clip: a one-way clip, after KYZ's
// V2 clips, with a spring in its middle. Pushed in, its locking side
// goes in first and its spring side snaps behind the lip; it comes out
// by pressing the spring. What this file adds is the envelope and the
// anchors.
//
// base picks upstream's two bases: a hexagon a millimetre narrower than
// the cell's outside, so neighbours fit side by side, or a bar across
// the cell. Upstream's slop (shortening the clip on its spring side) is
// left at its default of none: it moves the clip off the base's centre.
//
// Upstream draws the clip across x, for a cell with its flats on ±x;
// hsw/wall's cells (from the other upstream) have theirs on ±y. The clip
// is turned a quarter here so an insert sits in a wall cell without
// spinning it: clip across y, the hexagon's points on ±x like the cell's.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../vendor/hsw-clip/hswx.scad>
use <../../vendor/hsw-clip/hsw_clip.scad>

module hsw_insert(base = "hex", base_h = 3,
                  anchor = BOTTOM, spin = 0, orient = UP) {
    assert(base == "hex" || base == "rect", "base must be \"hex\" or \"rect\"");
    assert(base_h > 0, "base_h must be positive");

    // Turned as above: the clip is HSWX_INSIDE plus a lock lip either
    // side across y and half HSWX_INSIDE along x; it hangs HSWX_DEPTH
    // under z = 0, the base sits on top. The hexagon has its points on
    // ±x, so it is narrower than its circle on y.
    clip_y = HSWX_INSIDE + 2 * HSWX_LOCK_LIP;
    base_xy = base == "hex" ? [HSWX_OD - 1, (HSWX_OD - 1) * sqrt(3) / 2]
                            : [HSWX_INSIDE / 2, HSWX_OUTSIDE];
    size = [max(HSWX_INSIDE / 2, base_xy.x), max(clip_y, base_xy.y), HSWX_DEPTH + base_h];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2),
                          named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, HSWX_DEPTH - size.z / 2]) rotate(90)
            hsw_clip(center = true,
                     hexbase = base == "hex" ? base_h : 0,
                     rectbase = base == "rect" ? base_h : 0, $fn = 50);
        children();
    }
}
