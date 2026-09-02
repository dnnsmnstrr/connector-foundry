// Shared plumbing for the GoPro-standard prong buckles.
//
// The interface geometry is NOT reimplemented here. Both buckles call
// into GoProScad (ridercz/GoProScad, MIT), vendored as the git submodule
// vendor/GoProScad, which models the standard the way real hardware does
// it: the M5 pivot bolt passes through the Ø15 round ends of the legs
// themselves, so two buckles interleave and clamp on one axis.
//
// (The previous hand-written version in this repo hung rectangular
// prongs below a solid block and put the bolt hole through the block.
// Two of those could not interleave at all — see tests/test_reference.py
// fit checks, which now hold that property down.)
//
// This file adds only the repo's slot convention. Upstream builds a
// buckle with its base plate on the bed and the legs pointing up; our
// convention is that the functional face is BOTTOM, so the whole thing
// is flipped: legs point down, the base plate is the mount face, and the
// "mount" anchor sits on TOP.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../vendor/GoProScad/GoPro.scad>

// Upstream's fixed standard dimensions, re-derived rather than re-typed:
// its leg width and slit width are private (__gopro_*), so the depths
// below come from its own documented base_depth formulas.
function _gopro_male_depth()   = GP_LEG_T * 2 + GP_SLIT_W;
function _gopro_female_depth(nut_depth) = GP_SLIT_W * 2 + GP_LEG_T * 3 + nut_depth;

// Upstream's center=true centres each buckle on its *mounting axis*, not
// on its geometric centre. For the male those coincide; for the female
// the nut boss makes the far leg thicker, leaving the body 1.5mm off. A
// BOSL2 attachable() envelope has to wrap geometry that really is
// centred in the declared size, or every anchor on the part is wrong by
// that offset, so the difference is corrected here.
function _gopro_center_offset(kind, depth) =
    kind == "male" ? 0
                   : depth / 2 - (GP_LEG_T * 1.5 + GP_SLIT_W);

// The M5 pivot axis, in a buckle's own (centred) frame.
//
// z: the axis runs along Y through the centre of the O15 leg ends.
// y: the axis is not on the buckle's centreline. Upstream lays a buckle
//    out about its *mounting* axis — the centre of the male's slit, the
//    centre of the female's middle leg — and for the female that is
//    _gopro_center_offset away from the geometric centre the attachable
//    envelope has to use. Putting the "pivot" anchor there is what makes
//    the male's legs land in the female's slits rather than 1.5mm into
//    its nut boss.
function gopro_pivot_z(base_h = GP_BASE_T, leg_h = GP_LEG_H) =
    GP_LEG_DIA / 2 - (base_h + leg_h) / 2;

module _gopro_buckle(kind, base_h, base_w, leg_h, nut_depth, nut_dia, nut_sides,
                     anchor, spin, orient) {
    depth   = kind == "male" ? _gopro_male_depth() : _gopro_female_depth(nut_depth);
    total_h = base_h + leg_h;
    size    = [base_w, depth, total_h];

    anchors = [mount_anchor(size.z / 2),
               named_anchor("pivot",
                            [0, _gopro_center_offset(kind, depth),
                             gopro_pivot_z(base_h, leg_h)],
                            BACK, 0)];

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // Flip upstream: legs down (functional face), base plate up.
        up(total_h / 2) xrot(180) fwd(_gopro_center_offset(kind, depth))
            if (kind == "male")
                gopro_mount_m(base_height = base_h, base_width = base_w,
                              leg_height = leg_h, center = true);
            else
                gopro_mount_f(base_height = base_h, base_width = base_w,
                              leg_height = leg_h, nut_diameter = nut_dia,
                              nut_sides = nut_sides, nut_depth = nut_depth,
                              center = true);
        children();
    }
}
