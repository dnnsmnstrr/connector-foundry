// The Bench's side of the resize handles (lib/resize.js does the sizes):
// the children guard that keeps a root resize from pulling the slots out
// from under the parts attached to it, the ghost a drag or a pending
// commit shows, and the bookkeeping that tells the Bench whether a node's
// measured extents are still the ones for its parameters. Pure, no React
// or three.js; Bench.jsx wires state to them.
//
// Why a guard at all: an attached part names the slot it sits on
// ("mount_1_0", "xpos_-0.5"), and the generated .scad attaches it there by
// that name. Slot names are centre-relative indices (slots.js), so a grid
// that shrinks loses its outer names, and a count-parameter grid that
// changes parity renames every slot (2 cells: ±0.5; 3 cells: −1, 0, 1).
// A name that stops existing is BOSL2's "Unknown anchor" on the next
// render. So a resize only ever lands on a value that keeps every
// occupied name: from the value asked for, the nearest one further the
// same way (2 → 3 on an openGrid board with parts on it becomes 2 → 4),
// else the nearest one back toward where the gesture started.

import { enumerateSlots } from "./slots.js";
import { boxEdges, centreCross, formatMm, handlesForBox } from "./resize.js";

/**
 * @typedef {import("./resize.js").Box} Box
 * @typedef {import("./resize.js").Vec3} Vec3
 * @typedef {import("./resize.js").ResizeAxis} ResizeAxis
 * @typedef {import("./resize.js").ResizeHandle} ResizeHandle
 * @typedef {import("./resize.js").ResizeResult} ResizeResult
 * @typedef {{ extents: Map<string, Vec3>, params: Map<string, Record<string, any> | null> }} NodeExtents
 *   each node's own standalone extents, and the parameters they were rendered with
 * @typedef {{ param: string, value: number, count: boolean }} Refusal
 *   a value the guard turned down; `count` when the axis is a stepped count
 */

// How many candidate values one search looks at before giving up on that
// direction. Counts never come near it (a handle's max is a few dozen
// steps at most); a free length with the grid off moves in 0.01 mm, which
// would be thousands of checks per pointer move.
const MAX_SCAN = 400;

// Strips float tails, as resize.js does (0.1·3 = 0.30000000000000004).
const clean = (v) => Math.round(v * 1e6) / 1e6;

/** @type {NodeExtents} */
export const NO_EXTENTS = Object.freeze({ extents: new Map(), params: new Map() });

/**
 * Whether two parameter objects hold the same values (a shallow compare:
 * Bench parameters are flat scalars). An edit rebuilds the object even
 * when nothing changed, and undo restores older objects with the same
 * values, so identity is not enough to say "rendered for these".
 * @param {Record<string, any> | null | undefined} a
 * @param {Record<string, any> | null | undefined} b
 */
export function sameParams(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

function sameExtents(a, b) {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The next node-extents state from a fresh round of measurements: `prev`
 * itself when every node measured the same, for the same parameters —
 * the markers, boxes and slot lists memoised on it then don't rebuild on
 * an edit that changed no node's size (a rotation, a joint, the bench's
 * name) — else new Maps.
 * @param {NodeExtents} prev
 * @param {[string, Vec3, Record<string, any> | null][]} entries [node id, extents, parameters rendered with]
 * @returns {NodeExtents}
 */
export function mergeExtents(prev, entries) {
  const unchanged =
    entries.length === prev.extents.size &&
    entries.every(
      ([id, extents, params]) =>
        sameExtents(prev.extents.get(id), extents) &&
        prev.params.has(id) &&
        sameParams(prev.params.get(id), params),
    );
  if (unchanged) return prev;
  return {
    extents: new Map(entries.map(([id, extents]) => [id, extents])),
    params: new Map(entries.map(([id, , params]) => [id, params])),
  };
}

/**
 * The extents a part would measure with some of its resize parameters
 * changed: each axis grows by its slope times the change, as the ghost
 * predicts (lib/resize.js).
 * @param {Vec3} extents measured with `startParams`
 * @param {ResizeAxis[]} axes
 * @param {Record<string, any>} startParams
 * @param {Record<string, number>} change the parameters that differ, with their new values
 * @returns {Vec3}
 */
export function predictedExtents(extents, axes, startParams, change) {
  const next = [...extents];
  for (const { axis, param, per } of axes) {
    if (!(param in change)) continue;
    const grown = (change[param] - Number(startParams[param])) * per;
    if (!Number.isFinite(grown)) continue;
    if (axis === "x" || axis === "xy") next[0] += grown;
    if (axis === "y" || axis === "xy") next[1] += grown;
    if (axis === "z") next[2] += grown;
  }
  return next.map(clean);
}

/**
 * Whether `part` with these parameters and extents still has a slot of
 * every name in `occupied`.
 * @param {any} part a catalogue entry
 * @param {Record<string, any>} params its full parameters
 * @param {Vec3} extents
 * @param {Set<string>} occupied
 */
export function keepsSlots(part, params, extents, occupied) {
  if (occupied.size === 0) return true;
  const names = new Set(enumerateSlots(part, params, extents).map((s) => s.name));
  for (const name of occupied) if (!names.has(name)) return false;
  return true;
}

// The ResizeResult for `values` (every driven parameter's value), built
// the way resize.js builds one: the start box grown about its X/Y centre
// and up from its bottom.
function resultFor(handle, axes, box, startParams, values, clamped) {
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  const next = [...size];
  /** @type {Record<string, number>} */
  const params = {};
  for (const key of handle.axes) {
    const axis = axes.find((a) => a.axis === key);
    if (!axis) continue;
    const value = values[axis.param];
    if (value !== startParams[axis.param]) params[axis.param] = value;
    const grown = (value - startParams[axis.param]) * axis.per;
    if (key === "x" || key === "xy") next[0] = clean(size[0] + grown);
    if (key === "y" || key === "xy") next[1] = clean(size[1] + grown);
    if (key === "z") next[2] = clean(size[2] + grown);
  }
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const z0 = box.min[2];
  return {
    params,
    values: { ...values },
    box: {
      min: [cx - next[0] / 2, cy - next[1] / 2, z0],
      max: [cx + next[0] / 2, cy + next[1] / 2, z0 + next[2]],
    },
    sizes: { x: next[0], y: next[1], z: next[2] },
    clamped,
  };
}

// From `candidate` (which fails), the nearest value further in direction
// `dir` that passes, within [lo, hi] — or null.
function searchAhead(passes, candidate, dir, unit, lo, hi) {
  for (let k = 1; k <= MAX_SCAN; k++) {
    const value = clean(candidate + dir * k * unit);
    if (value < lo || value > hi) return null;
    if (passes(value)) return value;
  }
  return null;
}

// From `candidate` (which fails) back toward `start` (which passes), the
// nearest value that passes; `start` itself at worst, never past it.
function searchBack(passes, candidate, start, unit) {
  const dir = Math.sign(start - candidate);
  const steps = Math.round(Math.abs(start - candidate) / unit);
  const at = (k) => (k >= steps ? start : clean(candidate + dir * k * unit));
  if (steps <= MAX_SCAN) {
    for (let k = 1; k < steps; k++) if (passes(at(k))) return at(k);
    return start;
  }
  // Too fine to walk (a free length with the grid off): bisect for the
  // edge between failing and passing. That is exact for the one kind of
  // grid a free length drives, a nearest-odd subdivision of the measured
  // size (an extrusion rail's), which only ever gains slots as it grows.
  let fail = 0;
  let pass = steps;
  while (pass - fail > 1) {
    const mid = Math.floor((fail + pass) / 2);
    if (passes(at(mid))) pass = mid;
    else fail = mid;
  }
  return at(pass);
}

/**
 * The children guard: `result` (from resize.js's dragResize, stepResize or
 * typedResize) with every driven value that would drop an occupied slot
 * name replaced by the nearest one that doesn't — first further in the
 * gesture's direction, up to the handle's bound (a count-parameter grid
 * with parts on it moves in steps of 2, so the names keep their parity),
 * then back toward the start value, never past it. When the start values
 * already miss an occupied name (the root was shrunk in the sidebar), the
 * render error is already showing and nothing here can make it right, so
 * the result goes through as asked.
 *
 * Each axis is searched on its own, the others held at their start: slot
 * names factor by axis (mount_<i>_<j>, a side row along one axis), so a
 * corner's two values can be settled one at a time.
 * @param {{
 *   part: any,
 *   axes: ResizeAxis[],
 *   handle: ResizeHandle,
 *   box: Box,
 *   startParams: Record<string, any>,
 *   occupied: Set<string>,
 *   result: ResizeResult | null,
 *   gridMm?: number,
 * }} gesture `part` is the root's catalogue entry, `box` and `startParams`
 *   what the gesture started from (the box measured or predicted for
 *   `startParams`, and the full parameters), `occupied` the slot names the
 *   root's children sit on, `gridMm` the grid a free length moves on (0
 *   for a typed size, which lands on hundredths)
 * @returns {{ result: ResizeResult | null, refused: Refusal[] }}
 */
export function guardResize({ part, axes, handle, box, startParams, occupied, result, gridMm = 0 }) {
  if (!result || occupied.size === 0) return { result, refused: [] };
  const extents = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  const passes = (change) =>
    keepsSlots(
      part,
      { ...startParams, ...change },
      predictedExtents(extents, axes, startParams, change),
      occupied,
    );
  if (!passes({})) return { result, refused: [] };

  const values = { ...result.values };
  /** @type {Refusal[]} */
  const refused = [];
  for (const key of handle.axes) {
    const axis = axes.find((a) => a.axis === key);
    if (!axis) continue;
    const start = startParams[axis.param];
    const candidate = values[axis.param];
    if (candidate === start) continue;
    const ok = (value) => passes({ [axis.param]: value });
    if (ok(candidate)) continue;
    // The unit a value moves in: a count's step, a free length's grid
    // (converted through its slope), or the hundredth a typed size or an
    // off grid rounds to.
    const unit = axis.step ?? (gridMm > 0 ? gridMm / axis.per : 0.01);
    // The bounds a gesture from here has (resize.js's boundsFrom()).
    const lo = Math.min(axis.min, start);
    const hi = Math.max(axis.max, start);
    const dir = Math.sign(candidate - start);
    const value = searchAhead(ok, candidate, dir, unit, lo, hi) ?? searchBack(ok, candidate, start, unit);
    values[axis.param] = value;
    refused.push({ param: axis.param, value: candidate, count: !!axis.step });
  }
  if (!refused.length) return { result, refused };
  return { result: resultFor(handle, axes, box, startParams, values, false), refused };
}

/**
 * Why the guard changed a value, for the drag label and the handle's
 * aria-valuetext: "3 would move attached parts" (a count, whose label
 * already names it: "W 112 mm · cells_x 4"), "len 70 would move attached
 * parts" (a length), or null when nothing was refused.
 * @param {Refusal[]} refused
 */
export function guardNote(refused) {
  if (!refused.length) return null;
  const named = refused.length > 1 || refused.some((r) => !r.count);
  const values = refused.map((r) => (named ? `${r.param} ${formatMm(r.value)}` : formatMm(r.value)));
  return `${values.join(" and ")} would move attached parts`;
}

/**
 * The ghost for a box: its outline, plus a small cross at its footprint's
 * centre when width or depth is changing — the part grows on both sides,
 * and the cross shows where it stays put. The label sits at the dragged
 * handle's new spot.
 * @param {ResizeHandle} handle
 * @param {ResizeAxis[]} axes
 * @param {Box} box
 * @returns {{ segments: Vec3[][], textPoint: Vec3 }}
 */
export function resizeGhost(handle, axes, box) {
  const footprint = handle.axes.some((key) => key !== "z");
  const span = Math.min(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  const cross = Math.min(10, Math.max(2, span * 0.15));
  const moved = handlesForBox(box, axes).find((h) => h.id === handle.id);
  return {
    segments: footprint ? [...boxEdges(box), ...centreCross(box, cross)] : boxEdges(box),
    textPoint: moved?.point ?? box.max,
  };
}

/**
 * The root's box from its extents: centred on the origin in X and Y,
 * bottom on z = 0, as the root is placed (benchPick.js).
 * @param {Vec3} extents
 * @returns {Box}
 */
export function rootBoxFor([ex, ey, ez]) {
  return { min: [-ex / 2, -ey / 2, 0], max: [ex / 2, ey / 2, ez] };
}
