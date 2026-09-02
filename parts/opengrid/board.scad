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

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        if (variant == "lite")
            openGridLite(cells_x, cells_y, tileSize = OG_PITCH,
                         Screw_Mounting = screw_mounting, Chamfers = chamfers,
                         Connector_Holes = connector_holes,
                         anchor = CENTER, spin = 0, orient = UP);
        else if (variant == "heavy")
            openGridHeavy(cells_x, cells_y, tileSize = OG_PITCH,
                          Screw_Mounting = screw_mounting, Chamfers = chamfers,
                          Connector_Holes = connector_holes,
                          anchor = CENTER, spin = 0, orient = UP);
        else
            openGrid(cells_x, cells_y, tileSize = OG_PITCH,
                     Tile_Thickness = OG_THICKNESS_FULL,
                     Screw_Mounting = screw_mounting, Chamfers = chamfers,
                     Connector_Holes = connector_holes,
                     anchor = CENTER, spin = 0, orient = UP);
        children();
    }
}
