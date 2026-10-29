// Printing a part folded or split: cut it across, lay both halves on the
// bed on their cut faces, and fold (or glue) them back together after
// printing. openGrid-projects prints its folded openConnect snap and
// screw this way (opengrid_base.scad's conditional_fold(), mitufy,
// CC-BY 4.0): a head printed standing has its layers across the neck,
// which a hanging load pulls apart; on its side, the layers run along
// the load. This is that module re-expressed, so it can take any
// geometry (a whole Bench assembly, not just a snap) and lay it out
// split as well as folded.
//
// Frame: the children arrive posed so that
//  - the cut is the plane y = cut_y, and the half that keeps the head
//    (A) is the one on y >= cut_y;
//  - the hinge runs along the X axis at z = 0, and nothing is below
//    z = 0: the hinge is the far end of the part from the head, where
//    both halves' cut faces reach (a snap's board side, a screw's tip).
// A is turned onto its cut face; the other half (B) is turned the other
// way and laid beside it, mirrored, `gap` off, so that turning B over
// about the hinge puts it back where it was. Both halves' old z runs
// along the bed's Y, away from the hinge, so the layout spans y from
// -(gap + B's height) to A's height.
//
// folded: a hinge one layer thick (FOLD_HINGE_H) and `gap` wide joins
// the halves along their shared edge: the cut face's own outline there,
// sliced a hundredth above z = 0, so it is exactly as wide as the edge
// it joins. Where the cut face doesn't reach z = 0 it has nothing to
// join, and the halves come out apart (the Bench checks that before
// it offers a fold: web/src/lib/benchFold.js).
// split: no hinge, and the halves FOLD_SPLIT_GAP apart, to glue.
//
// `sliceoff` takes that much more off B at the cut: upstream's screw
// does (half the gap), so its folded half closes onto the hinge's own
// thickness; its snap doesn't.
//
// Each half is the children intersected with a half-space, so the
// children render three times (twice for split). Each half's turns are
// written as the one matrix they multiply out to, not as upstream's
// chain of translate()s and rotate()s: the browser's OpenSCAD runs out
// of stack about 70 module levels deep (web/README.md, "Known limit —
// nesting depth"), a snap body alone comes close, and the chain cost
// eight levels where this costs three.
include <constants.scad>

module fold_print(cut_y, split = false, sliceoff = 0, gap = undef, size = 1000) {
    g = is_undef(gap) ? (split ? FOLD_SPLIT_GAP : FOLD_GAP) : gap;
    // A: (x, y, z) -> (-x, z, y - cut_y). Upstream's back(fold_position)
    // yrot(180) xrot(-90, cp = [0, -fold_position, 0]): turned onto its
    // cut face, its height along the bed's +Y.
    multmatrix([[-1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, -cut_y], [0, 0, 0, 1]])
        difference() {
            children();
            translate([-size / 2, cut_y - size, -size / 2]) cube(size);
        }
    // B: (x, y, z) -> (-x, -z - b, cut_y - sliceoff - y), turned the
    // other way and laid `b` off the hinge on -Y. The EPS is upstream's:
    // a folded B sinks that far into the hinge, so the print is one solid.
    b = g - (split ? 0 : FOLD_EPS);
    multmatrix([[-1, 0, 0, 0], [0, 0, -1, -b], [0, -1, 0, cut_y - sliceoff], [0, 0, 0, 1]])
        difference() {
            children();
            translate([-size / 2, cut_y - sliceoff, -size / 2]) cube(size);
        }
    // The hinge: the cut face's own outline a hundredth above z = 0, in
    // a FOLD_HINGE_H band on A's side of the cut, stood up `g` wide
    // between the halves — (x, y, z) -> (-x, z - g, y - cut_y).
    if (!split)
        multmatrix([[-1, 0, 0, 0], [0, 0, 1, -g], [0, 1, 0, -cut_y], [0, 0, 0, 1]])
            linear_extrude(g + 2 * FOLD_EPS) difference() {
                projection(cut = true) translate([0, 0, -0.01]) children();
                translate([-size / 2, cut_y + FOLD_HINGE_H]) square(size);
                translate([-size / 2, cut_y - size]) square(size);
            }
}
