// 2020 aluminium T-slot extrusion — a printable stand-in for a length of
// real rail, so the fittings in this directory (tab, clip, endcap,
// corner-bracket, c-clip) have something in the catalogue and on the
// Bench to sit on, and so a short section can be printed to try them
// against.
//
// Geometry is vendor/AluminumExtrusionProfile's 2D profile (Jen Reed,
// Apache-2.0), extruded here. That library's 2020 preset is a module
// named 2020_extrusion_profile(); current OpenSCAD snapshots flag
// identifiers that start with a digit as DEPRECATED and scheduled for
// removal, so this calls the library's generic extrusion_profile() with
// the preset's numbers restated below instead. They are the library's
// own numbers, deliberately NOT EX_* from lib/constants.scad: EX_*
// describe NopSCADlib's measured E2020t, which the fittings are
// fit-checked against, and this profile is close but not the same —
// same 20mm envelope, 6.2mm slot mouth and 1.8mm lip, but a ~13mm
// channel behind the lip (E2020t: 11) with a 1.2mm deeper centre floor.
// references.yaml's extrusion2020/rail-vs-E2020t shape check records
// that gap (section IoU 0.93) rather than claiming a match.
//
// Axis convention of this family: X along the rail, Y across, Z the
// slot-insertion axis. The rail lies flat: size = [len, 20, 20].
// Functional face BOTTOM (a slot face on the bed), "mount" on TOP, plus
// a "mount_<i>_0" row along the top slot at EX_PROFILE pitch (the
// catalogue's slots.pitch) so a fitting can be attached anywhere along
// it on the Bench.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>
include <../../vendor/AluminumExtrusionProfile/AluminumExtrusionProfile.scad>

// Segment count for the profile's fillets and centre bore. A multiple of
// 4, so the 0.5mm corner-fillet circles have vertices on both axes and
// the envelope is exactly 20 x 20 (tests/test_anchors.py holds the
// declared size to the geometry within 0.001mm). At OpenSCAD's defaults
// a 0.5mm circle is a 5-gon and the profile comes out 19.90 x 19.95,
// off-centre.
EX_RAIL_FN = 32;

// The library's 2020 preset (its 2020_extrusion_profile()), verbatim.
EX_RAIL_FILLET     = 0.5;
EX_RAIL_SQUARE     = 20;
EX_RAIL_BORE_R     = 2.5;
EX_RAIL_INNER_OPEN = 11;   // hull-circle centres; the channel it cuts is ~13mm wide
EX_RAIL_OUTER_OPEN = 6.2;  // slot mouth
EX_RAIL_CHANNEL_D  = 6.1;  // outer face to channel floor, on the centreline
EX_RAIL_LIP_T      = 1.8;

module ex_rail(len = 100, slot = "t", anchor = BOTTOM, spin = 0, orient = UP) {
    assert(slot == "t" || slot == "v", "ex_rail: slot is \"t\" or \"v\"");
    assert(len > 0, "ex_rail: len must be positive");
    $fn  = EX_RAIL_FN;
    size = [len, EX_RAIL_SQUARE, EX_RAIL_SQUARE];

    attachable(anchor, spin, orient, size = size,
               anchors = concat([mount_anchor(size.z / 2)],
                                grid_mount_anchors(size, EX_PROFILE, size.z / 2))) {
        // The profile is drawn in XY and extruded along Z; rotate so the
        // rail runs along X. The profile is 4-fold symmetric, so which
        // slot lands on top is immaterial. center = true keeps the bbox
        // centred, as attachable() expects.
        rotate([0, 90, 0])
            linear_extrude(len, center = true, convexity = 8)
                extrusion_profile(slot, EX_RAIL_FILLET, EX_RAIL_SQUARE,
                                  EX_RAIL_BORE_R, EX_RAIL_INNER_OPEN,
                                  EX_RAIL_OUTER_OPEN, EX_RAIL_CHANNEL_D,
                                  EX_RAIL_LIP_T);
        children();
    }
}
