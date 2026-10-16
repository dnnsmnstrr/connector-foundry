// The geometry under a resize-handle drag (StlViewer.jsx's handles): where
// the pointer's ray meets the line or plane a handle is constrained to,
// and when that question has no useful answer. Plain arrays in and out,
// no three.js, so it is unit-tested in Node.
//
// The guard that matters is the angle. A constraint line that points
// almost along the view ray (the height handle seen from the Top view,
// a width handle from the Right view) maps a few pixels of pointer travel
// to hundreds of millimetres — one twitch would commit a grid of 300
// cells. So both intersections refuse (null) inside EDGE_ON_DEG, and the
// viewer hides a handle in the same cone (edgeOnToView()) so a drag
// rarely starts there; if the camera's perspective takes a running drag
// into the cone, the viewer falls back to screenAxisDelta()'s
// screen-space reading instead, which is held to the sensitivity at the
// cone's edge.

/** @typedef {number[]} Vec3 [x, y, z], model mm */

// 15° either side of edge-on: at the edge of that cone, pointer travel
// maps to at most 1 / sin 15° ≈ 3.9 times the distance it would cover
// with the axis face-on, which still feels like dragging.
export const EDGE_ON_DEG = 15;
const COS_EDGE_ON = Math.cos((EDGE_ON_DEG * Math.PI) / 180);
const SIN_EDGE_ON = Math.sin((EDGE_ON_DEG * Math.PI) / 180);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(a[0], a[1], a[2]);

function unit(a) {
  const n = length(a);
  return n > 0 && Number.isFinite(n) ? [a[0] / n, a[1] / n, a[2] / n] : null;
}

function finiteVec(v) {
  return Array.isArray(v) && v.length >= 3 && Number.isFinite(v[0] + v[1] + v[2]);
}

/**
 * The point on the line (through `lineOrigin` along `lineDir`) closest to
 * the ray — where a handle constrained to that line goes when the
 * pointer's ray passes there.
 * @param {Vec3} rayOrigin
 * @param {Vec3} rayDir
 * @param {Vec3} lineOrigin
 * @param {Vec3} lineDir
 * @returns {Vec3 | null} null when the line is within EDGE_ON_DEG of the
 *   ray, or the closest approach is behind the ray's origin (the camera)
 */
export function rayLinePoint(rayOrigin, rayDir, lineOrigin, lineDir) {
  if (![rayOrigin, rayDir, lineOrigin, lineDir].every(finiteVec)) return null;
  const d = unit(rayDir);
  const u = unit(lineDir);
  if (!d || !u) return null;
  const b = dot(d, u);
  if (Math.abs(b) > COS_EDGE_ON) return null;
  // Closest points of two lines, both directions unit length:
  // origin + t·d on the ray, lineOrigin + s·u on the line.
  const w = sub(rayOrigin, lineOrigin);
  const dw = dot(d, w);
  const uw = dot(u, w);
  const denom = 1 - b * b;
  const t = (b * uw - dw) / denom;
  const s = (uw - b * dw) / denom;
  if (t < 0) return null;
  return [lineOrigin[0] + s * u[0], lineOrigin[1] + s * u[1], lineOrigin[2] + s * u[2]];
}

/**
 * Where the ray meets the plane through `planeOrigin` with `planeNormal` —
 * a corner handle's or a hole's move in its face plane.
 * @param {Vec3} rayOrigin
 * @param {Vec3} rayDir
 * @param {Vec3} planeOrigin
 * @param {Vec3} planeNormal
 * @returns {Vec3 | null} null when the plane is within EDGE_ON_DEG of
 *   edge-on to the ray, or the intersection is behind the origin
 */
export function rayPlanePoint(rayOrigin, rayDir, planeOrigin, planeNormal) {
  if (![rayOrigin, rayDir, planeOrigin, planeNormal].every(finiteVec)) return null;
  const d = unit(rayDir);
  const n = unit(planeNormal);
  if (!d || !n) return null;
  const dn = dot(d, n);
  if (Math.abs(dn) < SIN_EDGE_ON) return null;
  const t = dot(sub(planeOrigin, rayOrigin), n) / dn;
  if (t < 0) return null;
  return [rayOrigin[0] + t * d[0], rayOrigin[1] + t * d[1], rayOrigin[2] + t * d[2]];
}

/**
 * The screen-space fallback for a drag whose constraint went edge-on
 * mid-drag: how far along the axis the pointer travelled, in mm. The
 * caller projects a segment of the axis, `segmentMm` long and starting at
 * the handle (so at its depth), to pixels; pointer travel along that
 * projected direction converts at the segment's own px-per-mm.
 *
 * That projected scale shrinks with the sine of the axis's angle to the
 * view (at 1° it is 1/57 of face-on), so on its own the fallback would
 * map a few pixels to hundreds of mm, the very thing the EDGE_ON_DEG
 * guard refuses. Pass `faceOnPxPerMm`, the scale of a segment at the
 * handle's depth seen face-on (project one across the view), and the
 * scale never drops below that at the edge of the cone, so the reading
 * gets no more sensitive than the intersection was there. Read the
 * travel from where the fallback took over and add the result to the
 * distance the drag had reached by then: at the switch the two scales
 * agree, so the handle carries on without a jump.
 * @param {number[]} startPx the segment's start on screen, [x, y]
 * @param {number[]} endPx its end, [x, y]
 * @param {number[]} deltaPx the pointer's travel to read, [dx, dy]
 * @param {number} [segmentMm] the segment's length in model mm
 * @param {number} [faceOnPxPerMm] px per mm at the handle's depth, face-on
 *   (0 or left out: no floor)
 * @returns {number | null} mm along the axis (negative is backwards), or
 *   null when the axis projects to (almost) a point — there is no
 *   direction on screen to read travel along
 */
export function screenAxisDelta(startPx, endPx, deltaPx, segmentMm = 1, faceOnPxPerMm = 0) {
  const ax = endPx[0] - startPx[0];
  const ay = endPx[1] - startPx[1];
  const len = Math.hypot(ax, ay);
  if (!Number.isFinite(len) || len < 1e-3 || !(segmentMm > 0)) return null;
  const floor = faceOnPxPerMm > 0 && Number.isFinite(faceOnPxPerMm) ? faceOnPxPerMm * SIN_EDGE_ON : 0;
  const pxPerMm = Math.max(len / segmentMm, floor);
  // The pointer's travel along the axis's direction on screen, in px.
  const along = (deltaPx[0] * ax + deltaPx[1] * ay) / len;
  const mm = along / pxPerMm;
  return Number.isFinite(mm) ? mm : null;
}

/**
 * Whether a handle's outward direction faces the camera — the viewer
 * fades a footprint handle on the far side when its mirror is visible.
 * @param {Vec3} dir the handle's outward direction
 * @param {Vec3} viewDir the direction the camera looks (camera to target,
 *   or camera to the handle for a perspective camera)
 */
export function facingViewer(dir, viewDir) {
  return dot(dir, viewDir) <= 0;
}

/**
 * Whether a constraint is too close to edge-on to drag along: a line
 * within EDGE_ON_DEG of the view direction, a plane within EDGE_ON_DEG of
 * containing it. The same cone rayLinePoint()/rayPlanePoint() refuse, so
 * a handle the viewer shows can always start a drag.
 * @param {{ type: string, dir?: Vec3, normal?: Vec3 }} constraint
 * @param {Vec3} viewDir
 */
export function edgeOnToView(constraint, viewDir) {
  const v = unit(viewDir);
  if (!v) return true;
  if (constraint.type === "plane") {
    const n = constraint.normal && unit(constraint.normal);
    return !n || Math.abs(dot(n, v)) < SIN_EDGE_ON;
  }
  const u = constraint.dir && unit(constraint.dir);
  return !u || Math.abs(dot(u, v)) > COS_EDGE_ON;
}
