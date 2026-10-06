// openGrid mounting board: a panel of cells on OG_PITCH spacing that
// accessories snap into (see snap.scad). Functional face is BOTTOM (also
// the print orientation, grid face up); mates through the "mount" anchor
// on TOP.
//
// The cell geometry is NOT reimplemented here. This is a thin wrapper
// over openGrid() / openGridLite() / openGridHeavy() from QuackWorks,
// vendored as the git submodule vendor/QuackWorks — the openGrid design
// is by David D, the OpenSCAD implementation by Andy (BlackjackDuck).
//
// LICENSE: QuackWorks is CC-BY-NC-SA 4.0, not MIT. Rendering this part
// runs that code, so this part is NOT under the repository's MIT
// licence — see catalogue.yaml's `license` field for this entry and the
// README "Licensing" section. Printed tiles are separately licensed
// CC-BY by upstream, so the output is unrestricted; the terms attach to
// running and adapting the script.
//
// Why a wrapper and not our own: the real cell is not a plain square
// hole. It is a chamfered-square aperture with a recess at mid-thickness
// that the snap's wings expand into, plus corner lugs. The hand-written
// version this replaced was a plain 25mm through-hole with an invented
// top rabbet, and the reference checks measured it at IoU 0.23 against a
// real tile — it could not hold a real snap at all.
//
// Three things upstream's wrappers get wrong for us, done here instead:
//
//  - Connector holes. openGrid() puts them at a height it reads from
//    openGrid.scad's top-level customizer variable Full_or_Lite, not
//    from a parameter — and that variable says "Lite", which `use <>`
//    cannot change. So every full and heavy board got its holes at the
//    lite height, 1.2mm above centre. The boards are rendered without
//    them and og_connector_holes() below cuts them where upstream means
//    them to be for each variant (what its own script renders with
//    Full_or_Lite set to match — references.yaml checks all three).
//  - Lite boards. openGridLite() is openGrid() wrapped in another
//    attachable, a render(), a union() and BOSL2's top_half(): deep
//    enough that the browser's OpenSCAD runs out of stack (see
//    web/README.md, "Known limit") and the Library kept showing the last
//    full board instead. It is a full tile with its bottom 2.8mm cut
//    away; that cut is written out below with builtins.
//  - Screw mounting. openGrid() cuts each countersunk hole as three
//    cyl()s chained through attach(), which puts a board with screws
//    past that same stack limit (73 levels, 83 on heavy). The boards are
//    rendered with Screw_Mounting = "None" and og_screw_holes() cuts
//    them as three sibling cylinders, at upstream's positions and sizes
//    (references.yaml checks them against its own script too). Upstream
//    also turns "Everywhere" chamfers into corner chamfers when there
//    are screws, since a chamfer would eat a screw seat; that is kept.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
use <../../vendor/QuackWorks/openGrid/openGrid.scad>

function og_board_thickness(variant) =
    variant == "lite"  ? OG_THICKNESS_LITE  :
    variant == "heavy" ? OG_THICKNESS_HEAVY : OG_THICKNESS_FULL;

module og_board(cells_x = 2, cells_y = 2, variant = "full",
                chamfers = "None", connector_holes = false, screw_mounting = "None",
                anchor = BOTTOM, spin = 0, orient = UP) {
    assert(variant == "full" || variant == "lite" || variant == "heavy",
           "variant must be \"full\", \"lite\" or \"heavy\"");

    // A tile is exactly cells x pitch — there is no border beyond the
    // grid. (The old implementation added 0.8mm all round, which made
    // every board 1.6mm too big to tile with real ones.)
    size = [cells_x * OG_PITCH, cells_y * OG_PITCH, og_board_thickness(variant)];

    // One slot per cell, exactly [cells_x, cells_y] of them — not
    // derived from size/pitch, which would misplace slots off true cell
    // centers whenever a cell count is even (the default 2x2 included).
    anchors = concat([mount_anchor(size.z / 2)],
                      grid_mount_anchors(size, OG_PITCH, size.z / 2, count = [cells_x, cells_y]));

    // applyTileCornerModifications()'s rule: screw seats replace the
    // chamfers at the inner corners.
    screws = screw_mounting != "None";
    chamfer_mode = chamfers == "Everywhere" && (screw_mounting == "Everywhere" || screw_mounting == "Corners")
        ? "Corners" : chamfers;

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        translate([0, 0, -size.z / 2]) difference() {
            if (variant == "lite") {
                // openGridLite(): the top OG_THICKNESS_LITE of a full tile.
                cut = OG_THICKNESS_FULL - OG_THICKNESS_LITE;
                translate([0, 0, -cut]) intersection() {
                    openGrid(cells_x, cells_y, tileSize = OG_PITCH,
                             Tile_Thickness = OG_THICKNESS_FULL,
                             Screw_Mounting = "None", Chamfers = chamfer_mode,
                             Connector_Holes = false, anchor = BOTTOM);
                    translate([-size.x, -size.y, cut]) cube([2 * size.x, 2 * size.y, size.z + 1]);
                }
            } else if (variant == "heavy")
                openGridHeavy(cells_x, cells_y, tileSize = OG_PITCH,
                              Screw_Mounting = "None", Chamfers = chamfer_mode,
                              Connector_Holes = false, anchor = BOTTOM);
            else
                openGrid(cells_x, cells_y, tileSize = OG_PITCH,
                         Tile_Thickness = OG_THICKNESS_FULL,
                         Screw_Mounting = "None", Chamfers = chamfer_mode,
                         Connector_Holes = false, anchor = BOTTOM);
            if (connector_holes)
                og_connector_holes(cells_x, cells_y, og_connector_hole_z(variant));
            if (screws) {
                // Countersunk from the grid face — from both faces on a
                // heavy board, each half being a full tile.
                translate([0, 0, size.z]) og_screw_holes(cells_x, cells_y, screw_mounting);
                if (variant == "heavy")
                    mirror([0, 0, 1]) og_screw_holes(cells_x, cells_y, screw_mounting);
            }
        }
        children();
    }
}

// Upstream's screw seat numbers (openGrid.scad's customizer defaults):
// a 4.1mm shank under a 90° countersink for a 7.2mm head, sunk 1mm.
OG_SCREW_D       = 4.1;
OG_SCREW_HEAD_D  = 7.2;
OG_SCREW_INSET   = 1;
OG_SCREW_CSK_DEG = 90;
// "By Row and Column" puts a screw every this many columns and rows.
OG_SCREW_EVERY   = [2, 1];

// The countersunk screw holes, grid face on z = 0 and material below,
// at the positions applyTileCornerModifications() picks for `mode`:
// the four cells in from the corners, every inner grid crossing, or
// every OG_SCREW_EVERY-th one of those (offset half a cell when that
// does not divide evenly, as upstream does). Each hole is upstream's
// three cyl()s — the head's recess, the cone, the shank, each 0.01 past
// the last — side by side instead of attach()ed to each other.
module og_screw_holes(cells_x, cells_y, mode) {
    w = cells_x * OG_PITCH;
    h = cells_y * OG_PITCH;
    inner = [(cells_x - 2) * OG_PITCH, (cells_y - 2) * OG_PITCH];
    every = [OG_PITCH * max(1, OG_SCREW_EVERY[0]), OG_PITCH * max(1, OG_SCREW_EVERY[1])];
    shift = [(cells_x - 2) % max(1, OG_SCREW_EVERY[0]) % 2 == 0 ? 0 : -OG_PITCH / 2,
             (cells_y - 2) % max(1, OG_SCREW_EVERY[1]) % 2 == 0 ? 0 : OG_PITCH / 2];
    points =
        mode == "Corners" ? [[w / 2 - OG_PITCH, h / 2 - OG_PITCH], [-w / 2 + OG_PITCH, h / 2 - OG_PITCH],
                             [w / 2 - OG_PITCH, -h / 2 + OG_PITCH], [-w / 2 + OG_PITCH, -h / 2 + OG_PITCH]] :
        mode == "Everywhere" ? og_grid_points([OG_PITCH, OG_PITCH], inner) :
        mode == "By Row and Column" ? [for (p = og_grid_points(every, inner)) p + shift] :
        [];
    cone = OG_SCREW_HEAD_D / 2 - OG_SCREW_D / 2;
    cone_h = tan((180 - OG_SCREW_CSK_DEG) / 2) * cone - 0.01;
    for (p = points) translate([p.x, p.y, 0.01]) {
        cyl(d = OG_SCREW_HEAD_D, h = OG_SCREW_INSET, anchor = TOP, $fn = 30);
        translate([0, 0, -OG_SCREW_INSET])
            cyl(d2 = OG_SCREW_HEAD_D, d1 = OG_SCREW_D, h = cone_h, anchor = TOP, $fn = 30);
        translate([0, 0, -OG_SCREW_INSET - cone_h])
            cyl(d = OG_SCREW_D, h = OG_THICKNESS_FULL + 0.02, anchor = TOP, $fn = 30);
    }
}

// BOSL2's grid_copies(spacing, size =) positions: as many as fit in
// `size` at `spacing` (none on an axis whose size is negative), centred.
function og_grid_points(spacing, size) =
    let (n = [for (i = [0, 1]) max(0, floor(size[i] / spacing[i]) + 1)])
    [for (c = [0 : 1 : n[0] - 1], r = [0 : 1 : n[1] - 1])
        [c * spacing[0] - spacing[0] * (n[0] - 1) / 2, r * spacing[1] - spacing[1] * (n[1] - 1) / 2]];

// Where the connector holes' centres sit, up from the board's bottom
// face: mid-thickness on a full tile, and in each half of a heavy one
// (two full tiles back to back, 0.2mm apart); on a lite tile upstream
// keeps them 1mm under the grid face, so they stay inside the thinner
// tile — the height its Full_or_Lite = "Lite" picks (1.2mm being half
// the cutter's 2.4, plus the 0.01 upstream adds).
function og_connector_hole_z(variant) =
    variant == "lite"  ? [OG_THICKNESS_LITE - (2.4 + 0.01) / 2 - 1] :
    variant == "heavy" ? [OG_THICKNESS_FULL / 2, OG_THICKNESS_HEAVY - OG_THICKNESS_FULL / 2] :
                         [OG_THICKNESS_FULL / 2];

// The pockets the openGrid connector clips into, at every grid line
// along each edge (none at the corners), as openGrid() places them:
// x-edge ones when there is more than one row, y-edge ones when more
// than one column. Board centred on x/y, centres at the heights in `zs`.
module og_connector_holes(cells_x, cells_y, zs) {
    w = cells_x * OG_PITCH;
    h = cells_y * OG_PITCH;
    for (z = zs) translate([0, 0, z]) {
        if (cells_y > 1)
            for (k = [1 : cells_y - 1]) {
                y = k * OG_PITCH - h / 2;
                translate([w / 2 + 0.005, y, 0]) rotate(180) og_connector_cutout();
                translate([-w / 2 - 0.005, y, 0]) og_connector_cutout();
            }
        if (cells_x > 1)
            for (k = [1 : cells_x - 1]) {
                x = k * OG_PITCH - w / 2;
                translate([x, h / 2 + 0.005, 0]) rotate(-90) og_connector_cutout();
                translate([x, -h / 2 - 0.005, 0]) rotate(90) og_connector_cutout();
            }
    }
}

// openGrid()'s connector_cutout_delete_tool(), which is nested inside
// openGrid() and so cannot be called from here: half a 10.4 x 5.2
// stadium, pinched a little at the edge (the clip's detent) and flared
// at the mouth. Mouth on x = 0, reaching 5.1mm toward +x, centred on
// z = 0 — the pose upstream's anchor = LEFT gives it.
module og_connector_cutout() {
    r = 2.6;     // connector_cutout_radius
    dr = 2.7;    // connector_cutout_dimple_radius
    sep = 2.5;   // connector_cutout_separation
    h = 2.4;     // connector_cutout_height
    translate([0, 0, -h / 2]) intersection() {
        linear_extrude(h) union() {
            translate([-0.1, 0]) difference() {
                hull() for (x = [-r, r]) translate([x, 0]) circle(r = r, $fn = 50);
                for (y = [-1, 1]) translate([r - sep, y * (r + sep)]) circle(r = dr, $fn = 50);
            }
            rect([1, sep * 2 - (dr - sep)], rounding = [0, -.25, -.25, 0], $fn = 32, corner_flip = true, anchor = LEFT);
        }
        // half_of(RIGHT, s = dr * 4)
        translate([0, -dr * 2, -dr * 2]) cube(dr * 4);
    }
}
