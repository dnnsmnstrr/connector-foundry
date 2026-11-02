// GOEWS hanger plate: the plate every GOEWS accessory hangs from a GOEWS
// tile by, a hanger bar behind each 42mm unit. GOEWS is by MrExo3D
// (goews.ws), Printables model 1090032, CC-BY 4.0 — NOT MIT, see the
// README's "Licensing"; lib/goews.scad has the numbers and where they
// come from.
//
// units hangers side by side, for that many cells of a row (on a hex
// tile, the cells of one row); the plate is units x 42 - 0.4 by 24.39mm,
// plate mm thick. A notch in its top edge over each hanger lets a GOEWS
// bolt through into the tile's thread above the window, which locks the
// plate on.
//
// Functional face is BOTTOM, the hangers' backs. "mount" is on TOP, the
// plate's front, where a hook, a shelf or a holder fuses on, the
// hangers' bottom edge down. Print it on its side, a long edge of the
// plate on the bed, so the layers run along the hanger.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/goews.scad>

module goews_hanger(units = 1, plate = 3, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(units >= 1 && units == round(units), "units must be a whole number, at least 1");
    assert(plate >= 1, "plate must be at least 1mm");
    size = [units * GOEWS_PITCH - (GOEWS_PITCH - GOEWS_PLATE_W), GOEWS_PLATE_H, GOEWS_HANGER_DEPTH + plate];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, -size.y / 2, -size.z / 2])
            goews_hanger_plate(units, plate, $fa = detail_fa(6), $fs = detail_fs(0.5));
        children();
    }
}
