// Camera mounting: the tripod screw threads and the Arca-Swiss-style
// dovetail. Used by parts/camera/*.scad; the Holes tab's tripod nut traps
// (web/src/lib/screwPresets.js) use the nut numbers below.
//
// Tripod threads are UNC (ISO 1222): 1/4"-20 on cameras and small gear,
// 3/8"-16 on tripod heads and heavier gear. The thread itself is BOSL2's
// threaded_rod() (vendor/BOSL2, MIT), which follows the UTS profile; what
// is here is only the sizes. The nuts are ASME B18.2.2 hex nuts.
//
// The Arca-Swiss-style dovetail is no published standard, and makers
// differ by tenths of a millimetre. The numbers are Wimberley's figure of
// the geometry (tripodhead.com, "The Arca-Swiss Style Quick-Release
// Geometry"): 45° flanks, 38mm across at the plate's widest real edge,
// 41.9mm where the flanks would meet the clamp face if they ran on to a
// sharp corner. The plate is widest at the clamp; the flanks lean in
// above it and the clamp's jaws close over them. How far the flanks run
// up is not given; ARCA_FLANK_H is a few millimetres of jaw to grip, as
// common plates have.

include <constants.scad>

INCH = 25.4;

// [major diameter, pitch, hex nut across flats, nut thickness], mm.
TRIPOD_1_4 = [INCH / 4, INCH / 20, INCH * 7 / 16, INCH * 7 / 32];
TRIPOD_3_8 = [INCH * 3 / 8, INCH / 16, INCH * 9 / 16, INCH * 21 / 64];
function tripod_thread(size) =
    assert(size == "1/4" || size == "3/8", "size must be \"1/4\" or \"3/8\"")
    size == "1/4" ? TRIPOD_1_4 : TRIPOD_3_8;

ARCA_WIDTH       = 38;    // the plate's widest real edge, at the clamp face
ARCA_SHARP_WIDTH = 41.9;  // where the 45° flanks meet the clamp face
// The flanks start this far above the clamp face: where a 45° line from
// the sharp width reaches the real one.
ARCA_EDGE_H      = (ARCA_SHARP_WIDTH - ARCA_WIDTH) / 2;
ARCA_FLANK_H     = 4;     // how far the flanks run up, from ARCA_EDGE_H

// The dovetail's cross-section: x across, y up from the clamp face, for
// a plate `t` thick, each side brought in by `clearance`. Above the flanks
// the plate carries on at their top width.
function arca_profile(t, clearance = 0) =
    let (
        x0 = ARCA_WIDTH / 2 - clearance,
        top = ARCA_EDGE_H + min(ARCA_FLANK_H, t - ARCA_EDGE_H),
        x1 = x0 - (top - ARCA_EDGE_H)
    )
    [[-x0, 0], [x0, 0], [x0, ARCA_EDGE_H], [x1, top], [x1, t], [-x1, t], [-x1, top], [-x0, ARCA_EDGE_H]];
