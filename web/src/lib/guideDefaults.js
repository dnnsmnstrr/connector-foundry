// The Holes tab's guide settings a model starts with: how far in from each
// corner the corner snap points sit (`inset`) and the radius of the circle
// round the face center (`radius`). Picked for the model rather than one
// pair for all: a 10 mm part's corners meet in its middle at the old
// 5 mm inset, and a 10 mm circle reaches past them; a 200 mm panel's
// circle is lost in its middle.
//
// A catalogue part may say what it wants in `holes_guides`
// (catalogue.yaml's header): a number for either, `round: true` for a part
// whose face is round, whose circle goes half way out, or a cell grid
// (`cell`, `cell_hole`) for a part whose holes sit a set way into each
// cell. Gridfinity is that last: its magnet holes are 8 mm in from each
// cell's edge, so the corner points land on them on whichever face is
// picked (`insetFor`). Anything it leaves out, and every imported mesh,
// comes from the model's size.
import { DEFAULT_CENTER_RADIUS_MM, DEFAULT_CORNER_INSET_MM } from "./snapCandidates.js";

// How far inside the face's edge the circle stays: room for most holes on
// it, an M5 counterbore's 4.8 mm radius and a wall round it.
export const GUIDE_MARGIN_MM = 6;
// The smallest circle worth drawing. Inside that the margin leaves no
// room for a hole, and its crossings only crowd the face center with snap
// points (on a 10 mm face they sit under the pointer wherever it goes).
const MIN_CIRCLE_MM = 2;

// The settings come in half millimetres, as the fields step; a cell grid's
// inset is a measure of the part, to the hundredth.
const half = (/** @type {number} */ mm) => Math.round(mm * 2) / 2;
const hundredth = (/** @type {number} */ mm) => Math.round(mm * 100) / 100;
const given = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * @typedef {object} HolesGuides catalogue.yaml's `holes_guides`
 * @property {number} [inset] mm, on every face
 * @property {number} [radius] mm
 * @property {boolean} [round] the circle half way out to the rim
 * @property {number} [cell] the grid the part sits on, mm
 * @property {string} [cell_setting] a global setting that overrides `cell` (GRIDFINITY_PITCH)
 * @property {number} [cell_hole] how far in from each cell's edge its holes sit, mm
 */

/**
 * The inset and radius a model's guides start with. `insetFor`, when the
 * part has a cell grid, gives a face's own inset from its extent
 * (analyzeFace()'s `inset` takes it), and `inset` is then what the
 * snapping bar shows until a face is picked.
 * @param {{ holes_guides?: HolesGuides } | null | undefined} part
 *   the catalogue entry, or null for an imported mesh or the bench
 * @param {number[] | null | undefined} extents the model's bounding box, [x, y, z] mm
 * @param {Record<string, any>} [settings] the global settings in force (GRIDFINITY_PITCH, ...)
 * @returns {{ inset: number, radius: number, insetFor: ((extent: number[]) => number) | null }}
 */
export function guideDefaults(part, extents, settings = {}) {
  const own = part?.holes_guides ?? {};
  // The face the guides matter on is the model's broadest: its two largest
  // sizes, and the narrower of those is how far either setting can go.
  const sizes = (Array.isArray(extents) ? extents : [])
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  const span = sizes.length >= 2 ? sizes[1] : null;
  const sizeInset = (/** @type {number | null} */ narrower) =>
    narrower ? Math.min(DEFAULT_CORNER_INSET_MM, half(narrower / 4)) : DEFAULT_CORNER_INSET_MM;

  /** @type {((extent: number[]) => number) | null} */
  let insetFor = null;
  const setting = typeof own.cell_setting === "string" ? settings?.[own.cell_setting] : undefined;
  const cell = given(setting) && setting > 0 ? setting : own.cell;
  if (!given(own.inset) && given(cell) && cell > 0 && given(own.cell_hole)) {
    const fromCenter = cell / 2 - own.cell_hole;
    // A face is some whole number of cells across, each a little less than
    // the grid on most faces (a bin's top is 0.5 mm short of it, a foot's
    // bottom 6.4): the corner cell is what the face has left past the
    // others, and its hole sits `fromCenter` from that cell's middle. A
    // face the holes don't fit on (a bin's side) takes the size rule.
    insetFor = (extent) => {
      const across = extent.map((size) => {
        const cells = Math.max(1, Math.round(size / cell));
        return (size - (cells - 1) * cell) / 2 - fromCenter;
      });
      const inset = Math.min(...across);
      return inset > 0 ? hundredth(inset) : sizeInset(Math.min(...extent));
    };
  }

  const inset = given(own.inset)
    ? own.inset
    : insetFor && sizes.length >= 2
      ? insetFor([sizes[0], sizes[1]])
      : sizeInset(span);
  let radius;
  if (given(own.radius)) radius = own.radius;
  else if (!span) radius = DEFAULT_CENTER_RADIUS_MM;
  // Round: half way out to the rim.
  else if (own.round === true) radius = half(span / 4);
  // Square: the margin inside the face's edge, or none on a face too
  // small to leave a circle there.
  else {
    const inside = half(span / 2 - GUIDE_MARGIN_MM);
    radius = inside >= MIN_CIRCLE_MM ? inside : 0;
  }
  return { inset, radius, insetFor };
}
