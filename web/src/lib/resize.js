// Resize handles for catalogue parts (Library, the Bench root): which
// parameters a part's handles drive (catalogue.yaml's `resize` field —
// web-only, the CLI ignores it), where the handles sit on the rendered
// box, and what a drag, a typed size or an arrow key does to the
// parameters. Pure, no React or three.js; StlViewer.jsx draws the
// handles, the modes call these and commit one parameter change.
//
// The catalogue records only a slope (`per`: mm of outside size per unit
// of the parameter); the current size is always measured from the
// rendered mesh (meshExtents.js's meshBounds()), so constant offsets —
// a Gridfinity bin's 0.5 mm clearance, a lip — never need writing down.
//
// Every part module is anchor=BOTTOM, centred in X and Y, so a render is
// always centred: X/Y grow symmetrically about the centre (TinkerCAD's
// Alt-drag) and Z grows upward from the bottom. The predicted box here
// is exactly that, so the ghost a drag shows is where the next render
// lands.

/**
 * @typedef {number[]} Vec3 [x, y, z], model mm
 * @typedef {{ min: Vec3, max: Vec3 }} Box
 * @typedef {object} ResizeAxis
 * @property {string} axis "x" | "y" | "z" | "xy" (one parameter for X and Y, a diameter)
 * @property {string} param the parameter it drives
 * @property {number} per mm of outside size per unit of the parameter
 * @property {number | null} step the parameter moves in multiples of this (a count), or null
 * @property {number} min the handle's lower bound for the parameter (always > 0)
 * @property {number} max its upper bound (Infinity when none)
 * @typedef {{ type: string, dir?: Vec3, normal?: Vec3 }} HandleConstraint
 *   `{ type: "line", dir }` or `{ type: "plane", normal }`, through the handle's point
 * @typedef {object} ResizeHandle
 * @property {string} id "x+", "x-", "y+", "y-", "x+y+", "x+y-", "x-y+", "x-y-",
 *   "xy:x+", "xy:x-", "xy:y+", "xy:y-" or "z+"
 * @property {string} kind "edge" | "corner" | "top"
 * @property {string[]} axes the ResizeAxis keys it drives
 * @property {Vec3} dir outward unit vector
 * @property {Vec3} point the true face/edge point the constraint passes through
 * @property {boolean} tabbable whether it is a keyboard stop (one per axis)
 * @property {HandleConstraint} constraint
 * @typedef {object} ResizeResult
 * @property {Record<string, number>} params the parameters that change (only those)
 * @property {Record<string, number>} values every driven parameter's new value, changed or not
 * @property {Box} box the predicted outside box
 * @property {{ x: number, y: number, z: number }} sizes the predicted outside size
 * @property {boolean} clamped whether a bound stopped a value
 * @typedef {ResizeHandle & {
 *   label: string,
 *   value: number,
 *   valueText: string,
 *   min: number,
 *   max: number | undefined,
 *   editable: boolean,
 *   editValue: number,
 *   editLabel: string,
 *   span?: Vec3,
 * }} ViewerHandle a handle with its slider semantics, for StlViewer's `handles`
 */

const AXIS_ORDER = ["x", "y", "xy", "z"];
const AXIS_LETTERS = { x: "W", y: "D", z: "H", xy: "⌀" };
const AXIS_NAMES = { x: "Width", y: "Depth", z: "Height", xy: "Diameter" };
// One keyboard stop per axis: the mirrored handle of a symmetric resize
// does exactly the same job, and a corner drives two parameters, which a
// one-value slider can't express.
const TABBABLE = new Set(["x+", "y+", "z+", "xy:x+"]);
// With the grid off, a free length still lands on hundredths of a mm —
// finer is noise from the pointer, not a size anyone means.
const OFF_PRECISION = 100;
// The smallest outside size change a keyboard step makes with the grid off.
const MIN_KEY_STEP_MM = 0.1;

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const positive = (v) => (isNumber(v) && v > 0 ? v : null);
// Strips float tails (0.1·3 = 0.30000000000000004) from values that end
// up in generated .scad, the URL and labels.
const clean = (v) => Math.round(v * 1e6) / 1e6;

/**
 * The resize axes that apply to a part with these parameters: the
 * entries whose `when` matches and whose parameter has a numeric default,
 * bounds resolved. Order: x, y, xy, z.
 *
 * Mirrored by tests/conftest.py's resize_bounds() (the bounds) and
 * resize_applies() (`when`, compared as === compares), which the render
 * tests (tests/test_resize.py, test_catalogue.py) use to pick the sizes
 * they render: change both or neither, or those tests go on checking a
 * range the handles no longer reach.
 * @param {any} part a catalogue entry
 * @param {Record<string, any>} [params] the current parameters (merged over the defaults)
 * @returns {ResizeAxis[]}
 */
export function resizeAxes(part, params = {}) {
  const resize = part?.resize;
  if (!resize || typeof resize !== "object") return [];
  const defaults = part.defaults ?? {};
  const current = { ...defaults, ...params };
  /** @type {ResizeAxis[]} */
  const out = [];
  for (const axis of AXIS_ORDER) {
    const entry = resize[axis];
    if (!entry || typeof entry !== "object") continue;
    // The schema test forbids x/y next to xy; if a hand-edited catalogue
    // has both anyway, the diameter wins rather than two handle sets
    // fighting over the footprint.
    if ((axis === "x" || axis === "y") && resize.xy) continue;
    const { param } = entry;
    if (typeof param !== "string" || !isNumber(defaults[param])) continue;
    if (entry.when && typeof entry.when === "object") {
      if (!Object.entries(entry.when).every(([k, v]) => current[k] === v)) continue;
    }
    const per = positive(entry.per) ?? 1;
    const step = positive(entry.step);
    // Lower bound: the catalogue's floor and the entry's own, else one
    // step of a count, else 0.1 mm of outside size — never 0 or below,
    // which no part renders.
    const floor = step ?? MIN_KEY_STEP_MM / per;
    const lows = [part.minimums?.[param], entry.min].filter(isNumber);
    let min = lows.length ? Math.max(...lows) : floor;
    if (!(min > 0)) min = floor;
    const highs = [part.maximums?.[param], entry.max].filter(isNumber);
    const max = Math.max(min, highs.length ? Math.min(...highs) : Infinity);
    out.push({ axis, param, per, step, min, max });
  }
  return out;
}

/**
 * The handles for a box and the part's resize axes. Footprint handles sit
 * on the bottom edges (TinkerCAD puts them on the workplane), the height
 * handle on the top face's centre.
 * @param {Box} box
 * @param {ResizeAxis[]} axes
 * @returns {ResizeHandle[]}
 */
export function handlesForBox(box, axes) {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const has = (key) => axes.some((a) => a.axis === key);
  /** @type {ResizeHandle[]} */
  const handles = [];
  const line = (dir) => ({ type: "line", dir });
  const edge = (id, axis, dir, point) =>
    handles.push({
      id,
      kind: "edge",
      axes: [axis],
      dir,
      point,
      tabbable: TABBABLE.has(id),
      constraint: line(dir),
    });
  if (has("x")) {
    edge("x+", "x", [1, 0, 0], [x1, cy, z0]);
    edge("x-", "x", [-1, 0, 0], [x0, cy, z0]);
  }
  if (has("y")) {
    edge("y+", "y", [0, 1, 0], [cx, y1, z0]);
    edge("y-", "y", [0, -1, 0], [cx, y0, z0]);
  }
  if (has("x") && has("y")) {
    const r = Math.SQRT1_2;
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      handles.push({
        id: `x${sx > 0 ? "+" : "-"}y${sy > 0 ? "+" : "-"}`,
        kind: "corner",
        axes: ["x", "y"],
        dir: [sx * r, sy * r, 0],
        point: [sx > 0 ? x1 : x0, sy > 0 ? y1 : y0, z0],
        tabbable: false,
        constraint: { type: "plane", normal: [0, 0, 1] },
      });
    }
  }
  if (has("xy")) {
    edge("xy:x+", "xy", [1, 0, 0], [x1, cy, z0]);
    edge("xy:x-", "xy", [-1, 0, 0], [x0, cy, z0]);
    edge("xy:y+", "xy", [0, 1, 0], [cx, y1, z0]);
    edge("xy:y-", "xy", [0, -1, 0], [cx, y0, z0]);
  }
  if (has("z")) {
    handles.push({
      id: "z+",
      kind: "top",
      axes: ["z"],
      dir: [0, 0, 1],
      point: [cx, cy, z1],
      tabbable: true,
      constraint: line([0, 0, 1]),
    });
  }
  return handles;
}

/**
 * The handle on the opposite side that a symmetric resize moves in step
 * with `id` (x+ ↔ x-, a corner ↔ the diagonally opposite one), or null
 * for the height handle, which has none.
 * @param {string} id
 * @returns {string | null}
 */
export function mirrorHandleId(id) {
  if (id === "z+") return null;
  return id.replace(/[+-]/g, (c) => (c === "+" ? "-" : "+"));
}

/**
 * Bounds for one gesture: the axis's own, widened to include the start
 * value. A part set past a handle bound in the sidebar (gx 12 with a
 * handle max of 8) must not jump to the bound the moment a drag starts;
 * it can still be dragged back down.
 */
function boundsFrom(axis, startValue) {
  return [Math.min(axis.min, startValue), Math.max(axis.max, startValue)];
}

/**
 * The parameter value for a new outside size along one axis, snapped and
 * clamped: a count rounds to its step; a free length (per = 1) snaps the
 * value itself to multiples of the grid, so 40.3 goes to 41, not 41.3; a
 * free parameter with another slope snaps the size change to the grid;
 * grid 0 (Off) rounds to 0.01.
 * @param {ResizeAxis} axis
 * @param {number} startValue the parameter when the gesture started
 * @param {number} startSize the measured outside size along the axis then
 * @param {number} newSize the outside size the pointer asks for
 * @param {number} [gridMm] the grid (uiPrefs.js's getGridSnap()); 0 is off
 * @returns {{ value: number, size: number, clamped: boolean }}
 */
export function resizeValue(axis, startValue, startSize, newSize, gridMm = 0) {
  const unchanged = { value: startValue, size: startSize, clamped: false };
  if (![startValue, startSize, newSize].every(Number.isFinite) || newSize === startSize) return unchanged;
  const { per, step } = axis;
  const raw = startValue + (newSize - startSize) / per;
  let value;
  if (step) value = Math.round(raw / step) * step;
  else if (per === 1) value = gridMm > 0 ? Math.round(raw / gridMm) * gridMm : roundOff(raw);
  else if (gridMm > 0) value = startValue + (Math.round((newSize - startSize) / gridMm) * gridMm) / per;
  else value = roundOff(raw);
  if (!Number.isFinite(value)) return unchanged;
  const [lo, hi] = boundsFrom(axis, startValue);
  const clamped = value < lo || value > hi;
  value = clean(Math.min(hi, Math.max(lo, value)));
  return { value, size: clean(startSize + (value - startValue) * per), clamped };
}

function roundOff(v) {
  return Math.round(v * OFF_PRECISION) / OFF_PRECISION;
}

/**
 * One keyboard step (an arrow key on a focused handle): a count moves by
 * `steps` of its step, a free length by `steps` grid increments of
 * outside size (0.1 mm with the grid off). A free length with slope 1
 * lands on the grid, like a drag: from 40.3 on a 1 mm grid, up is 41 and
 * down is 40. Shift ×10 is the caller's, for free lengths only — ten
 * Gridfinity units is 420 mm.
 * @param {ResizeAxis} axis
 * @param {number} value the current parameter value
 * @param {number} steps signed number of steps
 * @param {number} [gridMm]
 * @returns {number}
 */
export function stepValue(axis, value, steps, gridMm = 0) {
  return stepWithin(axis, value, steps, gridMm).value;
}

function stepWithin(axis, value, steps, gridMm) {
  if (!Number.isFinite(value) || !Number.isFinite(steps) || steps === 0) return { value, clamped: false };
  let next;
  if (axis.step) next = value + steps * axis.step;
  else if (axis.per === 1 && gridMm > 0) {
    // The first step from an off-grid value goes to the neighbouring grid
    // line; the epsilon keeps 40.3 / 0.1 = 402.99999… on its own line.
    const base = steps > 0 ? Math.floor(value / gridMm + 1e-9) : Math.ceil(value / gridMm - 1e-9);
    next = (base + steps) * gridMm;
  } else next = value + (steps * Math.max(gridMm, MIN_KEY_STEP_MM)) / axis.per;
  if (!Number.isFinite(next)) return { value, clamped: false };
  const [lo, hi] = boundsFrom(axis, value);
  return { value: clean(Math.min(hi, Math.max(lo, next))), clamped: next < lo || next > hi };
}

function boxSize(box) {
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

function finiteBox(box) {
  const corners = box ? [...box.min.slice(0, 3), ...box.max.slice(0, 3)] : [];
  return corners.length === 6 && corners.every(Number.isFinite);
}

// The component of a [x, y, z] size that a handle's axis key measures; an
// xy handle measures the diameter along its own direction.
function sizeAlong(key, handle, size) {
  if (key === "z") return size[2];
  if (key === "y") return size[1];
  if (key === "xy") return Math.abs(handle.dir[1]) > Math.abs(handle.dir[0]) ? size[1] : size[0];
  return size[0];
}

/**
 * Shared by drag, typed size and keyboard step: `valueFor(axis, key,
 * startValue, startSize)` gives each driven axis its new `{ value,
 * clamped }`; this assembles the result and the predicted box (centred
 * where the start box was in X/Y, its bottom where it was).
 * @param {ResizeHandle} handle
 * @param {ResizeAxis[]} axes
 * @param {Box} box
 * @param {Record<string, any>} startParams
 * @param {(axis: ResizeAxis, key: string, startValue: number, startSize: number) => { value: number, clamped: boolean }} valueFor
 * @returns {ResizeResult | null}
 */
function resizeResult(handle, axes, box, startParams, valueFor) {
  if (!handle || !finiteBox(box)) return null;
  const size = boxSize(box);
  const next = [...size];
  /** @type {Record<string, number>} */
  const params = {};
  /** @type {Record<string, number>} */
  const values = {};
  let clamped = false;
  for (const key of handle.axes) {
    const axis = axes.find((a) => a.axis === key);
    if (!axis) return null;
    const startValue = startParams?.[axis.param];
    if (!isNumber(startValue)) return null;
    const r = valueFor(axis, key, startValue, sizeAlong(key, handle, size));
    values[axis.param] = r.value;
    if (r.value !== startValue) params[axis.param] = r.value;
    clamped ||= r.clamped;
    const grown = (r.value - startValue) * axis.per;
    if (key === "x" || key === "xy") next[0] = clean(size[0] + grown);
    if (key === "y" || key === "xy") next[1] = clean(size[1] + grown);
    if (key === "z") next[2] = clean(size[2] + grown);
  }
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const z0 = box.min[2];
  return {
    params,
    values,
    box: {
      min: [cx - next[0] / 2, cy - next[1] / 2, z0],
      max: [cx + next[0] / 2, cy + next[1] / 2, z0 + next[2]],
    },
    sizes: { x: next[0], y: next[1], z: next[2] },
    clamped,
  };
}

/**
 * A pointer drag of `handle` to `point` (the constrained point from
 * dragMath.js): the new parameters and the predicted box.
 * @param {{
 *   handle: ResizeHandle,
 *   axes: ResizeAxis[],
 *   box: Box,
 *   startParams: Record<string, any>,
 *   point: Vec3,
 *   gridMm?: number,
 * }} drag `box` and `startParams` as they were when the drag started
 *   (the measured box and the full parameter set)
 * @returns {ResizeResult | null} null for a missing or non-finite input,
 *   or a handle whose axes aren't in `axes`
 */
export function dragResize({ handle, axes, box, startParams, point, gridMm = 0 }) {
  if (!handle || !Array.isArray(point) || !point.slice(0, 3).every(Number.isFinite)) return null;
  if (!finiteBox(box)) return null;
  const size = boxSize(box);
  let d = [point[0] - handle.point[0], point[1] - handle.point[1], point[2] - handle.point[2]];
  // One gesture can't ask for more than about 4× the size it started at
  // (or the box's diagonal, for a thin part): a flick past the edge of a
  // perspective view would otherwise commit a grid that takes minutes to
  // render, or never does in WASM.
  const along = Math.max(...handle.axes.map((key) => sizeAlong(key, handle, size)));
  const cap = Math.max(4 * along, Math.hypot(...size), 1);
  const travel = Math.hypot(...d);
  if (travel > cap) d = d.map((c) => (c * cap) / travel);
  return resizeResult(handle, axes, box, startParams, (axis, key, startValue, startSize) => {
    let newSize;
    if (key === "z") newSize = startSize + d[2];
    else if (key === "xy") newSize = startSize + 2 * (d[0] * handle.dir[0] + d[1] * handle.dir[1]);
    else {
      // Symmetric: the opposite edge moves out as far, so the size grows
      // by twice the travel. A corner reads its X and Y travel separately.
      const i = key === "x" ? 0 : 1;
      newSize = startSize + 2 * d[i] * Math.sign(handle.dir[i]);
    }
    return resizeValue(axis, startValue, startSize, newSize, gridMm);
  });
}

/**
 * A size typed into the handle's editor (mm, the outside size along the
 * handle's axis — the diameter for an xy handle). Not snapped to the
 * grid — the user said exactly what they want — but a count still rounds
 * to its step, and the handle's bounds apply. Meant for edge and height
 * handles; a corner sets both axes to `mm`.
 * @param {{ handle: ResizeHandle, axes: ResizeAxis[], box: Box, startParams: Record<string, any>, mm: number }} edit
 * @returns {ResizeResult | null}
 */
export function typedResize({ handle, axes, box, startParams, mm }) {
  if (!isNumber(mm)) return null;
  return resizeResult(handle, axes, box, startParams, (axis, key, startValue, startSize) =>
    resizeValue(axis, startValue, startSize, mm, 0),
  );
}

/**
 * An arrow key on a focused handle: `steps` (signed) through stepValue().
 * The predicted box follows from the slope.
 * @param {{
 *   handle: ResizeHandle,
 *   axes: ResizeAxis[],
 *   box: Box,
 *   startParams: Record<string, any>,
 *   steps: number,
 *   gridMm?: number,
 * }} step
 * @returns {ResizeResult | null}
 */
export function stepResize({ handle, axes, box, startParams, steps, gridMm = 0 }) {
  return resizeResult(handle, axes, box, startParams, (axis, key, startValue) =>
    stepWithin(axis, startValue, steps, gridMm),
  );
}

// --- Ghost and labels -------------------------------------------------------

/**
 * The 12 edges of a box, as [from, to] segments (the drag ghost).
 * @param {Box} box
 * @returns {[Vec3, Vec3][]}
 */
export function boxEdges(box) {
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  /** @type {Vec3[]} */
  const c = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  /** @type {[number, number][]} */
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return pairs.map(([a, b]) => [c[a], c[b]]);
}

/**
 * A small cross at the centre of the box's footprint, `sizeMm` across —
 * shown during an X/Y drag so it is plain the part grows about its
 * centre, not from the far edge.
 * @param {Box} box
 * @param {number} sizeMm
 * @returns {[Vec3, Vec3][]}
 */
export function centreCross(box, sizeMm) {
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const z = box.min[2];
  const h = sizeMm / 2;
  return [
    [
      [cx - h, cy, z],
      [cx + h, cy, z],
    ],
    [
      [cx, cy - h, z],
      [cx, cy + h, z],
    ],
  ];
}

/**
 * The letter the part header's "W × H × D" uses for an axis key: X is
 * width, Y depth, Z height; "⌀" for a diameter.
 * @param {string} axis
 */
export function axisLetter(axis) {
  return AXIS_LETTERS[axis] ?? axis.toUpperCase();
}

/**
 * Millimetres for a label: three decimals at most, no float tails —
 * the same rule as the part header's dimensions (outsideDimensions.js).
 * @param {number} value
 */
export function formatMm(value) {
  return Number(value.toFixed(3)).toString();
}

// A parameter value for a label; a non-number (a half-typed field) as is.
function formatValue(value) {
  return isNumber(value) ? formatMm(value) : String(value);
}

function signed(value) {
  return `${value < 0 ? "−" : "+"}${formatMm(Math.abs(value))}`;
}

// "W 126 mm · gx 3 (+21 each side)", "H 12 mm (+2)", "W 52 mm (−6 each
// side)", "W 336 mm · gx 8 (+126 each side) · max".
function axisText(key, axis, size, startSize, value, atBound) {
  const letter = axisLetter(key);
  const count = axis.step ? ` · ${axis.param} ${formatValue(value)}` : "";
  const delta = clean(size - startSize);
  let change = "";
  if (delta !== 0) change = key === "z" ? ` (${signed(delta)})` : ` (${signed(delta / 2)} each side)`;
  return `${letter} ${formatMm(size)} mm${count}${change}${atBound ? ` · ${atBound}` : ""}`;
}

/**
 * The drag label: the new size along each axis the handle drives, the
 * count when it is a count, and how far each side moved — the part grows
 * on both sides, which is the one thing about it that differs from
 * TinkerCAD's default. "· max" / "· min" when a bound stopped it.
 * @param {ResizeHandle} handle
 * @param {ResizeAxis[]} axes
 * @param {Box} startBox the box the gesture started from
 * @param {ResizeResult} result from dragResize(), typedResize() or stepResize()
 * @returns {string}
 */
export function resizeText(handle, axes, startBox, result) {
  const start = boxSize(startBox);
  const parts = [];
  for (const key of handle.axes) {
    const axis = axes.find((a) => a.axis === key);
    if (!axis) continue;
    const value = result.values[axis.param];
    const startSize = sizeAlong(key, handle, start);
    const size = sizeAlong(key, handle, [result.sizes.x, result.sizes.y, result.sizes.z]);
    const atBound = result.clamped ? (value >= axis.max ? "max" : value <= axis.min ? "min" : null) : null;
    parts.push(axisText(key, axis, size, startSize, value, atBound));
  }
  return parts.join(", ");
}

/**
 * Everything StlViewer's `handles` prop needs for a part: handlesForBox()
 * plus the slider semantics (label, value, bounds), the hover readout and
 * the inline editor's prefill. `value` is the parameter (gx 2, w 40 mm);
 * `editValue` is the outside size in mm, which is what the editor asks
 * for. Corners are pointer-only (not editable, not tab stops). A
 * footprint handle stands on the bottom edge, but the box's side rises
 * from there: `span` (+Z, the box's height) tells the viewer, which draws
 * the grab target clear of that whole side — seen from above, the top rim
 * of a tall part projects outside the bottom edge.
 * @param {Box} box the measured (or pending predicted) box
 * @param {ResizeAxis[]} axes
 * @param {Record<string, any>} params the full current parameters
 * @returns {ViewerHandle[]}
 */
export function viewerHandles(box, axes, params) {
  const size = boxSize(box);
  return handlesForBox(box, axes).map((h) => {
    const named = h.axes.map((key) => ({ key, axis: axes.find((a) => a.axis === key) }));
    const first = named[0].axis;
    const value = Number(params[first.param]);
    // The bounds a gesture from here actually has (boundsFrom()): a value
    // set past a handle bound in the sidebar widens them, and
    // aria-valuenow must never sit outside aria-valuemin/max.
    const [min, max] = Number.isFinite(value) ? boundsFrom(first, value) : [first.min, first.max];
    // "Width (gx)", "Width and depth (gx, gy)" for a corner.
    const name = named
      .map(({ key }, i) => (i ? AXIS_NAMES[key].toLowerCase() : AXIS_NAMES[key]))
      .join(" and ");
    // "84 mm · gx 2" (a count), "40 mm" (a length).
    const valueText = named
      .map(({ key, axis }) => {
        const mm = `${formatMm(sizeAlong(key, h, size))} mm`;
        return axis.step ? `${mm} · ${axis.param} ${formatValue(params[axis.param])}` : mm;
      })
      .join(", ");
    const editValue = sizeAlong(h.axes[0], h, size);
    return {
      ...h,
      label: `${name} (${named.map(({ axis }) => axis.param).join(", ")})`,
      value,
      valueText,
      min,
      max: Number.isFinite(max) ? max : undefined,
      editable: h.kind !== "corner",
      editValue: Number(editValue.toFixed(3)),
      editLabel: `${AXIS_NAMES[h.axes[0]]} (mm)`,
      ...(h.kind !== "top" && size[2] > 0 ? { span: [0, 0, size[2]] } : {}),
    };
  });
}
