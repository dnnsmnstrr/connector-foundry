// openGrid snap: the clip that mounts into a board's cell grid (see
// board.scad). Functional face is BOTTOM; mates through the "mount"
// anchor on TOP, for stacking any other part onto a board.
//
// The geometry is QuackWorks' openGridSnap() (vendor/QuackWorks),
// openGrid design by David D, OpenSCAD snap implementation by
// metasyntactic — through lib/ogsnap.scad, which builds the same solid
// without upstream's nesting: openGridSnap() is 68 module levels deep,
// two short of where the browser's OpenSCAD runs out of stack, so the
// snap rendered alone and failed attached to anything on the Bench
// (lib/ogsnap.scad's header has the numbers; references.yaml holds it
// to upstream's render).
//
// LICENSE: CC-BY-NC-SA 4.0, not MIT. See board.scad's header and the
// README "Licensing" section.
//
// A real snap sits entirely inside the board's thickness: it is exactly
// as tall as the tile, and retains by wings that spring into the recess
// at mid-thickness. The hand-written version this replaced stood 11.25mm
// tall and reached a barb out past the far face of the board — geometry
// for a board that does not exist.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../lib/ogsnap.scad>

module og_snap(variant = "full", directional = false,
               anchor = BOTTOM, spin = 0, orient = UP) {
    assert(variant == "full" || variant == "lite",
           "variant must be \"full\" or \"lite\"");

    // A lite snap is HALF HEIGHT (3.4mm), which is not the lite tile's
    // thickness (4.0mm) — the two "lite"s mean different things upstream.
    extra = directional ? OG_SNAP_DIR_EXTRA : 0;
    size  = [OG_SNAP_SIZE + extra, OG_SNAP_SIZE,
             variant == "lite" ? OG_SNAP_H_LITE : OG_SNAP_H_FULL];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        // The solid stands on z = 0, centred on its 24.8 mm body. The
        // directional variant grows on +X only, so the body sits half
        // of that off the envelope's centre; recentre it or every
        // anchor on this part is out by OG_SNAP_DIR_EXTRA / 2.
        translate([-extra / 2, 0, -size.z / 2])
            og_snap_solid(lite = variant == "lite", directional = directional);
        children();
    }
}
