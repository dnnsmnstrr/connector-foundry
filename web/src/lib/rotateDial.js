// The rotate dial (StlViewer.jsx's Alt-drag on a handle): the angle the
// pointer has turned about an axis, how it snaps, and the dial's lines.
// Plain arrays in and out, no three.js, so it is unit-tested in Node.
//
// TinkerCAD's and the slicers' rule: with the pointer on the dial, the
// angle snaps to the dial's ticks; pulled out past it, to whole degrees.
// The snap is to absolute angles (`base` is the angle the object starts
// at), so a part at 37° goes to 45°, not 52°, and the ticks are drawn
// where those angles are: the longest at the quarter turns, which square
// a part up with what it sits on.

/** @typedef {number[]} Vec3 [x, y, z], model mm */

// The ticks the dial snaps to, in degrees.
export const DIAL_SNAP_DEG = 15;
// How far out from the centre, as a share of the dial's radius, the
// pointer still counts as on the dial: the ticks and a little past them,
// so a fingertip-wide ring is not needed to snap.
export const DIAL_REACH = 1.35;
// Segments of the ring: smooth at any size the viewer draws it.
const RING_SEGMENTS = 96;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function unit(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 1e-12 ? a.map((v) => v / len) : null;
}

// `v` with its component along the unit `axis` taken out.
function inPlane(v, axis) {
  const along = dot(v, axis);
  return [v[0] - axis[0] * along, v[1] - axis[1] * along, v[2] - axis[2] * along];
}

/**
 * The signed angle (degrees, in (−180, 180]) from `from` to `to` as seen
 * turning about `axis` through `center`, right-handed (counter-clockwise
 * looking down the axis from its tip). Both points are projected onto the
 * plane through `center`; null when either lands on the centre.
 * @param {Vec3} center
 * @param {Vec3} axis
 * @param {Vec3} from
 * @param {Vec3} to
 * @returns {number | null}
 */
export function planeAngle(center, axis, from, to) {
  const n = unit(axis);
  if (!n) return null;
  const a = unit(inPlane(sub(from, center), n));
  const b = unit(inPlane(sub(to, center), n));
  if (!a || !b) return null;
  return (Math.atan2(dot(cross(a, b), n), dot(a, b)) * 180) / Math.PI;
}

/**
 * The turn so far, carried past ±180°: `previous` is the running total,
 * `raw` the latest planeAngle() from the start. The step between them is
 * taken the short way round, so a pointer that goes all the way round
 * reads 270°, not −90°.
 * @param {number} previous
 * @param {number} raw
 */
export function unwrapAngle(previous, raw) {
  const wrap = (deg) => deg - 360 * Math.round(deg / 360);
  return previous + wrap(raw - wrap(previous));
}

/**
 * The step a turn snaps to with the pointer `distance` mm from the
 * centre of a dial of `radius` mm: the ticks on the dial, whole degrees
 * off it.
 * @param {number} distance
 * @param {number} radius
 */
export function dialStep(distance, radius) {
  return distance <= radius * DIAL_REACH ? DIAL_SNAP_DEG : 1;
}

/**
 * The snapped turn: `base + turned` rounded to `step`, less `base` — so
 * the object lands on a multiple of the step, wherever it started.
 * @param {number} base the angle the object is at, degrees
 * @param {number} turned the turn the pointer asks for, degrees
 * @param {number} step
 */
export function snapTurn(base, turned, step) {
  const snapped = Math.round((base + turned) / step) * step - base;
  // Round off float dust (0.1 + 0.2), and never a −0.
  return Math.round(snapped * 1e6) / 1e6 + 0;
}

/**
 * `point` turned `degrees` about `axis` through `center` (right-handed,
 * as planeAngle() measures).
 * @param {Vec3} point
 * @param {Vec3} center
 * @param {Vec3} axis
 * @param {number} degrees
 * @returns {Vec3}
 */
export function rotateAbout(point, center, axis, degrees) {
  const k = unit(axis);
  if (!k) return [...point];
  const v = sub(point, center);
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [0, 1, 2].map((i) => center[i] + v[i] * c + kv[i] * s + k[i] * kd);
}

/**
 * The dial's lines: a ring of `radius` in the plane through `center`
 * square to `axis`, a tick at every DIAL_SNAP_DEG of absolute angle
 * (longer at 45°, longest at the quarter turns), a spoke where the turn
 * started and a longer one where it is now. Angles are counted from the
 * start spoke (`fromPoint`'s direction from the centre), which stands
 * for `base`.
 * @param {{ center: Vec3, axis: Vec3, radius: number, base?: number }} dial
 * @param {Vec3} fromPoint where the drag started, on the dial's plane
 * @param {number} turned the snapped turn so far, degrees
 * @returns {Vec3[][]} [from, to] segments; none when the start point is the centre
 */
export function dialSegments({ center, axis, radius, base = 0 }, fromPoint, turned) {
  const n = unit(axis);
  const u = n && unit(inPlane(sub(fromPoint, center), n));
  if (!n || !u) return [];
  const v = cross(n, u);
  // The point `r` out from the centre, `deg` round from the start spoke.
  const at = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    return [0, 1, 2].map((i) => center[i] + u[i] * c + v[i] * s);
  };
  const segments = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    segments.push([at((i * 360) / RING_SEGMENTS, radius), at(((i + 1) * 360) / RING_SEGMENTS, radius)]);
  }
  for (let t = 0; t < 360; t += DIAL_SNAP_DEG) {
    const length = t % 90 === 0 ? 0.22 : t % 45 === 0 ? 0.15 : 0.08;
    const deg = t - base;
    segments.push([at(deg, radius), at(deg, radius * (1 + length))]);
  }
  segments.push([at(0, 0), at(0, radius)]);
  segments.push([at(turned, 0), at(turned, radius * DIAL_REACH)]);
  return segments;
}
