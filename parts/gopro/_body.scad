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
//
// A symmetric female (see female.scad) pads the near leg out by the
// same nut_depth the far leg already carries, so it is one nut_depth
// deeper again.
function _gopro_male_depth()   = GP_LEG_T * 2 + GP_SLIT_W;
function _gopro_female_depth(nut_depth, symmetric = false) =
    GP_SLIT_W * 2 + GP_LEG_T * 3 + nut_depth * (symmetric ? 2 : 1);

// Upstream's center=true centres each buckle on its *mounting axis* —
// the centre of the male's slit, the centre of the female's middle leg
// — not on its geometric centre. For the male those coincide; for the
// female the nut boss makes the far leg nut_depth thicker than the near
// one, leaving the body nut_depth/2 off (1.5mm at the default 3mm
// pocket). A BOSL2 attachable() envelope has to wrap geometry that
// really is centred in the declared size, or every anchor on the part is
// wrong by that offset, so the difference is corrected here. The
// symmetric female pads the near leg to match, so its two centres
// coincide again.
function _gopro_center_offset(kind, nut_depth, symmetric) =
    kind == "male" || symmetric ? 0 : nut_depth / 2;

// The M5 pivot axis, in a buckle's own (centred) frame.
//
// z: the axis runs along Y through the centre of the O15 leg ends.
// y: the axis is not on the buckle's centreline for a plain female — it
//    is _gopro_center_offset away from the geometric centre the
//    attachable envelope has to use. Putting the "pivot" anchor there is
//    what makes the male's legs land in the female's slits rather than
//    1.5mm into its nut boss.
function gopro_pivot_z(base_h = GP_BASE_T, leg_h = GP_LEG_H) =
    GP_LEG_DIA / 2 - (base_h + leg_h) / 2;

// Any diameter no wider than upstream's M5 bore (5mm + 0.5mm tolerance):
// a cylinder(d=, $fn=4) of this size lies entirely inside the bore, so a
// nut pocket cut this small removes nothing the bore hasn't already.
_GOPRO_NO_POCKET_D = 5;

// Upstream's female, plus — when symmetric — the same buckle mirrored
// about its pivot axis to pad the near leg out to the far leg's
// thickness. The mirror image would bring a second nut pocket with it,
// so its pocket is shrunk inside the bore (see _GOPRO_NO_POCKET_D): the
// one real pocket stays on the far leg, and the near leg becomes a plain
// through-hole in a leg as thick as the far one.
module _gopro_female_body(base_h, base_w, leg_h, nut_depth, nut_dia, nut_sides, symmetric) {
    gopro_mount_f(base_height = base_h, base_width = base_w, leg_height = leg_h,
                  nut_diameter = nut_dia, nut_sides = nut_sides, nut_depth = nut_depth,
                  center = true);
    if (symmetric && nut_depth > 0)
        mirror([0, 1, 0])
            gopro_mount_f(base_height = base_h, base_width = base_w, leg_height = leg_h,
                          nut_diameter = _GOPRO_NO_POCKET_D, nut_sides = 4,
                          nut_depth = nut_depth, center = true);
}

module _gopro_buckle(kind, base_h, base_w, leg_h, nut_depth, nut_dia, nut_sides, symmetric,
                     anchor, spin, orient) {
    depth   = kind == "male" ? _gopro_male_depth() : _gopro_female_depth(nut_depth, symmetric);
    total_h = base_h + leg_h;
    size    = [base_w, depth, total_h];
    axis_y  = _gopro_center_offset(kind, nut_depth, symmetric);

    // "mount" sits over the pivot axis — the middle leg of a female, the
    // slit of a male — rather than at the centre of the plate, so a part
    // attached through it is centred on the prongs it mates with, even
    // when the plate itself runs further to one side (the plain female's
    // nut boss). catalogue.yaml's mount_offset says the same thing to
    // the web editor.
    anchors = [mount_anchor(size.z / 2, [0, axis_y]),
               named_anchor("pivot", [0, axis_y, gopro_pivot_z(base_h, leg_h)], BACK, 0)];

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // Flip upstream: legs down (functional face), base plate up.
        up(total_h / 2) xrot(180) fwd(axis_y)
            if (kind == "male")
                gopro_mount_m(base_height = base_h, base_width = base_w,
                              leg_height = leg_h, center = true);
            else
                _gopro_female_body(base_h, base_w, leg_h, nut_depth, nut_dia, nut_sides, symmetric);
        children();
    }
}
