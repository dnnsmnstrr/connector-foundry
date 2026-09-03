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
// The pocket takes a standard M5 hex nut (DIN 934: 8mm across flats,
// 9.24mm across corners) — cylinder(d=, $fn=6) is sized across corners,
// so 9.5 leaves ~0.25mm on the flats. A square M5 nut (upstream's own
// default) is nut_sides = 4 with 11.5 across corners; catalogue.yaml
// keeps that as the "square-nut" variant.
GP_NUT_SIDES = 6;
GP_NUT_DIA   = 9.5;

// ============================================================
// Basics dovetail — exact, generic geometry not tied to an external
// spec (see parts/basics/dovetail_rail.scad's header for why this
// isn't in DeckMate: it started as a guess at DeckMate's dimensions,
// was confirmed wrong against a real part, and is kept as a generic
// dovetail on its own merits instead). Nothing external to check
// these against — the only thing that has to hold is the rail and the
// channel agreeing with each other, which sharing these constants
// makes true by construction rather than something to test for.
// ============================================================

DOVETAIL_RAIL_LEN        = 36;
DOVETAIL_WIDTH_TOP       = 20;
DOVETAIL_WIDTH_BASE      = 26;
DOVETAIL_RAIL_H          = 5;
DOVETAIL_SLIDE_CLEARANCE = 0.3; // channel only
DOVETAIL_WALL_T          = 2.4; // channel only

// ============================================================
// BitBeam — exact, published spec.
//
// Numbers from the "Specification" section of https://bitbeam.cc/ —
// checked 2026-09-02. That page's own content (including its STL pack)
// is CC-BY-NC-SA 4.0 (c) Ondrej Tuma, which this repo cannot vendor
// under an MIT licence (the openGrid situation again — see "Licensing"
// in the README) — but the dimensions themselves are facts, not
// copyrightable expression, so restating them here is fine.
//
// The beam geometry is NOT reimplemented here: parts/bitbeam/beam.scad
// wraps cube_arm() from vendor/bitbeam-lib (ondratu/bitbeam-lib,
// BSD-3-Clause), a *different, separately and permissively licensed*
// OpenSCAD implementation by the same author as bitbeam.cc — its own
// `unit`/`hole` defaults already match the numbers below, and
// beam.scad reassigns them from BITBEAM_UNIT/BITBEAM_HOLE_DIA anyway so
// this section stays the one place that can change them. The plate
// (parts/bitbeam/plate.scad) is bitbeam-lib's cube_base() the same way.
// bitbeam-lib has no pin or axle; those come from technic.scad, below.
// ============================================================

BITBEAM_UNIT      = 8;    // beam cross-section and hole pitch
BITBEAM_HOLE_DIA  = 4.8;  // through-hole in a beam, LEGO Technic-compatible

// No pin or axle dimensions here on purpose: parts/bitbeam/pin.scad and
// axle.scad wrap vendor/technic.scad (cfinke, MIT), whose LEGO Technic
// pin and axle are what a BitBeam pin and axle are, and a fastener has
// to match LEGO's holes rather than this repo's restatement of them —
// so those parts take the library's numbers as-is. (pin.scad's
// BITBEAM_PIN_LEN, which the pin joint needs, is derived from them.)

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
// parts/extrusion2020/rail.scad deliberately does not use these: it
// wraps a vendored profile library with that library's own numbers, and
// references.yaml's extrusion2020/rail-vs-E2020t records how far that
// printable profile is from E2020t instead of pretending it matches.
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

// ============================================================
// DeckMate / Mechanism — measured from Mechanism's own models
// (parts/deckmate/*.stl, CC BY-NC 4.0), not designed here. The two
// models that carry the screw pattern (the Outie's base and the
// Universal plate) agree on it to 0.01mm; these are the numbers the
// generated screw flange (lib/joints.scad's deckmate_screw_flange())
// and the parts' own "mount"/"bot" anchors are built from, and
// tests/test_deckmate.py probes the rendered meshes at exactly these
// points so they cannot drift from the files.
//
// The pattern is an isosceles triangle. Its reference point is the
// midpoint between the two side holes; the third hole sits DM_SCREW_DROP
// toward -y from there. Every DeckMate part places its "mount" (and
// "bot") anchor at that reference point rather than at its bounding-box
// center, so attaching mount-to-mount lines the holes up regardless of
// each part's footprint. BOSL2's attach() flips a child 180° about Y
// (see vendor/BOSL2/attachments.scad's _attach_transform() and
// vector_axis(UP, DOWN)), which preserves y — the pattern is symmetric
// in x, so it survives every hop in a chain unmirrored.
// ============================================================
DM_SCREW_SPAN  = 29.106;   // side-hole center distance, along x
DM_SCREW_DROP  = 10.59;    // third hole, this far toward -y from the side pair's midpoint
DM_SCREW_HOLES = [[DM_SCREW_SPAN / 2, 0], [-DM_SCREW_SPAN / 2, 0], [0, -DM_SCREW_DROP]];

// Where the pattern's reference point sits relative to each part's own
// bounding-box center (x is always 0).
DM_OUTIE_PATTERN_Y     = 3.391;
DM_UNIVERSAL_PATTERN_Y = 4.896;

// The Outie's base footprint — the size deckmate_screw_flange() takes,
// so a printed flange matches the part that screws onto it.
DM_OUTIE_BASE = [35.304, 26.503];

// The holes themselves, for choosing hardware. The Outie's taper from
// its base face to its rail face means: a screw driven from the base
// side self-taps as the hole narrows (Mechanism's own scheme), an M3
// heat-set insert (4.0mm) seats in the wide end, and nothing over 2.4mm
// passes through from the rail side. The Universal's holes are plain
// through-holes with a countersink on the adhesive side.
DM_OUTIE_HOLE_D_BASE    = 4.45;
DM_OUTIE_HOLE_D_RAIL    = 2.4;
DM_UNIVERSAL_HOLE_D     = 2.98;
DM_UNIVERSAL_CSK_D      = 4.96;
