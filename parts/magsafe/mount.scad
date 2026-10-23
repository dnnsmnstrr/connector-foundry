// MagSafe mount: a round plate the size of a MagSafe ring, with an
// optional pocket for a magnet ring or a steel disk, so a phone (or a
// MagSafe case or wallet) snaps onto whatever the plate is fused to.
// Functional face is BOTTOM, the pocket's mouth, which faces the phone;
// "mount" is on TOP, where the part it holds on to goes. "bot" is the
// pocket face's centre (over the hole, when there is one). The Bench
// attaches a child by its "mount", so the pocket faces out either way.
//
// Apple's own ring is about 54.1mm across (its Accessory Design
// Guidelines), but nothing printed carries Apple's magnets: what goes in
// the pocket is an aftermarket ring, and those come at 54 x 46, 55 x 45
// and 56 x 46mm (outside x inside), 0.5 to 2.5mm thick. insert_od and
// insert_id are the insert's real size; the pocket is FIT_CLEARANCE
// bigger all round, for a ring pressed or glued in.
//
// recess "ring" cuts an annulus and leaves the middle standing, which
// keeps a thin plate stiff and lines a ring up by itself; "disk" cuts the
// full insert_od, for a steel disk or a ring you would rather not centre
// by hand. recess_depth is the insert's thickness, to sit it flush. hole
// (a diameter, 0 for none) opens the middle right through, for a donut
// that clears a camera bump or a cable.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>

// Below three 0.2mm layers, a floor or a wall prints with gaps in it.
MAGSAFE_MIN_FLOOR = 0.6;
// The rim left round the pocket: two 0.4mm perimeters.
MAGSAFE_MIN_WALL = 0.8;

module magsafe_mount(diameter = 60, thickness = 4, recess = "none", recess_depth = 1,
                     insert_od = 56, insert_id = 46, hole = 0,
                     anchor = BOTTOM, spin = 0, orient = UP) {
    assert(recess == "none" || recess == "ring" || recess == "disk",
           "recess must be \"none\", \"ring\" or \"disk\"");
    assert(thickness >= 1, "thickness must be at least 1mm");
    assert(hole >= 0, "hole must be 0 (none) or a diameter");
    assert(hole <= diameter - 2 * MAGSAFE_MIN_WALL, "hole leaves too thin a rim");
    pocket_od = insert_od + 2 * FIT_CLEARANCE;
    pocket_id = insert_id - 2 * FIT_CLEARANCE;
    if (recess != "none") {
        assert(recess_depth > 0, "recess_depth must be more than 0");
        assert(thickness - recess_depth >= MAGSAFE_MIN_FLOOR, "recess_depth leaves too thin a floor");
        assert(pocket_od <= diameter - 2 * MAGSAFE_MIN_WALL, "diameter leaves too thin a rim round the insert");
    }
    if (recess == "ring")
        assert(insert_id > 0 && insert_id < insert_od, "insert_id must be between 0 and insert_od");
    box = [diameter, diameter, thickness];

    attachable(anchor, spin, orient, size = box,
               anchors = [mount_anchor(thickness / 2), named_anchor("bot", [0, 0, -thickness / 2], DOWN, 0)]) {
        // A side count that is a multiple of 4 puts a vertex on each axis,
        // so the mesh is exactly `diameter` across in X and Y and a resize
        // handle's ghost lands where the next render does (a $fa/$fs
        // circle's side count changes with the size; see basics/post).
        translate([0, 0, -thickness / 2]) difference() {
            cylinder(d = diameter, h = thickness, $fn = 128);
            if (recess != "none")
                translate([0, 0, -0.01]) difference() {
                    cylinder(d = pocket_od, h = recess_depth + 0.01, $fn = 128);
                    if (recess == "ring")
                        translate([0, 0, -0.01]) cylinder(d = pocket_id, h = recess_depth + 0.03, $fn = 128);
                }
            if (hole > 0)
                translate([0, 0, -0.01]) cylinder(d = hole, h = thickness + 0.02, $fn = 64);
        }
        children();
    }
}
