// What the Holes tab draws over the model, as StlViewer's `markers`,
// `guides` and `labels`: the holes' rings and the snap points, the slot
// outlines and the hovered face's guide lines, and the Option-held
// measurements. Pure, so Holes.jsx only memoises the calls.
import { holeFootprintRadius, slotOutline } from "./screwHoles.js";
import { edgeDistances } from "./snapCandidates.js";

// Marker colours: holes in the imported-badge blue, the selected one and
// the snap point about to be used in the selection yellow, the rest of
// a face's snap points by kind.
export const HOLE_COLOR = 0x7fa8e0;
export const SELECTED_COLOR = 0xffd23f;
// The Repeat form's copies, before they are added.
export const REPEAT_PREVIEW_COLOR = 0x2ecc71;
export const SNAP_COLORS = {
  hole: 0x7fa8e0,
  center: 0x2ecc71,
  quarter: 0xd8d9db,
  corner: 0xd8d9db,
  intersection: 0x9a9ba0,
  circle: 0xe0c07f,
  // A system's next holes round the selected one, while measuring.
  pitch: 0x5fd3e0,
};
// Guide lines on the hovered face: center lines solid, quarter lines
// dashed, radials dashed and dim, the center circle in the circle
// points' colour.
const GUIDE_CENTER_COLOR = 0x9db4e8;
const GUIDE_QUARTER_COLOR = 0x6b7390;
const GUIDE_RADIAL_COLOR = 0x6b7390;
const GUIDE_CIRCLE_COLOR = 0xb39a50;
// Measurement lines (Option held): bright, over the guides.
const MEASURE_COLOR = 0xf0f0f0;
// The lines from the selected hole to a system's next holes, dimmer than
// the point's own measurements so those still read on top.
const PITCH_LINE_COLOR = 0x3f8f99;
const MEASURE_LIFT_MM = 0.1;
// Lifted off the face so the lines don't z-fight it.
const GUIDE_LIFT_MM = 0.06;

/** @param {number[]} p @param {number[]} normal @param {number} mm */
function liftedBy(p, normal, mm) {
  return [p[0] + normal[0] * mm, p[1] + normal[1] * mm, p[2] + normal[2] * mm];
}

/** @param {any} h @param {string} id @param {number} color */
function ringMarker(h, id, color) {
  return {
    id,
    shape: "ring",
    x: h.point[0],
    y: h.point[1],
    z: h.point[2],
    normal: h.normal,
    radius: holeFootprintRadius(h.spec) + 0.5,
    color,
  };
}

/**
 * The viewer's markers: a ring per hole (`hole:<id>`), the Repeat form's
 * copies (display only), the spot on a guide line the pointer would take,
 * and the guide face's snap points (`snap:<candidate id>`), the hovered
 * one enlarged.
 * @param {object} args
 * @param {any} args.doc the holes document, or null
 * @param {string[]} args.selectedIds
 * @param {any} [args.repeatResult] repeatHole()'s result, while the form is open
 * @param {any} [args.hover] { faceKey, snapId, linePoint } under the pointer
 * @param {any} [args.guideFace] analyzeFace()'s record for the guide face
 * @param {boolean} args.snapOn
 * @param {number} args.snapDot a snap point's radius, scaled to the model
 */
export function holeMarkers({ doc, selectedIds, repeatResult, hover, guideFace, snapOn, snapDot }) {
  if (!doc) return [];
  /** @type {any[]} */
  const out = doc.holes.map((/** @type {any} */ h) =>
    ringMarker(h, `hole:${h.id}`, selectedIds.includes(h.id) ? SELECTED_COLOR : HOLE_COLOR),
  );
  // The Repeat form's copies (and where the hole itself would move).
  if (repeatResult) {
    for (const h of repeatResult.doc.holes) {
      const before = doc.holes.find((/** @type {any} */ x) => x.id === h.id);
      if (
        before &&
        before.point.every((/** @type {number} */ v, /** @type {number} */ i) => v === h.point[i])
      )
        continue;
      out.push({ ...ringMarker(h, `repeat:${h.id}`, REPEAT_PREVIEW_COLOR), hitTest: false });
    }
  }
  // The spot on a guide line the click would take: a marker that
  // follows the pointer along the line.
  if (hover?.linePoint) {
    out.push({
      id: "snap:line",
      x: hover.linePoint[0],
      y: hover.linePoint[1],
      z: hover.linePoint[2],
      radius: snapDot * 1.4,
      color: SELECTED_COLOR,
      // Display only: it sits under the pointer, and a click there
      // goes to the face and resolves to this same point.
      hitTest: false,
    });
  }
  const hovering = hover && guideFace && hover.faceKey === guideFace.key;
  for (const c of (snapOn && guideFace?.candidates) || []) {
    const active = hovering && c.id === hover.snapId;
    out.push({
      id: `snap:${c.id}`,
      x: c.point[0],
      y: c.point[1],
      z: c.point[2],
      radius: active ? snapDot * 1.7 : snapDot,
      color: active
        ? SELECTED_COLOR
        : (SNAP_COLORS[/** @type {keyof SNAP_COLORS} */ (c.kind)] ?? SNAP_COLORS.quarter),
    });
  }
  return out;
}

/**
 * The viewer's line segments: every connector slot's outline on its own
 * face — its channel, its entry (dashed) and an arrow the way the head
 * travels to seat, since a ring says nothing about which way a slot
 * points — and, with snapping on, the guide face's lines and circle.
 * Each piece is lifted off its face along the normal.
 * @param {object} args
 * @param {any[]} args.holes
 * @param {string[]} args.selectedIds
 * @param {any} [args.guideFace]
 * @param {boolean} args.snapOn
 */
export function holeGuides({ holes, selectedIds, guideFace, snapOn }) {
  /** @type {{ a: number[], b: number[], color: number, dashed?: boolean }[]} */
  const segments = [];
  for (const h of holes) {
    const color = selectedIds.includes(h.id) ? SELECTED_COLOR : HOLE_COLOR;
    for (const seg of slotOutline(h))
      segments.push({
        a: liftedBy(seg.a, h.normal, GUIDE_LIFT_MM),
        b: liftedBy(seg.b, h.normal, GUIDE_LIFT_MM),
        color,
        dashed: seg.dashed,
      });
  }
  const face = snapOn ? guideFace : null;
  if (!face) return segments;
  const lift = (/** @type {number[]} */ p) => liftedBy(p, face.normal, GUIDE_LIFT_MM);
  for (const g of face.guides) {
    if (g.kind === "circle") {
      // The circle as a chain of short segments.
      for (let i = 0; i + 1 < g.points.length; i++) {
        segments.push({
          a: lift(g.points[i]),
          b: lift(g.points[i + 1]),
          color: GUIDE_CIRCLE_COLOR,
          dashed: false,
        });
      }
      continue;
    }
    const color =
      g.kind === "center"
        ? GUIDE_CENTER_COLOR
        : g.kind === "radial"
          ? GUIDE_RADIAL_COLOR
          : GUIDE_QUARTER_COLOR;
    segments.push({ a: lift(g.a), b: lift(g.b), color, dashed: g.kind !== "center" });
  }
  return segments;
}

/**
 * The Option-held measurements on `face`: its size at a corner of its
 * bounding box, and — when `point` lies on the face — dimension lines
 * from the point to the outline in each direction and (dashed) to the
 * center, each labelled. Distances under 0.05 mm are left out.
 * @param {any} face analyzeFace()'s record
 * @param {number[] | null} point
 * @returns {{ guides: { a: number[], b: number[], color: number, dashed: boolean }[], labels: { id: string, point: number[], text: string }[] }}
 */
export function faceMeasurements(face, point) {
  const lift = (/** @type {number[]} */ p) => liftedBy(p, face.normal, MEASURE_LIFT_MM);
  const mid = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];
  const mm = (/** @type {number} */ n) => `${n.toFixed(1)} mm`;
  /** @type {{ a: number[], b: number[], color: number, dashed: boolean }[]} */
  const guides = [];
  /** @type {{ id: string, point: number[], text: string }[]} */
  const labels = [];
  const [w, h] = face.extent;
  // The face's size at a corner of its bounding box, out of the way of
  // the lines through the point.
  const corner = face.center.map(
    (/** @type {number} */ c, /** @type {number} */ i) => c + (face.u[i] * w) / 2 + (face.v[i] * h) / 2,
  );
  labels.push({ id: "size", point: lift(corner), text: `${mm(w).slice(0, -3)} × ${mm(h)}` });
  if (!point || !onFacePlane(face, point)) return { guides, labels };
  const d = edgeDistances(face, point);
  if (!d) return { guides, labels };
  for (const side of /** @type {const} */ (["left", "right", "down", "up"])) {
    if (d[side] < 0.05) continue;
    guides.push({ a: lift(point), b: lift(d.ends[side]), color: MEASURE_COLOR, dashed: false });
    labels.push({ id: side, point: lift(mid(point, d.ends[side])), text: mm(d[side]) });
  }
  if (d.toCenter > 0.05) {
    guides.push({ a: lift(point), b: lift(face.center), color: MEASURE_COLOR, dashed: true });
    labels.push({
      id: "center",
      point: lift(mid(point, face.center)),
      text: `${mm(d.toCenter)} to center`,
    });
  }
  return { guides, labels };
}

/**
 * A system's next holes round the selected one (snapCandidates.js's
 * pitchCandidates()): a dashed line from the hole to each, and each
 * distinct step labelled once (across, up, and a diagonal), halfway
 * along the first line that makes it — eight labels would cover the
 * points they name.
 * @param {any} face analyzeFace()'s record
 * @param {number[]} anchor the selected hole's point
 * @param {{ point: number[], offset: number[] }[]} candidates
 * @returns {{ guides: { a: number[], b: number[], color: number, dashed: boolean }[], labels: { id: string, point: number[], text: string }[] }}
 */
export function pitchMeasurements(face, anchor, candidates) {
  const lift = (/** @type {number[]} */ p) => liftedBy(p, face.normal, MEASURE_LIFT_MM);
  const guides = [];
  const labels = [];
  const said = new Set();
  for (const c of candidates) {
    guides.push({ a: lift(anchor), b: lift(c.point), color: PITCH_LINE_COLOR, dashed: true });
    const text = `${Math.hypot(c.offset[0], c.offset[1]).toFixed(1)} mm`;
    if (said.has(text)) continue;
    said.add(text);
    const mid = anchor.map((/** @type {number} */ v, /** @type {number} */ i) => (v + c.point[i]) / 2);
    labels.push({ id: `pitch:${labels.length}`, point: lift(mid), text });
  }
  return { guides, labels };
}

/**
 * Whether `point` lies in `face`'s plane (within 0.05 mm).
 * @param {any} face
 * @param {number[]} point
 */
export function onFacePlane(face, point) {
  return (
    Math.abs(
      (point[0] - face.center[0]) * face.normal[0] +
        (point[1] - face.center[1]) * face.normal[1] +
        (point[2] - face.center[2]) * face.normal[2],
    ) < 0.05
  );
}
