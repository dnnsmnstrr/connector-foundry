// The 3D viewer's camera maths (StlViewer.jsx): where the camera goes for
// a new model, for the F key and the Fit button, and for the View menu's
// Home, Top, Front and Right — and where the resize handles' grab targets
// go on screen, and when the camera backs out to keep them in reach.
// Plain arrays in and out, no three.js, so it is unit-tested in Node; the
// viewer copies the answers onto its PerspectiveCamera and OrbitControls
// target.
//
// The camera's up is +Z (a part stands on the XY plane), and OrbitControls
// keeps the polar angle strictly inside (0, π): a view straight down the
// Z axis has no azimuth to keep, and the controls would pick one that
// leaves the part turned on screen. The Top view therefore looks down
// from a hair off vertical towards -Y, which puts +Y at the top of the
// screen and +X to the right, as on a drawing.

/**
 * @typedef {number[]} Vec3 [x, y, z], model mm
 * @typedef {{ min: Vec3, max: Vec3 }} Box
 * @typedef {{ position: Vec3, target: Vec3 }} CameraPose
 * @typedef {"home" | "top" | "front" | "right"} ViewName
 */

// Today's framing, kept for a new model and the Home view: the camera sits
// 1.6 "radii" out along each of +X, -Y and +Z from the box's centre, where
// the radius is the largest side (at least 1 mm). Loose on purpose — the
// slot markers and labels around a part stay in view.
const HOME_OFFSET = 1.6;
// Off vertical by this much in the Top view (radians): enough for
// OrbitControls to read an azimuth (its own floor is 1e-6), far too little
// to see.
const TOP_TILT = 1e-3;

/** @type {Record<ViewName, Vec3>} */
const VIEW_DIRECTIONS = {
  home: normalize([1, -1, 1]),
  top: [0, -Math.sin(TOP_TILT), Math.cos(TOP_TILT)],
  front: [0, -1, 0],
  right: [1, 0, 0],
};

/** The View menu's entries, in menu order, with their labels. */
export const VIEW_PRESETS = /** @type {const} */ ([
  { id: "home", label: "Home" },
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "right", label: "Right" },
]);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (origin, dir, distance) => [
  origin[0] + dir[0] * distance,
  origin[1] + dir[1] * distance,
  origin[2] + dir[2] * distance,
];

function normalize(a) {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : null;
}

/**
 * The centre of a box.
 * @param {Box} box
 * @returns {Vec3}
 */
export function boxCenter(box) {
  return [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
}

/**
 * The size the framing and the clip planes scale with: the box's largest
 * side, at least 1 mm (a flat or empty model still gets a usable view).
 * @param {Box} box
 */
export function modelRadius(box) {
  return Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1);
}

/**
 * The near and far clip planes for a model of this radius: a hundredth of
 * it in front (fine detail up close stays visible), twenty times it behind
 * (zooming out never clips the part).
 * @param {number} radius from modelRadius()
 */
export function clipPlanes(radius) {
  return { near: radius / 100, far: radius * 20 };
}

/**
 * Where the camera goes for one of the View menu's views of `box`: Home is
 * the framing a new model gets; Top, Front and Right look along -Z, +Y and
 * -X from the same distance.
 * @param {ViewName} name
 * @param {Box} box
 * @returns {CameraPose}
 */
export function presetView(name, box) {
  const target = boxCenter(box);
  const dir = VIEW_DIRECTIONS[name] ?? VIEW_DIRECTIONS.home;
  // The Home offset is (1.6, -1.6, 1.6) radii, √3·1.6 radii long; every
  // view keeps that distance, so switching views never zooms.
  const distance = modelRadius(box) * HOME_OFFSET * Math.sqrt(3);
  return { target, position: along(target, dir, distance) };
}

/**
 * presetView() for a viewer of a given shape: the same framing, backed out
 * along its own view direction when a corner of `box` would fall outside
 * ±CONTAIN_MARGIN of it. The preset distance assumes a viewer wider than
 * it is tall; in a narrow one (an iPad in portrait, a sidebar dragged
 * wide) the part was clipped on both sides and its resize handles sat off
 * the canvas until Fit was pressed. A viewer the preset already fits gets
 * the preset unchanged, so wide ones frame exactly as before.
 * @param {ViewName} name
 * @param {Box} box
 * @param {{ fovDeg: number, aspect: number }} view
 * @returns {CameraPose}
 */
export function presetViewFitting(name, box, { fovDeg, aspect }) {
  const pose = presetView(name, box);
  const position = dollyToFit({ box, position: pose.position, target: pose.target, fovDeg, aspect });
  return position ? { target: pose.target, position } : pose;
}

/**
 * The camera's right, up and back (target → camera) unit vectors, as
 * three's lookAt() builds them for a camera whose up is `up`.
 * @param {Vec3} position
 * @param {Vec3} target
 * @param {Vec3} [up]
 * @returns {{ right: Vec3, up: Vec3, back: Vec3 } | null} null when the
 *   camera sits on its target
 */
export function viewBasis(position, target, up = [0, 0, 1]) {
  const back = normalize(sub(position, target));
  if (!back) return null;
  // Looking exactly along `up`, lookAt() tips the view a little to get a
  // right vector; any perpendicular does the same here.
  const right = normalize(cross(up, back)) ?? normalize(cross([0, 1, 0], back)) ?? [1, 0, 0];
  return { right, up: cross(back, right), back };
}

function corners(box) {
  /** @type {Vec3[]} */
  const out = [];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
  return out;
}

/**
 * Where a point lands in normalised device coordinates (-1..1 across the
 * view; z is the distance in front of the camera, negative behind it).
 * @param {Vec3} point
 * @param {{ position: Vec3, target: Vec3, up?: Vec3, fovDeg: number, aspect: number }} view
 *   `fovDeg` is the vertical field of view, `aspect` width / height
 * @returns {Vec3 | null}
 */
export function projectToNdc(point, { position, target, up = [0, 0, 1], fovDeg, aspect }) {
  const basis = viewBasis(position, target, up);
  if (!basis) return null;
  const rel = sub(point, position);
  const depth = -dot(rel, basis.back);
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  return [dot(rel, basis.right) / (depth * tan * aspect), dot(rel, basis.up) / (depth * tan), depth];
}

/**
 * The distance from `target` along `back` at which every corner of `box`
 * projects inside ±`margin` of the view, for a perspective camera that
 * looks at `target`.
 * @param {{ box: Box, target: Vec3, back: Vec3, right: Vec3, up: Vec3, fovDeg: number, aspect: number, margin: number }} args
 */
function containDistance({ box, target, back, right, up, fovDeg, aspect, margin }) {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  // A point a hair in front of the camera still projects, but onto the
  // whole screen: keep every corner at least this far in front.
  const minDepth = modelRadius(box) / 100;
  let distance = 0;
  for (const corner of corners(box)) {
    const rel = sub(corner, target);
    const toward = dot(rel, back);
    const across = Math.max(Math.abs(dot(rel, right)) / (tan * aspect), Math.abs(dot(rel, up)) / tan);
    distance = Math.max(distance, toward + Math.max(across / margin, minDepth));
  }
  return distance;
}

/**
 * The F key and the Fit button: look at the centre of `box` from the
 * direction the camera looks now, from just far enough that the box fills
 * the view to `margin` (TinkerCAD's "fit": the selection, filling the
 * screen, the way you were looking at it). The default leaves room round
 * the box for the handles drawn outside it and the toolbar over the top.
 * @param {{ box: Box, position: Vec3, target: Vec3, up?: Vec3, fovDeg: number, aspect: number, margin?: number }} args
 * @returns {CameraPose}
 */
export function fitView({ box, position, target, up = [0, 0, 1], fovDeg, aspect, margin = 0.7 }) {
  const center = boxCenter(box);
  // A camera sitting on its target has no direction to keep: Home's.
  const basis =
    viewBasis(position, target, up) ?? viewBasis(along(center, VIEW_DIRECTIONS.home, 1), center, up);
  if (!basis) return presetView("home", box);
  const distance = containDistance({ box, target: center, ...basis, fovDeg, aspect, margin });
  // Never closer than the box's own size: a flat part seen edge-on would
  // otherwise put the camera on its surface.
  return { target: center, position: along(center, basis.back, Math.max(distance, modelRadius(box))) };
}

// How much of the view (NDC) a new model of the same subject may fill
// before the camera backs out (dollyToFit()).
export const CONTAIN_MARGIN = 0.95;

/**
 * A new model of the same subject (a resize, a hole, a parameter edit):
 * keep the camera where the user put it unless a corner of the new box
 * falls outside ±`margin` of the view; then back the camera out along the
 * way it looks until the box fits. Never moves closer — a part that
 * shrank keeps the view.
 * @param {{ box: Box, position: Vec3, target: Vec3, up?: Vec3, fovDeg: number, aspect: number, margin?: number }} args
 * @returns {Vec3 | null} the new camera position, or null when the box
 *   already fits
 */
export function dollyToFit({
  box,
  position,
  target,
  up = [0, 0, 1],
  fovDeg,
  aspect,
  margin = CONTAIN_MARGIN,
}) {
  const basis = viewBasis(position, target, up);
  if (!basis) return null;
  const current = Math.hypot(...sub(position, target));
  const needed = containDistance({ box, target, ...basis, fovDeg, aspect, margin });
  if (!(needed > current * (1 + 1e-9))) return null;
  return along(target, basis.back, needed);
}

// --- Handles on screen ------------------------------------------------------
// The resize handles are DOM elements over the canvas. The viewer projects
// their points with three.js; what it does with the projections is here.

/**
 * Where a handle's grab target sits relative to its point's projection
 * `at`: `px` out along the way the handle's direction runs on screen (`at`
 * towards `tip`, the projection of a short piece of it), and further out
 * by however far the side of the body it stands on reaches past `at` that
 * way (`top`, the projection of that side's far end). Seen from above, a
 * tall part's top rim projects outside the bottom edge its footprint
 * handles stand on, and a target only `px` out from that edge would sit
 * on the rim or inside the opening.
 * @param {number[]} at px
 * @param {number[] | null} tip px; null (behind the camera) gives no offset
 * @param {number[] | null} top px; null when there is no side to clear
 * @param {number} px
 * @returns {number[]} [dx, dy] in px
 */
export function grabOffset(at, tip, top, px) {
  const len = tip ? Math.hypot(tip[0] - at[0], tip[1] - at[1]) : 0;
  // Pointing (nearly) at the camera, the direction has no way to go on
  // screen: the target stays on the point.
  if (!(len > 0.5)) return [0, 0];
  const u = [(tip[0] - at[0]) / len, (tip[1] - at[1]) / len];
  const past = top ? Math.max(0, (top[0] - at[0]) * u[0] + (top[1] - at[1]) * u[1]) : 0;
  return [u[0] * (px + past), u[1] * (px + past)];
}

/**
 * Whether a grab target centred at `at` can be grabbed: its whole hit area
 * (`half` px each way, plus `gap`) inside a `width` × `height` view and
 * clear of every obstacle — the toolbar's controls and whatever the mode
 * lays over the viewer (Library's download buttons) — which take the
 * press there instead.
 * @param {number[]} at px
 * @param {number} half half the hit area's side, px
 * @param {{ width: number, height: number, obstacles?: number[][], gap?: number }} view
 *   obstacles as [left, top, right, bottom], in the same px as `at`
 */
export function inReach(at, half, { width, height, obstacles = [], gap = 0 }) {
  const r = half + gap;
  if (at[0] - r < 0 || at[1] - r < 0 || at[0] + r > width || at[1] + r > height) return false;
  return obstacles.every(
    ([l, t, rt, b]) => at[0] + r <= l || at[0] - r >= rt || at[1] + r <= t || at[1] - r >= b,
  );
}

/**
 * Whether a new set of handles is the old one grown: they share an id (the
 * same subject, not a new selection) and the new points reach past the old
 * ones' bounding box somewhere. A shrink, a move inside the old box or a
 * new render of the same size is not.
 * @param {{ id: string, point: Vec3 }[]} previous
 * @param {{ id: string, point: Vec3 }[]} next
 */
export function handlesGrew(previous, next) {
  const ids = new Set(previous.map((h) => h.id));
  if (!next.some((h) => ids.has(h.id))) return false;
  const before = pointsBox(previous);
  // Hundredths of a mm: a landed mesh is its predicted box to float noise.
  const eps = 0.01;
  return next.some(({ point }) => point.some((v, i) => v < before.min[i] - eps || v > before.max[i] + eps));
}

/**
 * The bounding box of some handles' points.
 * @param {{ point: Vec3 }[]} handles at least one
 * @returns {Box}
 */
function pointsBox(handles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { point } of handles) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i]);
      max[i] = Math.max(max[i], point[i]);
    }
  }
  return { min, max };
}

/**
 * How far from its target the camera has to back out (along the way it
 * looks) for `fits(distance)` to hold: the nearest such distance past
 * `current`, found by stepping out `step`× at a time and then halving the
 * last step, to `tolerance` of `current`. null when the camera can stay —
 * it fits already — or when nothing up to `maxFactor`× fits (a toolbar
 * over the middle of a tiny view); never a distance closer than `current`.
 * The default reach is generous: a camera zoomed in on a detail when the
 * part grows eightfold has that far to go, and a miss costs only some
 * thirty more tries of a cheap test.
 * @param {(distance: number) => boolean} fits
 * @param {number} current
 * @param {{ step?: number, maxFactor?: number, tolerance?: number }} [options]
 * @returns {number | null}
 */
export function dollyOutDistance(fits, current, { step = 1.1, maxFactor = 20, tolerance = 0.005 } = {}) {
  if (!(current > 0) || fits(current)) return null;
  let bad = current;
  let good = null;
  for (let d = current * step; d <= current * maxFactor; d *= step) {
    if (fits(d)) {
      good = d;
      break;
    }
    bad = d;
  }
  if (good === null) return null;
  while (good - bad > current * tolerance) {
    const mid = (bad + good) / 2;
    if (fits(mid)) good = mid;
    else bad = mid;
  }
  return good;
}

/**
 * What a new model does to the camera:
 * - "fit": the first model, or `fitKey` changed (another part) — the Home
 *   framing, as the viewer always did.
 * - "contain": the same `fitKey` — keep the view, backing out only when
 *   the new box doesn't fit (dollyToFit()).
 * - "keep": no `fitKey` from the caller and the model's centre and size
 *   moved less than 2% — the rule from before fitKey existed, which
 *   callers that pass none keep.
 * @param {{ key: string | undefined, center: Vec3, radius: number } | null} previous
 *   what the camera was last fitted for
 * @param {string | undefined} fitKey
 * @param {Vec3} center the new model's box centre
 * @param {number} radius its modelRadius()
 * @returns {"fit" | "contain" | "keep"}
 */
export function refitMode(previous, fitKey, center, radius) {
  if (!previous) return "fit";
  if (fitKey !== undefined) return fitKey === previous.key ? "contain" : "fit";
  if (previous.key !== undefined) return "fit";
  const moved = Math.hypot(...sub(previous.center, center));
  const unchanged = moved < 0.02 * radius && Math.abs(previous.radius - radius) < 0.02 * radius;
  return unchanged ? "keep" : "fit";
}
