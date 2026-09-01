// Physical constants for every mounting system in the catalogue.
// One place, each value sourced and dated. Confidence labels ("exact" /
// "parametric") match the ones in catalogue.yaml.

// ============================================================
// Gridfinity — exact
// Source: gridfinity-rebuilt-openscad, src/core/standard.scad (MIT)
// https://github.com/kennetek/gridfinity-rebuilt-openscad
// Checked 2026-09-01 against a local clone. Values here are the ones
// actually used by that codebase, which differ slightly from the
// gridfinity.xyz spec page's rounded numbers (e.g. base height is
// 4.75 mm there, not 4.95 mm) — the reference implementation wins.
// ============================================================

GF_PITCH        = 42;        // grid pitch, x and y
GF_TOP_SIZE     = [41.5, 41.5]; // top-of-base footprint (0.5mm gap from pitch)
GF_GAP          = GF_PITCH - GF_TOP_SIZE.x; // 0.5

// Base profile: [outward offset, z] pairs, innermost point first.
// Swept as a rounded rectangle profile (offset_sweep bottom rounding).
GF_BASE_PROFILE = [[0, 0], [0.8, 0.8], [0.8, 2.6], [2.95, 4.75]];
GF_PROFILE_H    = GF_BASE_PROFILE[3][1]; // 4.75
GF_PROFILE_R    = GF_BASE_PROFILE[3][0]; // 2.95 (outward offset at top of profile)

GF_TOP_RADIUS    = 3.75;                    // corner radius at top of base
GF_BOTTOM_RADIUS = GF_TOP_RADIUS - GF_PROFILE_R; // 0.8, corner radius at bottom

GF_BRIDGE   = 2.25; // bridge slab above the profile, so profile + bridge = 1U
GF_UNIT_H   = 7;     // height unit (GF_PROFILE_H + GF_BRIDGE == GF_UNIT_H)

GF_MAGNET_R = 6.5 / 2;   // magnet pocket radius
GF_MAGNET_D = 2 + 0.2 * 2; // magnet pocket depth (magnet height + 2 layers @ 0.2mm)
GF_SCREW_R  = 3 / 2;     // M3 hole radius (through-hole, not clearance-widened)
GF_HOLE_FROM_SIDE = 8;   // hole center distance from the top-of-base edge
GF_HOLE_OFFSET    = GF_TOP_SIZE.x / 2 - GF_HOLE_FROM_SIDE; // 12.75, hole center from part center

// ============================================================
// openGrid — exact
// Source: AndyLevesque/QuackWorks openGrid/openGrid.scad, read for the
// published numbers only (that file is CC-BY-NC-SA 4.0 and is NOT
// vendored here — see README "Licensing"). Cross-checked against
// opengrid.world/guides/board/. Checked 2026-09-01.
// ============================================================

OG_PITCH        = 28;   // grid pitch, x and y
OG_THICKNESS_FULL  = 6.8;
OG_THICKNESS_LITE  = 4.0;
OG_THICKNESS_HEAVY = 13.8;
OG_TILE_INNER   = 25;   // cell opening (clear interior size)
OG_OUTSIDE_EXT  = 0.8;  // extrusion beyond the tile boundary
OG_TOP_INSET    = 2.4;  // top capture inset
OG_CHAMFER_TOP  = 0.4;
OG_CHAMFER_MID  = 1.0;

// ============================================================
// GoPro — exact
// Source: community-standard "Modular Mounting System" geometry,
// thingiverse.com/thing:2194278. Checked 2026-09-01.
// ============================================================

GP_PRONG_T      = 3.0;  // prong thickness
GP_SLOT_W       = 3.2;  // slot width (clearance for one prong)
GP_PRONG_PITCH  = 6.2;  // center-to-center prong spacing
GP_END_R        = 7.5;  // end radius (Ø15 rounded end)
GP_BOLT_R       = 5.2 / 2; // M5 clearance
GP_WIDTH_2PRONG = 9.2;  // two-prong (male) overall width
GP_WIDTH_3PRONG = 15.4; // three-prong (female) overall width

// Not part of the interchange spec (only thickness/pitch/width matter for
// the buckle fit) — these are shape choices, free to override.
GP_ARM_WIDTH = 2 * GP_END_R; // arm width, same for male and female
GP_PRONG_LEN = 13;           // prong length below the hinge block
GP_HINGE_T   = 6;            // hinge block thickness, holds the pivot bolt hole

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
// 2020 extrusion — parametric, supplier-dependent
// 20-series defaults; every dimension is meant to be overridden.
// Checked 2026-09-01.
// ============================================================

EX_PROFILE      = 20;   // profile is EX_PROFILE x EX_PROFILE
EX_SLOT_OPEN    = 6.2;
EX_CHANNEL_W    = 11.2;
EX_CHANNEL_D    = 5.8;
EX_LIP_T        = 1.9;
EX_BORE_R       = 5.2 / 2; // center bore clearance

// ============================================================
// Fit tolerance — one global slop, per BOSL2 convention.
// Positive value widens clearance fits; override at render time
// with -D FIT_CLEARANCE=... for a tighter or looser printer.
// ============================================================

FIT_CLEARANCE = 0.15;
