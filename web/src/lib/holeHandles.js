// The Holes tab's handles on the selected hole (StlViewer's `handles`), and
// what a drag, an arrow key or a typed size on one does to the hole. Pure,
// no React or three.js: Holes.jsx wires these to the viewer and commits one
// document change per gesture.
//
// TinkerCAD's conventions where Holes follows them: a rectangle cutout has a
// square handle at the middle of each edge (width along its own sideways,
// height along its direction: slotFrame()'s ex and ey, turned by its spin)
// and one at each corner; a round cutout has one at each quarter of its rim.
// A drag keeps the opposite edge where it is, so the hole's point moves by
// half the change; with Alt (Option) the hole grows about its centre
// instead. Sizes land on the Grid (uiPrefs.js's getGridSnap(); Off rounds to
// 0.01 mm) and never go under HOLE_MIN_MM, the floor normalizeSpec() keeps.
// A round handle at the centre moves the hole across its face, and the arrow
// keys nudge the selected holes the same way: along the face's own sideways
// and up (slotFrame() at spin 0, the axes Repeat lays its patterns out on),
// in grid steps counted from where the hole was. Every handle is
// constrained to the hole's face plane, so no gesture lifts a hole off it.
//
// The round cutout's rim handles sit on the face's sideways and up too
// (slotFrame() at spin 0) rather than on planeBasis()'s arbitrary in-plane
// axes: that way "right" and "top" in their labels mean what they say, the
// handles line up with the arrow-key nudge, and the bottom one is the point
// the selection pill hangs below (holePillAnchor()).
import { formatMm, resizeValue, stepValue } from "./resize.js";
import {
  dot,
  hasDirection,
  holeFootprintRadius,
  isPill,
  normalizeSpec,
  slotFrame,
  slotOutline,
} from "./screwHoles.js";

/**
 * @typedef {number[]} Vec3 [x, y, z], model mm
 * @typedef {import("../components/StlViewer.jsx").ViewerHandle & { side: string, signs: number[] }} HoleHandle
 *   a ViewerHandle plus which side of the hole it is: `side` is "move", "w+",
 *   "h-", "w+h+" (a corner) or "d:x+" (a round cutout's rim), and `signs`
 *   the side's direction along the frame's [ex, ey] (0 where it has none)
 * @typedef {{ spec: any, point: Vec3, sizes: number[], deltas: number[], changed: boolean }} HoleResize
 *   a resized hole: its new spec and point, its new [width, height] (both
 *   the diameter for a round one), how much each changed, and whether
 *   anything did
 */

// The smallest a cutout's width, height or diameter goes — the floor
// screwHoles.js's normalizeSpec() keeps too.
export const HOLE_MIN_MM = 0.1;
// What an arrow key moves a hole by with the Grid off: the old fixed
// placement grid (snapCandidates.js's FREE_GRID_MM), so a nudge still moves.
export const NUDGE_OFF_MM = 0.5;
// A move that lands within this of where the hole was is no move.
const NOISE_MM = 1e-6;
// How far past a hole's own outline movedOnFace() looks for the face it
// sits on: clear of the bore's rim on the mesh on screen.
const BORE_CLEAR_MM = 0.1;
// Segments in a round outline (a ghost of a circle).
const CIRCLE_SEGMENTS = 48;

// The axis every hole size goes through resize.js's snapping with: a free
// length (per 1, no step) with the hole floor and no ceiling.
const SIZE_AXIS = { axis: "x", param: "size", per: 1, step: null, min: HOLE_MIN_MM, max: Infinity };

const RECT_SIDES = [
  { side: "w+", kind: "edge", signs: [1, 0], name: "width (right edge)" },
  { side: "w-", kind: "edge", signs: [-1, 0], name: "width (left edge)" },
  { side: "h+", kind: "edge", signs: [0, 1], name: "height (top edge)" },
  { side: "h-", kind: "edge", signs: [0, -1], name: "height (bottom edge)" },
  { side: "w+h+", kind: "corner", signs: [1, 1], name: "width and height (top right corner)" },
  { side: "w+h-", kind: "corner", signs: [1, -1], name: "width and height (bottom right corner)" },
  { side: "w-h+", kind: "corner", signs: [-1, 1], name: "width and height (top left corner)" },
  { side: "w-h-", kind: "corner", signs: [-1, -1], name: "width and height (bottom left corner)" },
];
const ROUND_SIDES = [
  { side: "d:x+", kind: "edge", signs: [1, 0], name: "diameter (right)" },
  { side: "d:x-", kind: "edge", signs: [-1, 0], name: "diameter (left)" },
  { side: "d:y+", kind: "edge", signs: [0, 1], name: "diameter (top)" },
  { side: "d:y-", kind: "edge", signs: [0, -1], name: "diameter (bottom)" },
];

const isFiniteVec = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite);
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// Float noise off a computed coordinate or size (2.0000000000000004).
const clean = (v) => Number(v.toFixed(6)) || 0;

/**
 * Whether a hole's size has handles: the plain cutouts, whose size is
 * free. Screws and connectors are their hardware's size; they only move.
 * @param {any} spec
 */
export function resizableHole(spec) {
  return spec?.kind === "rectangle" || spec?.kind === "cylinder";
}

/**
 * The frame a hole's handles sit in: a rectangle's own (turned by its
 * spin), anything else's face frame at spin 0.
 * @param {{ point: Vec3, normal: Vec3, spec: any }} hole
 * @returns {{ ex: Vec3, ey: Vec3, n: Vec3 }}
 */
export function holeFrame(hole) {
  return slotFrame(hole.point, hole.normal, hole.spec.kind === "rectangle" ? hole.spec.spin : 0);
}

// A cutout's [width, height]: a round one's diameter both ways.
function sizesOf(spec) {
  return spec.kind === "rectangle" ? [spec.width, spec.height] : [spec.diameter, spec.diameter];
}

// Where a side's handle stands: the middle of its edge, its corner, or its
// quarter of the rim.
function sidePoint(hole, frame, signs) {
  const [w, h] = sizesOf(hole.spec);
  return add(add(hole.point, frame.ex, (signs[0] * w) / 2), frame.ey, (signs[1] * h) / 2);
}

function sideDir(frame, signs) {
  const v = add(
    [0, 0, 0].map((_, i) => frame.ex[i] * signs[0]),
    frame.ey,
    signs[1],
  );
  const len = Math.hypot(...v) || 1;
  return v.map((c) => c / len);
}

/**
 * The handles on one selected hole, ids prefixed with its own id (so
 * switching holes is a new set of handles to the viewer, and its camera
 * never takes it for the same subject grown): the move handle first —
 * drawn under the others, so on a small hole the edge handles stay
 * grabbable — then, for a rectangle, its four edges and four corners, or
 * for a round cutout its four rim handles. Every edge handle is a Tab
 * stop: each one resizes from the opposite edge, so they are four
 * different jobs (in the Library's symmetric resize a mirror is the same
 * job). Corners drive two sizes and are pointer-only; the move handle is
 * pointer-only too — the arrow keys already move the selection.
 * @param {{ id: string, point: Vec3, normal: Vec3, spec: any }} hole
 * @param {number} number the hole's number in the list (1-based), for the labels
 * @returns {HoleHandle[]}
 */
export function holeHandles(hole, number) {
  if (!hole || !isFiniteVec(hole.point) || !isFiniteVec(hole.normal)) return [];
  const frame = holeFrame(hole);
  const plane = { type: "plane", normal: frame.n };
  /** @type {HoleHandle[]} */
  const out = [
    {
      id: `${hole.id}:move`,
      side: "move",
      signs: [0, 0],
      kind: "move",
      point: [...hole.point],
      dir: frame.n,
      constraint: plane,
      label: `Move hole ${number}`,
      value: 0,
      valueText: "Drag to move (Shift: off the grid)",
      tabbable: false,
      editable: false,
    },
  ];
  if (!resizableHole(hole.spec)) return out;
  const rect = hole.spec.kind === "rectangle";
  const [w, h] = sizesOf(hole.spec);
  for (const { side, kind, signs, name } of rect ? RECT_SIDES : ROUND_SIDES) {
    const corner = kind === "corner";
    const size = rect ? (signs[0] ? w : h) : w;
    const sizeText = rect
      ? corner
        ? `${formatMm(w)} × ${formatMm(h)} mm`
        : `${formatMm(size)} mm`
      : `Ø${formatMm(w)} mm`;
    out.push({
      id: `${hole.id}:${side}`,
      side,
      signs,
      kind,
      point: sidePoint(hole, frame, signs).map(clean),
      dir: sideDir(frame, signs),
      constraint: plane,
      label: `Hole ${number} ${name}`,
      value: size,
      valueText: sizeText,
      min: Math.min(HOLE_MIN_MM, size),
      tabbable: !corner,
      editable: !corner,
      editValue: Number(size.toFixed(3)),
      editLabel: rect ? (signs[0] ? "Width (mm)" : "Height (mm)") : "Diameter (mm)",
    });
  }
  return out;
}

/**
 * The side across the hole from `side` — what stays put while `side` is
 * dragged: "w+" ↔ "w-", the corner "w+h-" ↔ "w-h+", "d:x+" ↔ "d:x-".
 * @param {string} side
 */
export function oppositeSide(side) {
  return side.replace(/[+-]/g, (c) => (c === "+" ? "-" : "+"));
}

/**
 * A hole with new sizes along its frame ([width, height]; a round cutout's
 * diameter is the first), kept on the opposite edge unless `symmetric`.
 * @param {{ point: Vec3, normal: Vec3, spec: any }} hole
 * @param {HoleHandle} handle
 * @param {number[]} next the new [width, height] (or [diameter, …])
 * @param {boolean} symmetric
 * @returns {HoleResize | null}
 */
function resizedTo(hole, handle, next, symmetric) {
  const frame = holeFrame(hole);
  const rect = hole.spec.kind === "rectangle";
  const start = sizesOf(hole.spec);
  const deltas = rect ? [next[0] - start[0], next[1] - start[1]] : [next[0] - start[0], next[0] - start[0]];
  let point = [...hole.point];
  if (!symmetric) {
    // The opposite edge stays: the centre follows the dragged edge half way.
    if (rect) {
      point = add(point, frame.ex, (handle.signs[0] * deltas[0]) / 2);
      point = add(point, frame.ey, (handle.signs[1] * deltas[1]) / 2);
    } else point = add(point, handle.dir, deltas[0] / 2);
  }
  if (!isFiniteVec(point) || !next.every(Number.isFinite)) return null;
  // A pill stays a pill (its round ends follow the narrower side); any
  // other corner radius is the user's and stays as typed.
  const pill = rect && isPill(hole.spec) ? { cornerRadius: Math.min(next[0], next[1]) / 2 } : {};
  const spec = normalizeSpec(
    rect ? { ...hole.spec, width: next[0], height: next[1], ...pill } : { ...hole.spec, diameter: next[0] },
  );
  const sizes = sizesOf(spec);
  return {
    spec,
    point: point.map(clean),
    sizes,
    deltas: deltas.map(clean),
    changed: deltas.some((d) => d !== 0),
  };
}

// Which of a handle's sizes it drives: [width?, height?] for a rectangle
// side (a corner both), the diameter alone for a rim handle.
function drives(hole, handle) {
  if (hole.spec.kind !== "rectangle") return [true, false];
  return [handle.signs[0] !== 0, handle.signs[1] !== 0];
}

/**
 * A drag of a resize handle to `point` (the viewer's constrained point on
 * the face plane): each size the handle drives grows by the pointer's
 * travel outward along it — twice that with `symmetric`, both edges moving
 * — snapped to the grid and floored at HOLE_MIN_MM.
 * @param {{
 *   hole: { point: Vec3, normal: Vec3, spec: any },
 *   handle: HoleHandle,
 *   point: Vec3,
 *   symmetric?: boolean,
 *   gridMm?: number,
 *   limitMm?: number,
 * }} drag `hole` and `handle` as they were when the drag started; one
 *   gesture travels at most `limitMm` (the model's size, say) or four times
 *   the hole's size, whichever is more — a flick past the edge of a
 *   perspective view would otherwise ask for a hole metres wide
 * @returns {HoleResize | null} null for a non-finite input or a move handle
 */
export function dragHoleResize({ hole, handle, point, symmetric = false, gridMm = 0, limitMm = 0 }) {
  if (!hole || !handle || handle.side === "move" || !resizableHole(hole.spec)) return null;
  if (!isFiniteVec(point) || !isFiniteVec(handle.point)) return null;
  const frame = holeFrame(hole);
  const start = sizesOf(hole.spec);
  let d = sub(point, handle.point);
  const cap = Math.max(4 * Math.max(...start), Number.isFinite(limitMm) ? limitMm : 0, 10);
  const travel = Math.hypot(...d);
  if (travel > cap) d = d.map((c) => (c * cap) / travel);
  const k = symmetric ? 2 : 1;
  const [driveW, driveH] = drives(hole, handle);
  const grow = (startSize, axis, sign) =>
    resizeValue(SIZE_AXIS, startSize, startSize, startSize + k * sign * dot(d, axis), gridMm).value;
  const next =
    hole.spec.kind === "rectangle"
      ? [
          driveW ? grow(start[0], frame.ex, handle.signs[0]) : start[0],
          driveH ? grow(start[1], frame.ey, handle.signs[1]) : start[1],
        ]
      : [grow(start[0], handle.dir, 1)];
  return resizedTo(hole, handle, next, symmetric);
}

/**
 * A size typed into a handle's box (mm): exactly that, rounded to 0.01 mm
 * and floored, from the opposite edge as a drag is.
 * @param {{ hole: { point: Vec3, normal: Vec3, spec: any }, handle: HoleHandle, mm: number }} edit
 * @returns {HoleResize | null}
 */
export function typedHoleSize({ hole, handle, mm }) {
  if (!hole || !handle || handle.side === "move" || !resizableHole(hole.spec)) return null;
  if (!Number.isFinite(mm)) return null;
  const start = sizesOf(hole.spec);
  const [driveW, driveH] = drives(hole, handle);
  const set = (startSize) => resizeValue(SIZE_AXIS, startSize, startSize, mm, 0).value;
  const next =
    hole.spec.kind === "rectangle"
      ? [driveW ? set(start[0]) : start[0], driveH ? set(start[1]) : start[1]]
      : [set(start[0])];
  return resizedTo(hole, handle, next, false);
}

/**
 * An arrow key on a focused handle: `steps` grid lines out (positive) or in
 * — a size off the grid lands on its neighbouring line first, as a drag
 * would snap it; 0.1 mm a step with the Grid off — from the opposite edge.
 * Shift's ×10 is the caller's.
 * @param {{ hole: { point: Vec3, normal: Vec3, spec: any }, handle: HoleHandle, steps: number, gridMm?: number }} step
 * @returns {HoleResize | null}
 */
export function stepHoleSize({ hole, handle, steps, gridMm = 0 }) {
  if (!hole || !handle || handle.side === "move" || !resizableHole(hole.spec)) return null;
  if (!Number.isFinite(steps)) return null;
  const start = sizesOf(hole.spec);
  const [driveW, driveH] = drives(hole, handle);
  const stepped = (startSize) => stepValue(SIZE_AXIS, startSize, steps, gridMm);
  const next =
    hole.spec.kind === "rectangle"
      ? [driveW ? stepped(start[0]) : start[0], driveH ? stepped(start[1]) : start[1]]
      : [stepped(start[0])];
  return resizedTo(hole, handle, next, false);
}

/**
 * Where a drag of the move handle to `point` puts the hole: the pointer's
 * travel across the face, measured along the face's sideways and up
 * (slotFrame() at spin 0) and rounded to whole grid steps there (Off, or
 * `free`, as it is). `offset` is that travel, [across, up].
 * @param {{ hole: { point: Vec3, normal: Vec3 }, point: Vec3, gridMm?: number, free?: boolean, limitMm?: number }} move
 *   `limitMm` caps the travel, as dragHoleResize()'s does
 * @returns {{ point: Vec3, offset: number[] } | null}
 */
export function moveHole({ hole, point, gridMm = 0, free = false, limitMm = 0 }) {
  if (!hole || !isFiniteVec(point) || !isFiniteVec(hole.point) || !isFiniteVec(hole.normal)) return null;
  const { ex, ey } = slotFrame(hole.point, hole.normal, 0);
  const d = sub(point, hole.point);
  let offset = [dot(d, ex), dot(d, ey)];
  const travel = Math.hypot(...offset);
  const cap = Math.max(Number.isFinite(limitMm) ? limitMm : 0, 10);
  if (travel > cap) offset = offset.map((c) => (c * cap) / travel);
  if (!free && gridMm > 0) offset = offset.map((c) => Math.round(c / gridMm) * gridMm);
  offset = offset.map((c) => (Math.abs(c) < NOISE_MM ? 0 : clean(c)));
  const moved = add(add(hole.point, ex, offset[0]), ey, offset[1]).map(clean);
  return isFiniteVec(moved) ? { point: moved, offset } : null;
}

/**
 * The selected holes moved by `[across, up]` mm along each one's own face
 * (slotFrame() at spin 0) — an arrow key's nudge. `moved` lists each moved
 * hole's id, new point and normal, for the caller's on-the-face check.
 * @param {any} doc
 * @param {string[]} ids
 * @param {number[]} offset
 * @returns {{ doc: any, moved: { id: string, point: Vec3, normal: Vec3 }[] }}
 */
export function nudgeHoles(doc, ids, [across, up]) {
  if (!doc || !Number.isFinite(across) || !Number.isFinite(up)) return { doc, moved: [] };
  const targets = new Set(ids);
  /** @type {{ id: string, point: Vec3, normal: Vec3 }[]} */
  const moved = [];
  const holes = doc.holes.map((h) => {
    if (!targets.has(h.id)) return h;
    const { ex, ey } = slotFrame(h.point, h.normal, 0);
    const point = add(add(h.point, ex, across), ey, up).map(clean);
    moved.push({ id: h.id, point, normal: h.normal });
    return { ...h, point };
  });
  return moved.length ? { doc: { ...doc, holes }, moved } : { doc, moved };
}

/**
 * A hole's outline as line segments, for a ghost: a direction kind's own
 * (screwHoles.js's slotOutline(): a rectangle's corners, a slot's channel),
 * else the circle it cuts — a round cutout's rim, a screw's widest part.
 * @param {{ point: Vec3, normal: Vec3, spec: any }} hole
 * @returns {Vec3[][]}
 */
export function holeOutline(hole) {
  if (hasDirection(hole.spec)) return slotOutline(hole).map((s) => [s.a, s.b]);
  const r = holeFootprintRadius(hole.spec);
  const { ex, ey } = slotFrame(hole.point, hole.normal, 0);
  const at = (t) => add(add(hole.point, ex, r * Math.cos(t)), ey, r * Math.sin(t));
  const out = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    out.push([at((2 * Math.PI * i) / CIRCLE_SEGMENTS), at((2 * Math.PI * (i + 1)) / CIRCLE_SEGMENTS)]);
  }
  return out;
}

/**
 * How far a hole's cut reaches across its face from its point: its
 * outline's furthest point for a kind that draws one (a rectangle's
 * corner, a slot's channel end), else its footprint's radius.
 * @param {{ point: Vec3, normal: Vec3, spec: any }} hole
 */
export function holeReach(hole) {
  let reach = holeFootprintRadius(hole.spec);
  if (hasDirection(hole.spec))
    for (const [a, b] of holeOutline(hole))
      reach = Math.max(reach, Math.hypot(...sub(a, hole.point)), Math.hypot(...sub(b, hole.point)));
  return reach;
}

/**
 * Whether `hole`, moved to `point` on its face plane, is still on a face
 * turned like it — what a move handle's drop or an arrow's nudge is
 * refused without. Probes are surface probes (holesRender.js):
 * `(point, normal) => boolean`.
 *
 * Asked of the base without holes first: the mesh on screen has the
 * hole's own bore at its old spot, and a step shorter than its radius
 * would land in it. A face only the holes made — the floor of a pocket,
 * with a hole drilled into it — is on the mesh on screen alone, so that is
 * asked next; and inside the hole's own bore, where that mesh has nothing
 * to say, the spot counts as on the face when the face runs on past the
 * bore that way (so it ran under the bore too, before the hole was cut).
 * Where the hole hangs over the face's edge that way, a short step towards
 * it is refused even while the centre would stay on the face: the mesh
 * can't show that, and refusing keeps the hole on a face. No base to ask
 * (none rendered yet): yes.
 * @param {{ point: Vec3, normal: Vec3, spec: any }} hole where it is now
 * @param {Vec3} point where it would go
 * @param {{ base?: ((p: Vec3, n: Vec3) => boolean) | null, shown?: ((p: Vec3, n: Vec3) => boolean) | null }} probes
 *   `base` asks the base without holes, `shown` the mesh on screen
 */
export function movedOnFace(hole, point, { base = null, shown = null }) {
  if (!base) return true;
  if (base(point, hole.normal)) return true;
  if (!shown) return false;
  if (shown(point, hole.normal)) return true;
  const d = sub(point, hole.point);
  const len = Math.hypot(...d);
  const reach = holeReach(hole) + BORE_CLEAR_MM;
  if (!(len > 0) || len >= reach) return false;
  return shown(add(hole.point, d, reach / len), hole.normal);
}

/**
 * A small cross on the face at a hole's centre, `sizeMm` across: where a
 * moved hole's point lands.
 * @param {{ point: Vec3, normal: Vec3 }} hole
 * @param {number} sizeMm
 * @returns {Vec3[][]}
 */
export function holeCross(hole, sizeMm) {
  const { ex, ey } = slotFrame(hole.point, hole.normal, 0);
  const r = sizeMm / 2;
  return [
    [add(hole.point, ex, -r), add(hole.point, ex, r)],
    [add(hole.point, ey, -r), add(hole.point, ey, r)],
  ];
}

// "+4", "−0.5": a size change for a label.
function signed(value) {
  return `${value < 0 ? "−" : "+"}${formatMm(Math.abs(value))}`;
}

/**
 * The drag label for a resize: "W 24 mm (+4)", "H 8 mm (−1 each side)" with
 * Alt, "W 24 × H 12 mm" for a corner, "Ø 12 mm (+2)" for a round cutout.
 * @param {{ spec: any }} hole the hole as the gesture started
 * @param {HoleHandle} handle
 * @param {HoleResize} result
 * @param {boolean} [symmetric]
 */
export function holeResizeText(hole, handle, result, symmetric = false) {
  const change = (delta) =>
    delta === 0 ? "" : ` (${signed(symmetric ? delta / 2 : delta)}${symmetric ? " each side" : ""})`;
  if (hole.spec.kind !== "rectangle") return `Ø ${formatMm(result.sizes[0])} mm${change(result.deltas[0])}`;
  if (handle.kind === "corner") return `W ${formatMm(result.sizes[0])} × H ${formatMm(result.sizes[1])} mm`;
  const i = handle.signs[0] ? 0 : 1;
  return `${i ? "H" : "W"} ${formatMm(result.sizes[i])} mm${change(result.deltas[i])}`;
}

/**
 * The drag label for a move: "3.5 mm right, 2 mm down" — right and up as
 * seen from outside the face, with up the face's own (straight up a wall).
 * A part that rounds to 0 at the label's three decimals is left out: a free
 * drag almost straight up still has a few µm sideways, and "0 mm right"
 * said nothing.
 * @param {number[]} offset moveHole()'s [across, up]
 */
export function holeMoveText([across, up]) {
  const parts = [];
  const part = (mm, plus, minus) => {
    const text = formatMm(Math.abs(mm));
    if (text !== "0") parts.push(`${text} mm ${mm > 0 ? plus : minus}`);
  };
  part(across, "right", "left");
  part(up, "up", "down");
  return parts.length ? parts.join(", ") : "Not moved";
}

// How far the pill's anchor drops in the world for each mm the outline
// reaches sideways of it: tan 35.26° × sin 45°, the Home view's (the
// camera up 35.26° from level, 45° round from the face's axes), where a
// point beside the anchor comes down the screen the most for its distance.
const PILL_SLOPE = 0.5;

/**
 * Where the selected hole's pill hangs from, so it stays off the hole's
 * handles: below every point of its outline and ring on the screen, in the
 * views the viewer offers, as closely as one point can be.
 *
 * First past the bottom of the outline (down the face's own up,
 * slotFrame() at spin 0, as far as the outline or its ring reaches): that
 * is below it seen square on — a plate lying flat from the Top view, a
 * wall from the Front or Right. Then down in the world as far as an
 * oblique view needs (the viewer's camera keeps +Z up, so world down is
 * always screen-down): a point of the outline the anchor is beside comes
 * down the screen by up to PILL_SLOPE of that sideways distance in the
 * Home view, and one higher in the world than the anchor goes up by its
 * height. On a plate lying flat every point is beside the anchor; on a
 * wall the face's down already is the world's, the outline's points are
 * above the anchor, and only a wide outline's lower corners need more.
 * (Dropping by the outline's whole radius on top of the face's down, as
 * this did before, hung the pill a radius below a wall's hole.) The pill
 * is drawn below this point (styles.css, .holes-pill-below).
 * @param {{ point: Vec3, normal: Vec3, spec: any }} hole
 * @returns {Vec3}
 */
export function holePillAnchor(hole) {
  const { ex, ey } = slotFrame(hole.point, hole.normal, 0);
  // The ring (footprint + 0.5, holesOverlay.js) and, for a kind that
  // draws one, the outline: the handles stand on the outline (or the rim,
  // inside the ring).
  const ring = holeFootprintRadius(hole.spec) + 0.5;
  const points = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    points.push(add(add(hole.point, ex, ring * Math.cos(t)), ey, ring * Math.sin(t)));
  }
  if (hasDirection(hole.spec)) for (const [a, b] of holeOutline(hole)) points.push(a, b);
  let down = 0;
  for (const p of points) down = Math.max(down, -dot(sub(p, hole.point), ey));
  const below = add(hole.point, ey, -down);
  let drop = 0;
  for (const p of points) {
    const [x, y, z] = sub(p, below);
    drop = Math.max(drop, PILL_SLOPE * Math.hypot(x, y) - z);
  }
  return add(below, [0, 0, -1], drop).map(clean);
}
