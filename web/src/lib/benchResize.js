// The Bench's side of the resize handles (lib/resize.js does the sizes):
// the children guard that keeps a resize from pulling the slots out from
// under the parts attached to the resized one, the ghost a drag or a
// pending commit shows, the frame an attached part's handles are built
// in, and the bookkeeping that tells the Bench whether a node's measured
// extents are still the ones for its parameters. Pure, no React or
// three.js; Bench.jsx wires state to them.
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
import { boxEdges, centreCross, formatMm, handlesForBox, resizeAxes } from "./resize.js";

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
 * already miss an occupied name (the part was shrunk in the sidebar), the
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
 * }} gesture `part` is the resized part's catalogue entry (the root or an
 *   attached part, whose box is in its own frame), `box` and `startParams`
 *   what the gesture started from (the box measured or predicted for
 *   `startParams`, and the full parameters), `occupied` the slot names the
 *   part's own children sit on, `gridMm` the grid a free length moves on (0
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
 * bottom on z = 0, as the root is placed (benchPick.js) — and an attached
 * part's, in the frame its handles are built in (attachedFrame()).
 * @param {Vec3} extents
 * @returns {Box}
 */
export function rootBoxFor([ex, ey, ez]) {
  return { min: [-ex / 2, -ey / 2, 0], max: [ex / 2, ey / 2, ez] };
}

// --- Handles on an attached part --------------------------------------------
//
// The handles and the guard above work on a box that sits like the
// root's: centred in X/Y, bottom on z = 0, growing up. An attached part
// is placed by its "mount" anchor instead, turned however its slot and
// spin turn it, so its handles are built in a frame of its own where its
// box sits exactly like that, and only what goes to the viewer (handle
// points, directions, constraints, the ghost) and what comes back (the
// dragged point) crosses into world space. The frame's origin is the
// centre of the part's mating face and its +Z points away from the
// parent, through the part: the mating face stays on the slot, so the
// height grows outward, and X/Y grow about the centre, which stays put
// as long as the mount offset does (attachedResizeAxes()).

/**
 * @typedef {{ rotation: number[][], origin: Vec3 }} Frame
 *   world = origin + rotation · local; `rotation` a 3×3 rows array
 */

/** @type {Frame} */
export const WORLD_FRAME = Object.freeze({
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  origin: [0, 0, 0],
});

const applyRows = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/**
 * The frame an attached part's handles are built in (see above), from
 * its world rotation and where its "mount" anchor is
 * (benchOrientation.js's nodeWorldMount()). The mating face's centre is
 * the mount point less the mount offset; the frame is the part's own
 * turned half a turn about Y, so its +Z runs from that face into the
 * part (the part's own −Z) — a proper rotation, X mirrored and Y kept,
 * which a symmetric resize doesn't notice. About Y because that undoes
 * attach()'s own half turn: a part on the root's top at spin 0 gets
 * exactly the root's frame, its X handles on world ±X as the root's.
 * @param {{ rotation: number[][], mount: Vec3 }} placed
 * @param {number[]} offset the part's mount offset [x, y] (slots.js's mountOffset())
 * @returns {Frame}
 */
export function attachedFrame({ rotation, mount }, [ox, oy]) {
  const back = applyRows(rotation, [ox, oy, 0]);
  return {
    rotation: rotation.map((row) => [-row[0], row[1], -row[2]]),
    origin: mount.map((v, i) => v - back[i]),
  };
}

/**
 * A frame point in world space.
 * @param {Frame} frame
 * @param {Vec3} point
 * @returns {Vec3}
 */
export function toWorld(frame, point) {
  const turned = applyRows(frame.rotation, point);
  return turned.map((v, i) => v + frame.origin[i]);
}

/**
 * A world point in the frame (the inverse of toWorld(): the rotation's
 * transpose).
 * @param {Frame} frame
 * @param {Vec3} point
 * @returns {Vec3}
 */
export function toFrame(frame, point) {
  const d = [0, 1, 2].map((i) => point[i] - frame.origin[i]);
  const r = frame.rotation;
  return [0, 1, 2].map((j) => r[0][j] * d[0] + r[1][j] * d[1] + r[2][j] * d[2]);
}

/**
 * Handles built on a frame box (viewerHandles() or handlesForBox()), in
 * world space: points moved, directions, constraints and spans turned.
 * The root's frame is the world's, and its handles come back as they were.
 * @template {import("./resize.js").ResizeHandle & { span?: Vec3 }} H
 * @param {Frame} frame
 * @param {H[]} handles
 * @returns {H[]}
 */
export function handlesToWorld(frame, handles) {
  if (frame === WORLD_FRAME) return handles;
  const turn = (v) => applyRows(frame.rotation, v);
  return handles.map((h) => {
    const { constraint } = h;
    return {
      ...h,
      point: toWorld(frame, h.point),
      dir: turn(h.dir),
      constraint: {
        ...constraint,
        ...(constraint.dir ? { dir: turn(constraint.dir) } : {}),
        ...(constraint.normal ? { normal: turn(constraint.normal) } : {}),
      },
      ...(h.span ? { span: turn(h.span) } : {}),
    };
  });
}

/**
 * A ghost (resizeGhost()'s, with whatever else the viewer takes beside
 * it: a label, the moved handles' points) in world space.
 * @template {{ segments: Vec3[][], textPoint: Vec3, handlePoints?: Record<string, Vec3> }} G
 * @param {Frame} frame
 * @param {G} ghost
 * @returns {G}
 */
export function ghostToWorld(frame, ghost) {
  if (frame === WORLD_FRAME) return ghost;
  const out = {
    ...ghost,
    segments: ghost.segments.map((segment) => segment.map((p) => toWorld(frame, p))),
    textPoint: toWorld(frame, ghost.textPoint),
  };
  if (ghost.handlePoints) {
    out.handlePoints = Object.fromEntries(
      Object.entries(ghost.handlePoints).map(([id, p]) => [id, toWorld(frame, p)]),
    );
  }
  return out;
}

/**
 * The world axis-aligned box around a frame box — the selection outline
 * and the camera's fit box, which the viewer takes axis-aligned. Exact
 * whenever the part is square to the world (spins in quarter turns), a
 * little generous at other angles; the handles stand on the true faces
 * either way.
 * @param {Frame} frame
 * @param {Box} box
 * @returns {Box}
 */
export function worldBoundsOf(frame, box) {
  if (frame === WORLD_FRAME) return box;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const p = toWorld(frame, [x, y, z]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], clean(p[i]));
          max[i] = Math.max(max[i], clean(p[i]));
        }
      }
  return { min, max };
}

/**
 * The resize axes an attached part's handles get: resize.js's, unless a
 * parameter one of them drives also moves the part's "mount" anchor off
 * its face centre (a `mount_offset` that names it). The part grows about
 * its centre, so the anchor moving would carry the whole part sideways
 * on its slot, and the ghost would show it growing in place — such a
 * part is resized in the sidebar. (No catalogue part has both today:
 * the GoPro female's offset follows `outer_w`, which has no handle.)
 * @param {any} part a catalogue entry
 * @param {Record<string, any>} params its full parameters
 * @returns {ResizeAxis[]}
 */
export function attachedResizeAxes(part, params) {
  if (!part || part.kind === "imported") return [];
  const axes = resizeAxes(part, params);
  const spec = part.mount_offset;
  if (!spec || Array.isArray(spec)) return axes;
  const moving = new Set();
  for (const expr of [spec.x, spec.y]) {
    if (expr && typeof expr === "object") {
      if (expr.param) moving.add(expr.param);
      if (expr.unless) moving.add(expr.unless);
    }
  }
  return axes.some((a) => moving.has(a.param)) ? [] : axes;
}
