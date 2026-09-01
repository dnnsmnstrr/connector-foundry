// Slot convention shared by every part in the catalogue.
//
// - The functional face of a part is its BOTTOM. That is also the print
//   orientation: a part rendered alone lands correctly on the plate.
// - The default mount slot is a named_anchor("mount", ...) on TOP.
// - Parts with more faces declare extra named anchors: "bot", "xpos",
//   "xneg", "ypos", "yneg" (see parts/basics/plate.scad, post.scad).
// - Attaching through a slot consumes it: once a child is attached via
//   "mount", that anchor is spent for the resulting compound part. This
//   module system does not enforce that automatically (BOSL2 anchors are
//   just points) — it is a modelling convention, kept by only exposing
//   one attachment per assembly step and documenting it in each part's
//   header comment.
include <../vendor/BOSL2/std.scad>

// Standard top-mount anchor, at height `h` above the part's local origin
// (which is itself centered per attachable() convention).
function mount_anchor(h) = named_anchor("mount", [0, 0, h], UP, 0);
