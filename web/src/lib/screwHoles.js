// The Holes tab's document and its OpenSCAD codegen: a base model (a
// catalogue part with parameters, or a mesh the user brought in) and a
// list of holes cut into it, each at a point on its surface along that
// surface's normal. No React in here — Holes.jsx wires state to these,
// the same split assembly.js/Bench.jsx have.
//
// A hole:
//   { id, point: [x,y,z], normal: [nx,ny,nz], spec, presetId }
// `point` is on the surface, in the base model's own coordinates (the
// frame the rendered STL is in — for a catalogue part that is where
// its module puts it, for a mesh the file's own frame); `normal` is
// the outward normal of the face it sits on, so the hole is cut along
// -normal. `spec.kind` says what kind of hole:
//
// "screw" — a screw hole:
//   diameter      shank hole diameter (mm)
//   depth         0 = through the whole model, else a blind hole this deep
//   head          "none" | "counterbore" | "countersink" | "hex"
//   headDiameter  the pocket's diameter (hex: across corners)
//   headDepth     how far the pocket goes below the surface (a
//                 countersink's extra sink on top of its cone)
//   sinkAngle     a countersink's included angle (82 or 90, usually)
//
// "openconnect" — an openConnect slot (lib/openconnect.scad's oc_slot()),
// the keyhole an openConnect snap's head slides into. The point is the
// centre of the openGrid cell the snap sits in; the geometry is upstream's.
//   lock            which side gets the lock nub: "left" | "right" | "both" | "none"
//   sideClearance   mm added around the head, per side
//   depthClearance  mm added under its pocket
//   spin            degrees the slot is turned on its face (see slotFrame())
//
// "multiconnect" — a MultiConnect slot (lib/multiconnect.scad's mc_slot()).
// The point is the round end the head rests in.
//   length     mm of channel from the round end to the entry
//   onRamp     a funnel at the entry end to push the head in through
//   rampEvery  with onRamp, a funnel every RAMP_SPACING_MM down the
//              channel too — for an item on a column of heads one
//              openGrid cell apart, pushed on all at once and slid down
//              one cell (lib/multiconnect.scad's mc_slot() ramp_spacing)
//   detent     the v2 detent that clicks a seated head in
//   clearance  mm added to every radius
//   spin       as above
//
// "thread" — openGrid's female snap thread (lib/ogthread.scad's
// og_thread_hole()): Ø16 at 3 mm pitch, what the openGrid threaded snaps
// have, so the openConnect and MultiConnect screws (those parts' body
// "screw") screw into the model. The point is the thread's axis.
//   depth      how deep the thread runs; 0 = through
//   clearance  mm added to the 16 mm diameter (upstream's 0.5 makes its
//              official 16.5)
//   spin       which way the screwed-in head's +Y points — up, for an
//              openConnect head, the way it seats a slotted item — as for
//              a slot; the thread's start is turned to match
//
// "cylinder" — a plain round cutout:
//   diameter   mm
//   depth      0 = through, else a pocket this deep
//
// "rectangle" — a rectangular cutout, its corners rounded (a corner
// radius of half the narrower side makes it a pill, a slot with round
// ends; anything more is cut as that):
//   width         mm across, along the face's sideways
//   height        mm along its direction (`spin`)
//   cornerRadius  mm; 0 = sharp corners
//   depth         0 = through, else a pocket this deep
//   spin          degrees it is turned on its face, as for a slot
//
// "extrusion" — a socket the end of a 2020 aluminium extrusion pushes
// into, along the hole's axis (lib/exsocket.scad's ex_socket()): the
// 20 mm square, and optionally a key into each of its slots so the rail
// can't turn. The point is the rail's axis.
//   depth      how far the rail goes in; 0 = through
//   clearance  mm added per side (and taken off each key)
//   keys       the keys into the four slot mouths
//   spin       which way the square is turned on its face, as for a slot
//
// The slots and the thread are the openGrid connector cuts
// (isConnector()): all three come from this repo's libraries and have a
// direction on their face. A rectangle and a 2020 socket have a
// direction too (hasDirection()), but need no BOSL2.
//
// `presetId` is screwPresets.js's label for where the spec came from.
//
// The generated .scad is `difference() { <base>; <one cutter per hole> }`,
// each cutter a multmatrix() whose columns are an orthonormal frame with
// +Z along the hole's outward normal, so every cutter is written once,
// in a local frame where the surface is z=0 and material is below it. A
// screw hole's in-plane axes are arbitrary (planeBasis()); a slot's are
// not — its +Y is the direction the head travels to seat, "up" on the
// wall — so those come from slotFrame(), as a thread's do (its +Y is
// where a screwed-in head's points).
import { callArgs, scadLiteral } from "./scadLiteral.js";
import { safeStem } from "./benchName.js";
import { presetSpecFor } from "./screwPresets.js";

// How far a cutter reaches past the surface it enters through, so the
// cut's top face never coincides with the model's (Manifold handles
// coplanar faces, but a clean overshoot keeps the result unambiguous).
const OVERSHOOT_MM = 1;
// Facets on a round cutter. 64 keeps an M3 hole round to ~0.01 mm.
const ROUND_FN = 64;

export const HOLE_KINDS = ["screw", "openconnect", "multiconnect", "thread", "cylinder", "rectangle", "extrusion"];
export const LOCK_SIDES = ["left", "right", "both", "none"];

export const DEFAULT_SPEC = Object.freeze({
  kind: "screw",
  diameter: 3.4,
  depth: 0,
  head: "counterbore",
  headDiameter: 6.1,
  headDepth: 3,
  sinkAngle: 90,
});

// The slots' footprints, for the viewer's outline and the "is there a
// hole here already" radius — restated from lib/openconnect.scad's
// upstream numbers (with its default 0.1 mm clearances) and
// lib/constants.scad's MC_*. Drawing only; the cut is OpenSCAD's.
export const OPENCONNECT_FOOTPRINT = Object.freeze({
  halfWidth: 8.6, // the pocket and channel, across
  top: 9.0, // the pocket's far (+Y) edge…
  chamfer: 4.1, // …with its corners cut this much
  bottom: -13.2, // the channel's entry end
  // The entry opening at the surface, where the head drops in: wider,
  // and off to the left (the head comes in on its taper).
  entry: { left: -13.0, right: 5.8, top: -0.8, bottom: -13.2 },
});
// The spacing of a MultiConnect slot's extra on-ramps (`rampEvery`): one
// openGrid cell, lib/constants.scad's OG_PITCH — the spacing of the heads
// on the board that the item hangs on.
export const RAMP_SPACING_MM = 28;

export const MULTICONNECT_FOOTPRINT = Object.freeze({
  radius: 10.15, // the round end and the channel's half width
  onRamp: 11.7, // the funnel's radius at the surface
});

// A 2020 socket's numbers (lib/constants.scad's EX_PROFILE, EX_SLOT_OPEN,
// and EX_LIP_T + EX_CHANNEL_D, the keys' reach in from the face), for the
// viewer's outline. Drawing only; the cut is lib/exsocket.scad's.
export const EXTRUSION = Object.freeze({ profile: 20, slotOpen: 6.2, keyReach: 3.8, clearance: 0.15 });

// The thread's numbers (lib/constants.scad's OG_THREAD_*, OG_SNAP_H_*):
// its diameter before clearance, and how long a screw's thread is — a
// full-size screw's, and a lite one's — which a hole has to be at least.
export const THREAD = Object.freeze({ diameter: 16, clearance: 0.5, fullLength: 6.8, liteLength: 3.4 });

let nextHoleId = 1;

// `source`: { kind: "catalogue", partId, params } or
//           { kind: "mesh", name, geometry, flip, stlBytes, extents } —
//           `stlBytes`/`extents` are the grounded (and, with `flip`,
//           turned-over) form of `geometry` (importedPart.js's
//           groundedMesh()); `geometry` is kept so the flip can be redone.
export function createHolesDoc(source, name = null) {
  return { source, holes: [], name, nextSpec: { ...DEFAULT_SPEC }, nextPresetId: "m3-cap" };
}

export function isSlot(spec) {
  return spec?.kind === "openconnect" || spec?.kind === "multiconnect";
}

// A slot or the openGrid thread: cut by this repo's own libraries, and
// pointing a way on its face (`spin`).
export function isConnector(spec) {
  return isSlot(spec) || spec?.kind === "thread";
}

// Anything turned on its face by `spin`: the connectors, a rectangle and
// a 2020 socket. What the quarter-turn buttons turn and a flip turns
// over with the part.
export function hasDirection(spec) {
  return isConnector(spec) || spec?.kind === "rectangle" || spec?.kind === "extrusion";
}

// A rectangle's corner radius as cut: never more than half its narrower
// side, which is the pill.
export function effectiveCornerRadius(spec) {
  return Math.min(spec.cornerRadius, spec.width / 2, spec.height / 2);
}

export function isPill(spec) {
  return spec.kind === "rectangle" && spec.cornerRadius > 0 && spec.cornerRadius >= Math.min(spec.width, spec.height) / 2 - 1e-9;
}

export function normalizeSpec(spec) {
  const n = (v, fallback, min = 0) => {
    const num = Number(v);
    return Number.isFinite(num) && num >= min ? num : fallback;
  };
  const kind = HOLE_KINDS.includes(spec?.kind) ? spec.kind : "screw";
  if (kind === "openconnect") {
    return {
      kind,
      lock: LOCK_SIDES.includes(spec?.lock) ? spec.lock : "left",
      sideClearance: n(spec?.sideClearance, 0.1),
      depthClearance: n(spec?.depthClearance, 0.1),
      spin: normalizeSpin(spec?.spin),
    };
  }
  if (kind === "thread") {
    return {
      kind,
      depth: n(spec?.depth, 8),
      clearance: n(spec?.clearance, THREAD.clearance),
      spin: normalizeSpin(spec?.spin),
    };
  }
  if (kind === "cylinder") {
    return {
      kind,
      diameter: Math.max(0.1, n(spec?.diameter, 10)),
      depth: n(spec?.depth, 0),
    };
  }
  if (kind === "extrusion") {
    return {
      kind,
      depth: n(spec?.depth, 15),
      clearance: n(spec?.clearance, EXTRUSION.clearance),
      keys: spec?.keys !== false,
      spin: normalizeSpin(spec?.spin),
    };
  }
  if (kind === "rectangle") {
    return {
      kind,
      width: Math.max(0.1, n(spec?.width, 20)),
      height: Math.max(0.1, n(spec?.height, 10)),
      cornerRadius: n(spec?.cornerRadius, 0),
      depth: n(spec?.depth, 0),
      spin: normalizeSpin(spec?.spin),
    };
  }
  if (kind === "multiconnect") {
    return {
      kind,
      length: Math.max(1, n(spec?.length, 28)),
      onRamp: spec?.onRamp !== false,
      rampEvery: spec?.rampEvery === true,
      detent: spec?.detent !== false,
      clearance: n(spec?.clearance, 0),
      spin: normalizeSpin(spec?.spin),
    };
  }
  const head = ["none", "counterbore", "countersink", "hex"].includes(spec?.head) ? spec.head : "none";
  return {
    kind,
    diameter: Math.max(0.1, n(spec?.diameter, DEFAULT_SPEC.diameter)),
    depth: n(spec?.depth, 0),
    head,
    headDiameter: n(spec?.headDiameter, 0),
    headDepth: n(spec?.headDepth, 0),
    sinkAngle: Math.min(179, Math.max(10, n(spec?.sinkAngle, 90))),
  };
}

// Degrees, kept in [0, 360) — a slot turned a full circle is the slot.
function normalizeSpin(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return 0;
  const wrapped = ((num % 360) + 360) % 360;
  return Math.round(wrapped * 1e4) / 1e4;
}

export function addHole(doc, { point, normal, spec, presetId }) {
  const hole = {
    id: `h${nextHoleId++}`,
    point: point.map(Number),
    normal: unit(normal),
    spec: normalizeSpec(spec ?? doc.nextSpec),
    presetId: presetId ?? doc.nextPresetId ?? null,
  };
  return { doc: { ...doc, holes: [...doc.holes, hole] }, hole };
}

export function removeHole(doc, id) {
  return { ...doc, holes: doc.holes.filter((h) => h.id !== id) };
}

// Several at once — the Holes tab's multi-selection (Shift-click).
export function removeHoles(doc, ids) {
  const gone = new Set(ids);
  return { ...doc, holes: doc.holes.filter((h) => !gone.has(h.id)) };
}

// What `holes` have in common, for editing them together: `kind` when
// they are all one kind (else null — a screw hole and a slot share no
// fields), `spec` with every field they agree on, `mixed` the fields
// they don't (left out of `spec`), and `presetId` when they were all
// placed from the same preset.
export function sharedSpec(holes) {
  if (!holes.length) return { kind: null, spec: {}, mixed: new Set(), presetId: null };
  const kinds = new Set(holes.map((h) => h.spec.kind));
  const presets = new Set(holes.map((h) => h.presetId));
  const presetId = presets.size === 1 ? holes[0].presetId : null;
  if (kinds.size !== 1) return { kind: null, spec: {}, mixed: new Set(), presetId };
  const spec = {};
  const mixed = new Set();
  for (const key of Object.keys(holes[0].spec)) {
    const first = holes[0].spec[key];
    if (holes.every((h) => h.spec[key] === first)) spec[key] = first;
    else mixed.add(key);
  }
  return { kind: holes[0].spec.kind, spec, mixed, presetId };
}

// Set the fields in `patch` on every hole in `ids`, leaving each
// hole's other fields as they are. Only meaningful when the holes are
// all one kind (sharedSpec()); a field another kind doesn't have is
// dropped by normalizeSpec().
export function patchHoles(doc, ids, patch) {
  const targets = new Set(ids);
  return {
    ...doc,
    holes: doc.holes.map((h) => (targets.has(h.id) ? { ...h, spec: normalizeSpec({ ...h.spec, ...patch }) } : h)),
  };
}

// Turn every slot (or thread, or rectangle) in `ids` by `delta` degrees
// from its own direction, so ones pointing different ways keep their
// difference. Round holes have no direction and are left alone.
export function rotateHoles(doc, ids, delta) {
  const targets = new Set(ids);
  return {
    ...doc,
    holes: doc.holes.map((h) => (targets.has(h.id) && hasDirection(h.spec) ? { ...h, spec: normalizeSpec({ ...h.spec, spin: h.spec.spin + delta }) } : h)),
  };
}

// Give every hole in `ids` a preset's spec (picked with several
// selected): each keeps its place, and — through screwPresets.js's
// presetSpecFor() — what it shares with the preset that isn't what
// makes the preset itself (a slot's channel length, gaps, direction).
export function setHolesSpec(doc, ids, presetSpec, presetId) {
  const targets = new Set(ids);
  return {
    ...doc,
    holes: doc.holes.map((h) => (targets.has(h.id) ? { ...h, spec: normalizeSpec(presetSpecFor(h.spec, presetSpec)), presetId } : h)),
  };
}

export function getHole(doc, id) {
  return doc.holes.find((h) => h.id === id) ?? null;
}

export function updateHole(doc, id, patch) {
  return {
    ...doc,
    holes: doc.holes.map((h) => {
      if (h.id !== id) return h;
      const next = { ...h, ...patch };
      if (patch.spec) next.spec = normalizeSpec(patch.spec);
      if (patch.point) next.point = patch.point.map(Number);
      if (patch.normal) next.normal = unit(patch.normal);
      return next;
    }),
  };
}

// The spec every hole placed from now on gets (the sidebar's "New holes"
// editor), remembered on the document so it survives a tab switch.
export function setNextSpec(doc, spec, presetId) {
  return { ...doc, nextSpec: normalizeSpec(spec), nextPresetId: presetId ?? doc.nextPresetId ?? null };
}

// The holes after the mesh they sit on is turned over (groundedMesh()'s
// `flip`): a half turn about X, then the mesh re-grounded, which for a
// mesh of height `height` standing on z = 0 is p -> (x, -y, height - z)
// and n -> (nx, -ny, -nz). Every hole stays on the same spot of the
// same face, so the holes a user placed before deciding the part was
// upside down are not lost. A slot also keeps pointing the same way
// along its part: the face's default "up" is a world direction, and
// the half turn sends the part's own up the other way, so the slot's
// spin takes a half turn with it. Its own inverse.
export function flipHoles(doc, height) {
  return {
    ...doc,
    holes: doc.holes.map((h) => ({
      ...h,
      point: [h.point[0], -h.point[1], height - h.point[2]],
      normal: [h.normal[0], -h.normal[1], -h.normal[2]],
      spec: hasDirection(h.spec) ? { ...h.spec, spin: normalizeSpin(h.spec.spin + 180) } : h.spec,
    })),
  };
}

export function setDocName(doc, name) {
  return { ...doc, name };
}

// The hole within `toleranceMm` of `point`, if any — a click on a face
// spot that already has one selects it instead of drilling a second
// hole through the first.
export function findHoleNear(doc, point, toleranceMm) {
  return doc.holes.find((h) => distance(h.point, point) < toleranceMm) ?? null;
}

// How far from its point a hole reaches, in the plane: what the
// "already a hole here" test and the marker ring (plus its margin) use.
export function holeFootprintRadius(spec) {
  if (spec.kind === "openconnect") return OPENCONNECT_FOOTPRINT.halfWidth;
  if (spec.kind === "multiconnect") return MULTICONNECT_FOOTPRINT.radius + spec.clearance;
  if (spec.kind === "thread") return (THREAD.diameter + spec.clearance) / 2;
  if (spec.kind === "cylinder") return spec.diameter / 2;
  if (spec.kind === "rectangle") return Math.hypot(spec.width, spec.height) / 2;
  if (spec.kind === "extrusion") return ((EXTRUSION.profile + 2 * spec.clearance) / 2) * Math.SQRT2;
  return Math.max(spec.diameter, spec.headDiameter) / 2;
}

// --- codegen -----------------------------------------------------------

// `throughLength`: how deep a "through" hole reaches — anything past the
// model's far side (the caller passes the base's bounding-box diagonal).
// `extents`, when given (the base's bounding box), lets a through thread
// stop at the box's width along its axis instead: a thread's cost grows
// with its length, and the diagonal can be many times the material.
// `importedFiles`, when given, receives the mesh bytes a mesh source
// needs mounted beside the generated file (same contract as
// assembly.js's compileToScad()).
export function holesToScad(doc, partsById, { throughLength, extents, importedFiles } = {}) {
  const { source, holes } = doc;
  const through = Math.max(1, throughLength ?? 1000);
  const lines = ["// Generated by Connector Foundry — Holes tab.", `// ${holes.length} hole${holes.length === 1 ? "" : "s"} on ${sourceLabel(source, partsById)}.`];

  let base;
  if (source.kind === "catalogue") {
    const part = partsById.get(source.partId);
    if (!part) throw new Error(`Unknown catalogue part ${source.partId}`);
    lines.push(`include <../${part.file}>`);
    base = `${part.module}(${callArgs(source.params)});`;
  } else {
    const path = meshPath(source);
    if (importedFiles) importedFiles.set(path, source.stlBytes);
    base = `import(${JSON.stringify(path)});`;
  }
  // The connector slots come from this repo's own libraries, which the
  // generated file reaches the same way it reaches the part. Both are
  // BOSL2 underneath — oc_slot() openly, mc_slot() because BOSL2
  // replaces OpenSCAD's own cylinder() with its attachable one in any
  // file that includes it — and BOSL2 only works when std.scad is
  // *included* by the top-level file: its tag machinery reads special
  // variables ($tags_shown, …) that std.scad sets at file scope, and a
  // `use` does not carry those into the call. A catalogue part's own
  // include usually brings it in; a mesh source has nothing, and a slot
  // failed there with "Assertion is_list($tags_shown)". So include it
  // whenever a slot is on the model — or a thread, which is BOSL2's
  // thread_helix().
  if (holes.some((h) => isConnector(h.spec))) lines.push("include <../vendor/BOSL2/std.scad>");
  if (holes.some((h) => h.spec.kind === "openconnect")) lines.push("use <../lib/openconnect.scad>");
  if (holes.some((h) => h.spec.kind === "multiconnect")) lines.push("use <../lib/multiconnect.scad>");
  if (holes.some((h) => h.spec.kind === "thread")) lines.push("use <../lib/ogthread.scad>");
  if (holes.some((h) => h.spec.kind === "extrusion")) lines.push("use <../lib/exsocket.scad>");

  lines.push("", `$fn = ${ROUND_FN};`, "");
  if (holes.length === 0) {
    lines.push(base, "");
    return lines.join("\n");
  }
  lines.push("difference() {", `    ${base}`);
  holes.forEach((hole, i) => {
    lines.push("", `    // hole ${i + 1}: ${holeLabel(hole)} at [${hole.point.map(fmt).join(", ")}]`);
    lines.push(...cutterLines(hole, through, extents).map((l) => `    ${l}`));
  });
  lines.push("}", "");
  return lines.join("\n");
}

// Where a mesh source's bytes are mounted beside the generated file.
export function meshPath(source) {
  return `imports/${sourceStem(source)}.stl`;
}

export function sourceLabel(source, partsById) {
  if (source.kind === "catalogue") return partsById?.get(source.partId)?.name ?? source.partId;
  return source.name;
}

// The source's name as a file stem: the part's name, or the mesh's
// file name with its own extension dropped (so a STEP import's exports
// are "bracket_holes.stl", not "bracket.step_holes.stl"). What the
// exports are called when the document has no name of its own.
export function sourceStem(source, partsById) {
  const label = sourceLabel(source, partsById) || "mesh";
  return safeStem(label.replace(/\.(stl|step|stp|3mf)$/i, "")) || "mesh";
}

// "M3 socket cap" / "Ø3.4 counterbore Ø6.1×3" / "openConnect slot, lock
// left, 90°" — a short description for the hole list and the generated
// comments.
export function holeLabel(hole, presetName = null) {
  if (presetName) return presetName;
  const s = hole.spec;
  if (s.kind === "openconnect") {
    const lock = s.lock === "none" ? "no lock" : `lock ${s.lock}`;
    return `openConnect slot, ${lock}${s.spin ? `, ${fmt(s.spin)}°` : ""}`;
  }
  if (s.kind === "multiconnect") {
    const bits = [`MultiConnect slot ${fmt(s.length)} long`];
    if (!s.onRamp) bits.push("open-ended");
    else if (s.rampEvery) bits.push(`on-ramps every ${RAMP_SPACING_MM}`);
    if (!s.detent) bits.push("no detent");
    if (s.spin) bits.push(`${fmt(s.spin)}°`);
    return bits.join(", ");
  }
  if (s.kind === "thread") {
    return `openGrid thread ${s.depth > 0 ? `${fmt(s.depth)} deep` : "through"}${s.spin ? `, ${fmt(s.spin)}°` : ""}`;
  }
  const depth = s.depth > 0 ? `${fmt(s.depth)} deep` : "through";
  if (s.kind === "cylinder") return `Round Ø${fmt(s.diameter)} ${depth}`;
  if (s.kind === "extrusion") return `2020 socket ${depth}${s.keys ? ", keyed" : ""}${s.spin ? `, ${fmt(s.spin)}°` : ""}`;
  if (s.kind === "rectangle") {
    const bits = [`${isPill(s) ? "Pill" : "Rectangle"} ${fmt(s.width)}×${fmt(s.height)}`];
    if (s.cornerRadius > 0 && !isPill(s)) bits.push(`r${fmt(s.cornerRadius)}`);
    bits.push(depth);
    if (s.spin) bits.push(`${fmt(s.spin)}°`);
    return bits.join(", ");
  }
  const parts = [`Ø${fmt(s.diameter)}`];
  if (s.depth > 0) parts.push(`×${fmt(s.depth)} deep`);
  else parts.push("through");
  if (s.head === "counterbore") parts.push(`counterbore Ø${fmt(s.headDiameter)}×${fmt(s.headDepth)}`);
  if (s.head === "countersink") parts.push(`countersink Ø${fmt(s.headDiameter)} ${fmt(s.sinkAngle)}°`);
  if (s.head === "hex") parts.push(`hex pocket ${fmt(s.headDiameter)}×${fmt(s.headDepth)}`);
  return parts.join(" ");
}

// The one-line summary under a hole's name in the list: how deep a
// screw hole goes, which way a slot points (a thread, a rectangle: both).
export function holeMeta(hole) {
  const s = hole.spec;
  if (s.kind === "thread" || s.kind === "rectangle" || s.kind === "extrusion") return `${s.depth > 0 ? `${fmt(s.depth)} mm deep` : "through"}, turned ${fmt(s.spin)}°`;
  if (isSlot(s)) return `turned ${fmt(s.spin)}°`;
  return s.depth > 0 ? `${fmt(s.depth)} mm deep` : "through";
}

// The cutter for one hole in its own frame (+Z = outward normal, the
// surface at z = 0), wrapped in the multmatrix that puts it on the model.
export function cutterLines(hole, throughLength, extents = null) {
  const s = hole.spec;
  const body = [];
  let m;
  if (s.kind === "openconnect") {
    body.push(`oc_slot(lock = ${JSON.stringify(s.lock)}, side_clearance = ${fmt(s.sideClearance)}, depth_clearance = ${fmt(s.depthClearance)}, overshoot = ${fmt(OVERSHOOT_MM)});`);
    m = slotFrameMatrix(hole);
  } else if (s.kind === "multiconnect") {
    // An on-ramp every openGrid cell is lib/multiconnect.scad's
    // ramp_spacing (OG_PITCH there; restated here, since the generated
    // file only `use`s that library and can't see its constants).
    const ramps = s.onRamp && s.rampEvery ? `, ramp_spacing = ${RAMP_SPACING_MM}` : "";
    body.push(`mc_slot(length = ${fmt(s.length)}, on_ramp = ${s.onRamp}, detent = ${s.detent}, clearance = ${fmt(s.clearance)}, overshoot = ${fmt(OVERSHOOT_MM)}${ramps});`);
    m = slotFrameMatrix(hole);
  } else if (s.kind === "thread") {
    // In the slot's frame, so the thread starts where a screwed-in
    // head ends up pointing the slot's +Y.
    const through = extents ? Math.min(throughLength, widthAlong(hole.normal, extents) + OVERSHOOT_MM) : throughLength;
    body.push(`og_thread_hole(depth = ${fmt(s.depth > 0 ? s.depth : through)}, clearance = ${fmt(s.clearance)}, overshoot = ${fmt(OVERSHOOT_MM)});`);
    m = slotFrameMatrix(hole);
  } else if (s.kind === "extrusion") {
    const depth = s.depth > 0 ? s.depth : throughLength;
    body.push(`ex_socket(depth = ${fmt(depth)}, clearance = ${fmt(s.clearance)}, keys = ${s.keys}, overshoot = ${fmt(OVERSHOOT_MM)});`);
    m = slotFrameMatrix(hole);
  } else if (s.kind === "cylinder") {
    const depth = s.depth > 0 ? s.depth : throughLength;
    body.push(`translate([0, 0, ${fmt(-depth)}]) cylinder(d = ${fmt(s.diameter)}, h = ${fmt(depth + OVERSHOOT_MM)});`);
    m = frameMatrix(hole.point, hole.normal);
  } else if (s.kind === "rectangle") {
    // Extruded from its outline: sharp corners a square, rounded ones the
    // hull of a circle in each corner — which a pill's radius (half the
    // narrower side) collapses to two, with no zero-width square for
    // offset() to choke on.
    const depth = s.depth > 0 ? s.depth : throughLength;
    const r = effectiveCornerRadius(s);
    const outline =
      r > 0
        ? `hull() for (x = [${fmt(-(s.width / 2 - r))}, ${fmt(s.width / 2 - r)}], y = [${fmt(-(s.height / 2 - r))}, ${fmt(s.height / 2 - r)}]) translate([x, y]) circle(r = ${fmt(r)});`
        : `square([${fmt(s.width)}, ${fmt(s.height)}], center = true);`;
    body.push(`translate([0, 0, ${fmt(-depth)}]) linear_extrude(height = ${fmt(depth + OVERSHOOT_MM)}) ${outline}`);
    m = slotFrameMatrix(hole);
  } else {
    const depth = s.depth > 0 ? s.depth : throughLength;
    body.push(`translate([0, 0, ${fmt(-depth)}]) cylinder(d = ${fmt(s.diameter)}, h = ${fmt(depth + OVERSHOOT_MM)});`);
    if (s.head === "counterbore" && s.headDiameter > 0 && s.headDepth > 0) {
      body.push(`translate([0, 0, ${fmt(-s.headDepth)}]) cylinder(d = ${fmt(s.headDiameter)}, h = ${fmt(s.headDepth + OVERSHOOT_MM)});`);
    } else if (s.head === "hex" && s.headDiameter > 0 && s.headDepth > 0) {
      body.push(`translate([0, 0, ${fmt(-s.headDepth)}]) cylinder(d = ${fmt(s.headDiameter)}, h = ${fmt(s.headDepth + OVERSHOOT_MM)}, $fn = 6);`);
    } else if (s.head === "countersink" && s.headDiameter > s.diameter) {
      const cone = countersinkConeHeight(s);
      body.push(`translate([0, 0, ${fmt(-s.headDepth - cone)}]) cylinder(d1 = ${fmt(s.diameter)}, d2 = ${fmt(s.headDiameter)}, h = ${fmt(cone)});`);
      body.push(`translate([0, 0, ${fmt(-s.headDepth)}]) cylinder(d = ${fmt(s.headDiameter)}, h = ${fmt(s.headDepth + OVERSHOOT_MM)});`);
    }
    m = frameMatrix(hole.point, hole.normal);
  }
  return [
    `multmatrix(${m}) {`,
    ...body.map((l) => `    ${l}`),
    "}",
  ];
}

// How wide a box of `extents` is along unit direction `n` — the most any
// line in that direction can run inside it (each axis bounds the run to
// extents[i] / |n[i]|, and this sum is at least the smallest of those).
function widthAlong(n, extents) {
  return Math.abs(n[0]) * extents[0] + Math.abs(n[1]) * extents[1] + Math.abs(n[2]) * extents[2];
}

// Height of a countersink's cone: from the shank diameter out to the
// head diameter at the included angle.
export function countersinkConeHeight(spec) {
  const halfAngle = (spec.sinkAngle / 2) * (Math.PI / 180);
  return (spec.headDiameter - spec.diameter) / 2 / Math.tan(halfAngle);
}

// An orthonormal frame with +Z along `normal`, as an OpenSCAD 4x4
// matrix literal (columns u, v, n, point).
export function frameMatrix(point, normal) {
  const { u, v, n } = planeBasis(normal);
  return matrixLiteral(u, v, n, point);
}

function slotFrameMatrix(hole) {
  const { ex, ey, n } = slotFrame(hole.point, hole.normal, hole.spec.spin);
  return matrixLiteral(ex, ey, n, hole.point);
}

function matrixLiteral(x, y, z, point) {
  const row = (i) => `[${fmt(x[i])}, ${fmt(y[i])}, ${fmt(z[i])}, ${fmt(point[i])}]`;
  return `[${row(0)}, ${row(1)}, ${row(2)}, [0, 0, 0, 1]]`;
}

// u, v, n for a plane with outward normal `normal` — the same choice of
// in-plane axes faceCluster.js makes, so a face's 2D frame is the same
// wherever it is computed.
export function planeBasis(normal) {
  const n = unit(normal);
  const arbitrary = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(arbitrary, n));
  const v = unit(cross(n, u));
  return { u, v, n };
}

// A slot's frame on its face: ez is the outward normal, ey — the slot's
// own +Y, the way the head travels to seat, "up" on the wall — is the
// face's "up" turned by `spin` degrees (counter-clockwise, seen from
// outside the face), and ex completes a right-handed frame. The face's
// up is world up wherever that means something: +Z projected onto the
// face, so a slot on any wall-like face — a box's side, whichever way
// it faces — points straight up, the way it hangs. A face too close to
// level for that (its normal within 30° of ±Z: a plate lying on the
// bed) uses +Y instead, so the slot runs along the plate's Y, which is
// up once the plate is on the wall; failing both, +X.
export function slotFrame(point, normal, spin = 0) {
  const n = unit(normal);
  let up = null;
  for (const candidate of [[0, 0, 1], [0, 1, 0], [1, 0, 0]]) {
    const along = dot(candidate, n);
    const inPlane = [candidate[0] - along * n[0], candidate[1] - along * n[1], candidate[2] - along * n[2]];
    if (Math.hypot(...inPlane) > 0.5) {
      up = unit(inPlane);
      break;
    }
  }
  const ex0 = unit(cross(up, n));
  const a = ((Number(spin) || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ex = ex0.map((_, i) => c * ex0[i] + s * up[i]);
  const ey = ex0.map((_, i) => -s * ex0[i] + c * up[i]);
  return { ex, ey, n };
}

// A slot's outline on its face, as line segments in the model's
// coordinates, for the viewer: the channel and pocket (or round end),
// the entry (dashed), and an arrow the way the head travels to seat. A
// thread's is its bore, with the arrow the way a screwed-in head's +Y
// points. A rectangle's, and a 2020 socket's, is just its outline — the
// shape already shows which way it is turned.
export function slotOutline(hole) {
  const s = hole.spec;
  if (!hasDirection(s)) return [];
  const { ex, ey } = slotFrame(hole.point, hole.normal, s.spin);
  const to3 = ([x, y]) => [hole.point[0] + ex[0] * x + ey[0] * y, hole.point[1] + ex[1] * x + ey[1] * y, hole.point[2] + ex[2] * x + ey[2] * y];
  const segments = [];
  const loop = (points, dashed = false) => {
    for (let i = 0; i < points.length; i++) {
      segments.push({ a: to3(points[i]), b: to3(points[(i + 1) % points.length]), dashed });
    }
  };
  const polyline = (points, dashed = false) => {
    for (let i = 0; i + 1 < points.length; i++) segments.push({ a: to3(points[i]), b: to3(points[i + 1]), dashed });
  };
  const arc = (cx, cy, r, from, to, steps = 24) => {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return out;
  };
  if (s.kind === "rectangle") {
    const r = effectiveCornerRadius(s);
    const a = s.width / 2 - r;
    const b = s.height / 2 - r;
    if (r > 0) {
      loop([
        ...arc(a, b, r, 0, Math.PI / 2, 8),
        ...arc(-a, b, r, Math.PI / 2, Math.PI, 8),
        ...arc(-a, -b, r, Math.PI, (3 * Math.PI) / 2, 8),
        ...arc(a, -b, r, (3 * Math.PI) / 2, 2 * Math.PI, 8),
      ]);
    } else loop([[-a, -b], [a, -b], [a, b], [-a, b]]);
    return segments;
  }
  if (s.kind === "extrusion") {
    // The square, notched by each key: round the four sides, a notch
    // in the middle of each.
    const h = EXTRUSION.profile / 2 + s.clearance;
    const k = s.keys ? EXTRUSION.slotOpen / 2 - s.clearance : 0;
    const inner = EXTRUSION.profile / 2 - EXTRUSION.keyReach;
    const side = [];
    for (let q = 0; q < 4; q++) {
      const turn = ([x, y]) => [[x, y], [-y, x], [-x, -y], [y, -x]][q];
      const points = s.keys ? [[h, -h], [h, -k], [inner, -k], [inner, k], [h, k]] : [[h, -h]];
      side.push(...points.map(turn));
    }
    loop(side);
    return segments;
  }
  if (s.kind === "thread") {
    loop(arc(0, 0, (THREAD.diameter + s.clearance) / 2, 0, 2 * Math.PI, 48).slice(0, -1));
  } else if (s.kind === "openconnect") {
    const f = OPENCONNECT_FOOTPRINT;
    loop([
      [-f.halfWidth, f.bottom],
      [f.halfWidth, f.bottom],
      [f.halfWidth, f.top - f.chamfer],
      [f.halfWidth - f.chamfer, f.top],
      [-(f.halfWidth - f.chamfer), f.top],
      [-f.halfWidth, f.top - f.chamfer],
    ]);
    const e = f.entry;
    loop([[e.left, e.bottom], [e.right, e.bottom], [e.right, e.top], [e.left, e.top]], true);
  } else {
    const f = MULTICONNECT_FOOTPRINT;
    const r = f.radius + s.clearance;
    // Round end over the top, straight down both sides, round the entry.
    polyline([[r, -s.length], [r, 0], ...arc(0, 0, r, 0, Math.PI), [-r, 0], [-r, -s.length]]);
    if (s.onRamp) {
      // Every RAMP_SPACING_MM down the channel too, as mc_slot() cuts them.
      const ys = s.rampEvery ? Array.from({ length: Math.ceil(s.length / RAMP_SPACING_MM - 1e-6) - 1 }, (_, i) => (i + 1) * RAMP_SPACING_MM) : [];
      for (const y of [...ys, s.length]) loop(arc(0, -y, f.onRamp + s.clearance, 0, 2 * Math.PI, 36), true);
    } else polyline([[-r, -s.length], [r, -s.length]]);
  }
  // The arrow: from the slot's origin toward +Y.
  polyline([[0, -3], [0, 5]]);
  polyline([[-1.8, 3.2], [0, 5], [1.8, 3.2]]);
  return segments;
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Numbers in the generated source: four decimals, trailing zeros
// dropped, -0 normalised — scadLiteral() for anything else.
export function fmt(n) {
  const rounded = Math.round(Number(n) * 1e4) / 1e4;
  return scadLiteral(rounded === 0 ? 0 : rounded);
}
