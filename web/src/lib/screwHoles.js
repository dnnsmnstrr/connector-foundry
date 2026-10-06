// The Holes tab's document and its OpenSCAD codegen: a base model (a
// catalogue part with parameters, or a mesh the user brought in) and a
// list of screw holes drilled into it, each at a point on its surface
// along that surface's normal. No React in here — Holes.jsx wires state
// to these, the same split assembly.js/Bench.jsx have.
//
// A hole:
//   { id, point: [x,y,z], normal: [nx,ny,nz], spec, presetId }
// `point` is on the surface, in the base model's own coordinates (the
// frame the rendered STL is in — for a catalogue part that is where
// its module puts it, for a mesh the file's own frame); `normal` is
// the outward normal of the face it sits on, so the hole is cut along
// -normal. `spec`:
//   diameter      shank hole diameter (mm)
//   depth         0 = through the whole model, else a blind hole this deep
//   head          "none" | "counterbore" | "countersink" | "hex"
//   headDiameter  the pocket's diameter (hex: across corners)
//   headDepth     how far the pocket goes below the surface (a
//                 countersink's extra sink on top of its cone)
//   sinkAngle     a countersink's included angle (82 or 90, usually)
// `presetId` is screwPresets.js's label for where the spec came from.
//
// The generated .scad is `difference() { <base>; <one cutter per hole> }`,
// each cutter a multmatrix() whose columns are an orthonormal frame with
// +Z along the hole's outward normal, so every cutter is written once,
// in a local frame where the surface is z=0 and material is below it.
import { callArgs, scadLiteral } from "./scadLiteral.js";
import { safeStem } from "./benchName.js";

// How far a cutter reaches past the surface it enters through, so the
// cut's top face never coincides with the model's (Manifold handles
// coplanar faces, but a clean overshoot keeps the result unambiguous).
const OVERSHOOT_MM = 1;
// Facets on a round cutter. 64 keeps an M3 hole round to ~0.01 mm.
const ROUND_FN = 64;

export const DEFAULT_SPEC = Object.freeze({
  diameter: 3.4,
  depth: 0,
  head: "counterbore",
  headDiameter: 6.1,
  headDepth: 3,
  sinkAngle: 90,
});

let nextHoleId = 1;

// `source`: { kind: "catalogue", partId, params } or
//           { kind: "mesh", name, geometry, flip, stlBytes, extents } —
//           `stlBytes`/`extents` are the grounded (and, with `flip`,
//           turned-over) form of `geometry` (importedPart.js's
//           groundedMesh()); `geometry` is kept so the flip can be redone.
export function createHolesDoc(source, name = null) {
  return { source, holes: [], name, nextSpec: { ...DEFAULT_SPEC }, nextPresetId: "m3-cap" };
}

export function normalizeSpec(spec) {
  const n = (v, fallback, min = 0) => {
    const num = Number(v);
    return Number.isFinite(num) && num >= min ? num : fallback;
  };
  const head = ["none", "counterbore", "countersink", "hex"].includes(spec?.head) ? spec.head : "none";
  return {
    diameter: Math.max(0.1, n(spec?.diameter, DEFAULT_SPEC.diameter)),
    depth: n(spec?.depth, 0),
    head,
    headDiameter: n(spec?.headDiameter, 0),
    headDepth: n(spec?.headDepth, 0),
    sinkAngle: Math.min(179, Math.max(10, n(spec?.sinkAngle, 90))),
  };
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
// upside down are not lost. Its own inverse.
export function flipHoles(doc, height) {
  return {
    ...doc,
    holes: doc.holes.map((h) => ({
      ...h,
      point: [h.point[0], -h.point[1], height - h.point[2]],
      normal: [h.normal[0], -h.normal[1], -h.normal[2]],
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

// --- codegen -----------------------------------------------------------

// `throughLength`: how deep a "through" hole reaches — anything past the
// model's far side (the caller passes the base's bounding-box diagonal).
// `importedFiles`, when given, receives the mesh bytes a mesh source
// needs mounted beside the generated file (same contract as
// assembly.js's compileToScad()).
export function holesToScad(doc, partsById, { throughLength, importedFiles } = {}) {
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

  lines.push("", `$fn = ${ROUND_FN};`, "");
  if (holes.length === 0) {
    lines.push(base, "");
    return lines.join("\n");
  }
  lines.push("difference() {", `    ${base}`);
  holes.forEach((hole, i) => {
    lines.push("", `    // hole ${i + 1}: ${holeLabel(hole)} at [${hole.point.map(fmt).join(", ")}]`);
    lines.push(...cutterLines(hole, through).map((l) => `    ${l}`));
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

// "M3 socket cap" / "Ø3.4 counterbore Ø6.1×3" — a short description for
// the hole list and the generated comments.
export function holeLabel(hole, presetName = null) {
  if (presetName) return presetName;
  const s = hole.spec;
  const parts = [`Ø${fmt(s.diameter)}`];
  if (s.depth > 0) parts.push(`×${fmt(s.depth)} deep`);
  else parts.push("through");
  if (s.head === "counterbore") parts.push(`counterbore Ø${fmt(s.headDiameter)}×${fmt(s.headDepth)}`);
  if (s.head === "countersink") parts.push(`countersink Ø${fmt(s.headDiameter)} ${fmt(s.sinkAngle)}°`);
  if (s.head === "hex") parts.push(`hex pocket ${fmt(s.headDiameter)}×${fmt(s.headDepth)}`);
  return parts.join(" ");
}

// The cutter for one hole in its own frame (+Z = outward normal, the
// surface at z = 0), wrapped in the multmatrix that puts it on the model.
export function cutterLines(hole, throughLength) {
  const s = hole.spec;
  const depth = s.depth > 0 ? s.depth : throughLength;
  const body = [];
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
  const m = frameMatrix(hole.point, hole.normal);
  return [
    `multmatrix(${m}) {`,
    ...body.map((l) => `    ${l}`),
    "}",
  ];
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
  const row = (i) => `[${fmt(u[i])}, ${fmt(v[i])}, ${fmt(n[i])}, ${fmt(point[i])}]`;
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

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
