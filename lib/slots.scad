// Slot convention shared by every part in the catalogue.
//
// - The functional face of a part is its BOTTOM. That is also the print
//   orientation: a part rendered alone lands correctly on the plate.
// - The default mount slot is a named_anchor("mount", ...) on TOP.
// - Parts with more faces declare extra named anchors: "bot", "xpos",
//   "xneg", "ypos", "yneg" (see parts/basics/plate.scad, post.scad).
// - A part with enough surface area to place something off-center
//   additionally declares a *slot grid*: named anchors "mount_<i>_<j>"
//   at a fixed pitch, i/j signed integers centered on the part, so
//   "mount_0_0" always exists and sits at the exact position "mount"
//   does (see grid_mount_anchors() below). The count is never
//   hand-declared — it falls out of the part's own footprint divided by
//   the pitch, so it grows with parameters like gx/gy for free and can't
//   drift out of sync with the geometry. catalogue.yaml's `slots.pitch`
//   restates the same pitch for the web editor, which enumerates slots
//   from a rendered part's own bounding box rather than parsing .scad —
//   tests/test_slots.py renders and probes every declared grid to keep
//   the two in agreement.
// - Attaching through a slot consumes it: once a child is attached via
//   a slot name, that anchor is spent for the resulting compound part.
//   This module system does not enforce that automatically (BOSL2
//   anchors are just points) — it is a modelling convention, kept by
//   the assembly (hand-written or editor-generated) not reusing a name
//   twice, and by the editor tracking occupancy itself.
include <../vendor/BOSL2/std.scad>

// Standard top-mount anchor, at height `h` above the part's local origin
// (which is itself centered per attachable() convention).
function mount_anchor(h) = named_anchor("mount", [0, 0, h], UP, 0);

// Nearest odd slot count that fits `extent` at `pitch`, so a centered
// grid always has a true center index (0) at every gx/gy — never even,
// never zero.
function slot_count(extent, pitch) = max(1, 2 * floor(extent / pitch / 2) + 1);

// A centered grid of TOP-facing named anchors "mount_<i>_<j>" at `pitch`
// (a scalar for a square pitch, or [px, py]), at height `h`. i, j run
// symmetrically about 0 — callers still add mount_anchor(h) separately
// to keep the literal "mount" name resolvable.
//
// `count` (a scalar or [nx, ny]) is optional: pass it when the slots
// must land on a specific real feature — e.g. openGrid's cells, one
// slot per cell, so count must be exactly [cells_x, cells_y] regardless
// of pitch. Omit it to derive the count from `size`/`pitch` instead
// (nearest-odd, via slot_count()) for a part like Gridfinity's base,
// where the grid is a free subdivision for off-center placement rather
// than tied to a specific feature — that path always lands on an
// integer index (0 at true center); an explicit even count does not
// (index 0.5, -0.5, ... — still a stable, parseable name, just not an
// integer, because an even grid genuinely has no center cell).
function grid_mount_anchors(size, pitch, h, count) =
    let(
        px = is_list(pitch) ? pitch.x : pitch,
        py = is_list(pitch) ? pitch.y : pitch,
        nx = is_undef(count) ? slot_count(size.x, px) : (is_list(count) ? count.x : count),
        ny = is_undef(count) ? slot_count(size.y, py) : (is_list(count) ? count.y : count)
    )
    [
        for (i = [-(nx - 1) / 2 : (nx - 1) / 2])
            for (j = [-(ny - 1) / 2 : (ny - 1) / 2])
                named_anchor(str("mount_", i, "_", j), [i * px, j * py, h], UP, 0)
    ];

// A row of `count` named anchors along one edge of a `size`-sized box,
// for a part whose side faces carry their own holes (see
// parts/basics/pinhole_plate.scad) — the side-face counterpart to
// grid_mount_anchors()'s top grid. `face` is one of "xpos"/"xneg"/
// "ypos"/"yneg"; the row runs along the OTHER horizontal axis, centered
// at `pitch` spacing, named "<face>_<i>". Anchor direction is that
// face's own outward normal, matching the single box-face anchors
// (parts/basics/plate.scad's "xpos" etc.) so both kinds of anchor on
// the same face agree about which way is out.
function side_row_anchors(face, size, pitch, count) =
    let(
        row_on_x = (face == "xpos" || face == "xneg"),
        fixed    = row_on_x
            ? (face == "xpos" ? size.x / 2 : -size.x / 2)
            : (face == "ypos" ? size.y / 2 : -size.y / 2),
        dir = face == "xpos" ? RIGHT : face == "xneg" ? LEFT
            : face == "ypos" ? BACK  : FRONT
    )
    [
        for (i = [-(count - 1) / 2 : (count - 1) / 2])
            named_anchor(str(face, "_", i),
                row_on_x ? [fixed, i * pitch, 0] : [i * pitch, fixed, 0],
                dir, 0)
    ];
