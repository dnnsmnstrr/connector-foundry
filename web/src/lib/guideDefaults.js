// The Holes tab's guide settings a model starts with: how far in from each
// corner the corner snap points sit (`inset`) and the radius of the circle
// round the face center (`radius`). Picked for the model rather than one
// pair for all: a 10 mm part's corners meet in its middle at the old
// 5 mm inset, and a 10 mm circle reaches past them; a 200 mm panel's
// circle is lost in its middle.
//
// A catalogue part may say what it wants in `holes_guides`
// (catalogue.yaml's header): a number for either, or `round: true` for a
// part whose face is round, whose circle goes half way out. Gridfinity
// says its inset, so the corner points land on its magnet holes. Anything
// it leaves out, and every imported mesh, comes from the model's size.
import { DEFAULT_CENTER_RADIUS_MM, DEFAULT_CORNER_INSET_MM } from "./snapCandidates.js";

// How far inside the face's edge the circle stays: room for most holes on
// it, an M5 counterbore's 4.8 mm radius and a wall round it.
export const GUIDE_MARGIN_MM = 6;
// The smallest circle worth drawing. Inside that the margin leaves no
// room for a hole, and its crossings only crowd the face center with snap
// points (on a 10 mm face they sit under the pointer wherever it goes).
const MIN_CIRCLE_MM = 2;

// The settings come in half millimetres, as the fields step.
const half = (/** @type {number} */ mm) => Math.round(mm * 2) / 2;
const given = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The inset and radius a model's guides start with.
 * @param {{ holes_guides?: { inset?: number, radius?: number, round?: boolean } } | null | undefined} part
 *   the catalogue entry, or null for an imported mesh or the bench
 * @param {number[] | null | undefined} extents the model's bounding box, [x, y, z] mm
 * @returns {{ inset: number, radius: number }}
 */
export function guideDefaults(part, extents) {
  const own = part?.holes_guides ?? {};
  // The face the guides matter on is the model's broadest: its two largest
  // sizes, and the narrower of those is how far either setting can go.
  const sizes = (Array.isArray(extents) ? extents : [])
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  const span = sizes.length >= 2 ? sizes[1] : null;
  const inset = given(own.inset)
    ? own.inset
    : span
      ? Math.min(DEFAULT_CORNER_INSET_MM, half(span / 4))
      : DEFAULT_CORNER_INSET_MM;
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
  return { inset, radius };
}
