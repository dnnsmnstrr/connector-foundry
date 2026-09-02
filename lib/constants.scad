// Physical constants for every mounting system in the catalogue.
// One place, each value sourced and dated. Confidence labels ("exact" /
// "parametric") match the ones in catalogue.yaml.

// ============================================================
// Gridfinity — exact, and NOT duplicated here.
//
// Gridfinity dimensions live in the upstream reference implementation,
// vendored as the submodule vendor/gridfinity-rebuilt (kennetek, MIT):
//   vendor/gridfinity-rebuilt/src/core/standard.scad
// parts/gridfinity/base.scad includes that file directly and calls
// upstream's gridfinityBase(), so there is no second copy of these
// numbers to drift. Re-stating them here is what previously let this
// repo ship a base whose feet were 5.9mm undersized — the constants
// were right, the geometry built from them was not.
// ============================================================

// ============================================================
// openGrid — exact, geometry owned upstream.
//
// The cell geometry lives in vendor/QuackWorks (CC-BY-NC-SA 4.0), which
// parts/opengrid/*.scad call directly. Upstream keeps these as top-level
// customizer variables, which `use <>` does not import, so the few we
// need for a bounding box are restated here. They ARE duplicates and can
// drift — references.yaml has shape checks against upstream renders that
// fail if they do.
// ============================================================

OG_PITCH           = 28;    // grid pitch, x and y. A tile is exactly
                            // cells x pitch: no border beyond the grid.
OG_THICKNESS_FULL  = 6.8;
OG_THICKNESS_LITE  = 4.0;
OG_THICKNESS_HEAVY = 13.8;
OG_SNAP_SIZE       = 25.58; // snap envelope across its widest (the wings)
OG_SNAP_H_FULL     = 6.8;   // a full snap spans a full tile
OG_SNAP_H_LITE     = 3.4;   // ...a lite snap is half height, not lite-tile height
OG_SNAP_DIR_EXTRA  = 0.4;   // the directional variant adds this much, on +X only

// ============================================================
// GoPro — exact, interface geometry owned upstream.
//
// The buckle interface itself (Ø15 leg ends, 3mm legs, 3.5mm slits, M5
// pivot) lives in vendor/GoProScad (ridercz/GoProScad, MIT), which
// parts/gopro/*.scad call directly. Only two kinds of number live here:
//
//  1. Shape choices upstream leaves to the caller (plate size, leg
//     height, nut pocket). Free to override.
//  2. GP_LEG_T / GP_SLIT_W, which upstream keeps as file-private
//     __gopro_* variables that `use <>` does not import, so they have to
//     be restated to compute a bounding box. These two ARE a duplicate
//     of upstream and can drift — references.yaml has a shape check that
//     compares our render against upstream's and fails if they do.
// ============================================================

GP_LEG_T   = 3.0;   // == GoProScad __gopro_leg_width   (duplicate, checked)
GP_SLIT_W  = 3.5;   // == GoProScad __gopro_slit_width  (duplicate, checked)
GP_LEG_DIA = 15;    // == GoProScad __gopro_outer_diameter (duplicate, checked)

GP_BASE_T    = 3;     // mount plate thickness
GP_BASE_W    = 20;    // mount plate width
GP_LEG_H     = 17;    // leg height; upstream asserts >= 15
GP_NUT_DEPTH = 3;     // captive nut pocket depth in the far leg (0 = none)
GP_NUT_DIA   = 11.5;  // square M5 nut across corners

// ============================================================
// DeckMate — parametric, unmeasured
// No dimensioned drawing published. Prototype defaults, all editable.
// Take calipers to a real plate before trusting these. Checked 2026-09-01.
// ============================================================

DM_RAIL_LEN       = 36;
DM_WIDTH_TOP      = 20;
DM_WIDTH_BASE     = 26;
DM_RAIL_H         = 5;
DM_SLIDE_CLEARANCE = 0.3; // Innie only
DM_WALL_T         = 2.4;  // Innie only

// ============================================================
// 2020 extrusion — parametric, supplier-dependent, but no longer guessed.
//
// Real 20-series T-slot varies between suppliers, so every value here is
// meant to be overridable. The defaults are measured off NopSCADlib's
// E2020t profile, which is itself modelled from real extrusion
// (nophead/NopSCADlib, GPL-3.0 — measured against, NOT vendored and NOT
// called by any part here; see references.yaml). Measured 2026-09-01 by
// slicing a rendered E2020t, and re-measured by the extrusion2020 fit
// checks on every `make verify`, so drift shows up as a failed check
// rather than as a part that will not go in.
//
// Cross-section of one slot, from the outer face inward:
//
//     |<-- EX_RECESS_W -->|            outer face
//     +---+           +---+   ---
//     |   |  recess   |   |    | EX_RECESS_D
//     |   +--+     +--+   |   ---
//     |      | 6.2 |      |    | EX_LIP_T   (lip / slot mouth)
//     +------+     +------+   ---
//     |                   |    | EX_CHANNEL_D  (usable, at full width)
//     \                 /     |
//      \_______________/     ---   floor, sloping up at 45 deg
//     |<-- EX_CHANNEL_W ->|
// ============================================================

EX_PROFILE      = 20;      // profile is EX_PROFILE x EX_PROFILE
EX_SLOT_OPEN    = 6.2;     // slot mouth width
EX_RECESS_W     = 7.2;     // shallow recess at the outer face
EX_RECESS_D     = 0.5;     // ...and its depth
EX_CHANNEL_W    = 11.0;    // internal channel width, at the lip
EX_LIP_T        = 1.8;     // outer face to the channel ceiling

// Usable thickness in the channel AT FULL WIDTH — not the channel's
// maximum depth. The floor slopes up toward the walls at 45 degrees, so
// anything as wide as EX_CHANNEL_W only gets this much before it fouls.
// Reading the centre depth (~3.1mm) as if it were available across the
// whole width is what made the old tab head 5.65mm thick and 105mm3
// interfering — it could not be pushed into a slot at all. Parts that
// fill the channel taper their flanks at EX_FLOOR_ANGLE to follow the
// floor and can then be thicker than this.
EX_CHANNEL_D    = 2.0;
EX_FLOOR_ANGLE  = 45;      // channel floor rise, degrees from the lip plane

EX_BORE_R       = 5.2 / 2; // center bore clearance

// ============================================================
// Fit tolerance — one global slop, per BOSL2 convention.
// Positive value widens clearance fits; override at render time
// with -D FIT_CLEARANCE=... for a tighter or looser printer.
// ============================================================

FIT_CLEARANCE = 0.15;
