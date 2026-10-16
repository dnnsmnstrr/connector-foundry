// The Holes tab's model as render requests: the base on its own, and the
// base with the holes cut through the generated source
// (screwHoles.js's holesToScad()). No React here; Holes.jsx renders the
// preview with these through hooks/useRender.js, and its exports reuse
// them so an export is the same mesh the preview showed. Also the probe
// that asks a mesh whether a spot is on one of its faces (surfaceProbe()).
import { DoubleSide, Mesh, MeshBasicMaterial, Ray, Raycaster, Triangle, Vector3 } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { groundedMesh } from "./importedPart.js";
import { meshExtents } from "./meshExtents.js";
import { getCachedRender, renderPart } from "./openscad-client.js";
import { holesToScad } from "./screwHoles.js";

// The grounded bytes of each source geometry, one per side up. The undo
// history keeps every document a Flip toggle makes, and with them their
// STL bytes (and what is memoised on those: the digest, the parsed probe),
// so a toggle that made fresh bytes each time held another copy of the
// mesh per press — 25 MB each for a 500k-triangle import. A geometry
// never changes after import, so turning it back reuses the bytes it had,
// and the render cache and probes keyed by them hit too.
const groundedByGeometry = new WeakMap();

/**
 * A mesh source from its validated geometry: grounded on the grid, and
 * turned over first when `flip` is set (importedPart.js's groundedMesh()).
 * The same geometry and side give the same bytes every time.
 * @param {string} name
 * @param {import("three").BufferGeometry} geometry
 * @param {boolean} flip
 */
export function meshSource(name, geometry, flip) {
  let sides = groundedByGeometry.get(geometry);
  if (!sides) groundedByGeometry.set(geometry, (sides = {}));
  const side = flip ? "flipped" : "upright";
  if (!sides[side]) sides[side] = groundedMesh(geometry, { flip });
  const { stlBytes, extents } = sides[side];
  return { kind: "mesh", name, geometry, flip, stlBytes, extents: [...extents] };
}

/**
 * The base model's STL: a catalogue part rendered on its own (cached by
 * openscad-client), or a mesh source's own bytes.
 * @param {any} source a holes document's `source`
 * @param {Map<string, any>} catalogueById
 * @param {object} [globalOverrides]
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArrayBuffer | Uint8Array>}
 */
export function baseBuffer(source, catalogueById, globalOverrides, signal) {
  if (source.kind === "mesh") return Promise.resolve(source.stlBytes);
  const request = baseRequest(source, catalogueById, globalOverrides);
  if (!request) return Promise.reject(new Error(`Unknown catalogue part ${source.partId}`));
  return renderPart(request, { signal });
}

// The base's own render request (a catalogue part), or null for a mesh
// source (its bytes are the base) or a part the catalogue doesn't have.
function baseRequest(source, catalogueById, globalOverrides) {
  if (source.kind === "mesh") return null;
  const part = catalogueById.get(source.partId);
  return part ? { scadFile: part.file, module: part.module, params: source.params, globalOverrides } : null;
}

/**
 * The render request for the base with its holes cut. `extents` are the
 * base's: a through hole is made as long as the base's diagonal (plus a
 * margin), and a thread is bounded by the box.
 * @param {{ source: any, holes: any[] }} doc
 * @param {Map<string, any>} catalogueById
 * @param {number[]} extents
 * @param {object} [globalOverrides]
 */
export function holedRequest(doc, catalogueById, extents, globalOverrides) {
  const importedFiles = new Map();
  const scadSource = holesToScad(doc, catalogueById, {
    throughLength: Math.hypot(...extents) + 2,
    extents,
    importedFiles,
  });
  return { scadSource, importedFiles, globalOverrides };
}

/**
 * @typedef {{ stl: ArrayBuffer | Uint8Array, baseExtents: number[], base: ArrayBuffer | Uint8Array }} HoledResult
 *   the mesh on screen, the base's extents, and the base itself — what
 *   the Holes tab asks "is this spot on the model?" of when a hole moves,
 *   since the mesh on screen has that hole's own bore in it
 */

/**
 * The model on screen: the base alone when there are no holes, else the
 * base with the holes cut — which waits on the base, since its extents
 * size the through holes (after the first time that is a cache lookup).
 * Resolves to the STL, the base's extents (which also scale the snap
 * radius) and the base's STL.
 * @param {{ source: any, holes: any[] }} doc
 * @param {Map<string, any>} catalogueById
 * @param {object} [globalOverrides]
 * @param {AbortSignal} [signal]
 * @returns {Promise<HoledResult>}
 */
export async function renderHoled(doc, catalogueById, globalOverrides, signal) {
  const base = await baseBuffer(doc.source, catalogueById, globalOverrides, signal);
  const baseExtents = meshExtents(base);
  const stl = doc.holes.length
    ? await renderPart(holedRequest(doc, catalogueById, baseExtents, globalOverrides), { signal })
    : base;
  return { stl, baseExtents, base };
}

/**
 * renderHoled()'s result when it is all in the render cache already (or
 * needs no render: a mesh with no holes), else null — for useRender's
 * `cached`, so an undo or a repeated edit shows at once with no
 * "rendering" flash. Synchronous, and never throws: a request that can't
 * be formed (a part missing from the catalogue, a value the generated
 * source refuses) is a miss, and the render that follows reports it.
 * @param {{ source: any, holes: any[] }} doc
 * @param {Map<string, any>} catalogueById
 * @param {object} [globalOverrides]
 * @returns {HoledResult | null}
 */
export function cachedHoled(doc, catalogueById, globalOverrides) {
  try {
    const request = baseRequest(doc.source, catalogueById, globalOverrides);
    const base = doc.source.kind === "mesh" ? doc.source.stlBytes : request && getCachedRender(request);
    if (!base) return null;
    const baseExtents = meshExtents(base);
    if (!doc.holes.length) return { stl: base, baseExtents, base };
    const stl = getCachedRender(holedRequest(doc, catalogueById, baseExtents, globalOverrides));
    return stl ? { stl, baseExtents, base } : null;
  } catch {
    return null;
  }
}

// A spot counts as on the model when a ray from this far above it,
// straight down the hole's axis, meets a face turned the same way within
// SURFACE_TOLERANCE_MM of the spot.
const PROBE_MM = 0.5;
const SURFACE_TOLERANCE_MM = 0.05;
// The probe's mesh is never drawn; one material does for every model.
const PROBE_MATERIAL = new MeshBasicMaterial({ side: DoubleSide });
// Parsed bases, one per STL buffer: a buffer is one source's base for as
// long as it lives (the render cache hands out the same buffer on every
// hit, a mesh source keeps its bytes), so each base is parsed once. The
// geometry is only ever raycast, never drawn, so it holds no GPU memory
// to dispose; the WeakMap lets it go with its buffer.
const parsedBases = new WeakMap();

/**
 * An STL buffer parsed for probing, once per buffer.
 * @param {ArrayBuffer | Uint8Array} stl
 * @returns {import("three").BufferGeometry}
 */
export function probeGeometry(stl) {
  let geometry = parsedBases.get(stl);
  if (!geometry) {
    // STLLoader reads an ArrayBuffer; a view is copied out to one.
    const buffer = ArrayBuffer.isView(stl)
      ? stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength)
      : stl;
    geometry = new STLLoader().parse(/** @type {ArrayBuffer} */ (buffer));
    parsedBases.set(stl, geometry);
  }
  return geometry;
}

const probes = new WeakMap();

/**
 * surfaceProbe() of an STL buffer, built the first time it is asked for
 * and kept with the buffer — the Holes tab asks its base only when a hole
 * moves, so a big imported mesh is never parsed twice up front for a
 * probe that may not be needed.
 * @param {ArrayBuffer | Uint8Array} stl
 * @returns {(point: number[], normal: number[]) => boolean}
 */
export function stlProbe(stl) {
  let probe = probes.get(stl);
  if (!probe) {
    probe = surfaceProbe(probeGeometry(stl));
    probes.set(stl, probe);
  }
  return probe;
}

/**
 * Is a spot on `geometry`, on a face turned like a hole with this normal?
 * Returns `(point, normal) => boolean`. The Repeat form asks it of the mesh
 * on screen (a pattern may run into a hole already drilled); a moved or
 * nudged hole asks it of the base without holes, where its own bore at its
 * old spot is not in the way. The first probe buckets the triangles
 * (triangleGrid()); a mesh too awkward to bucket is raycast whole.
 * @param {import("three").BufferGeometry} geometry
 * @returns {(point: number[], normal: number[]) => boolean}
 */
export function surfaceProbe(geometry) {
  /** @type {TriangleGrid | null | undefined} */
  let grid;
  let raycaster = null;
  const ray = new Ray();
  return (point, normal) => {
    if (![...point, ...normal].every(Number.isFinite)) return false;
    const n = new Vector3(...normal).normalize();
    ray.set(new Vector3(...point).addScaledVector(n, PROBE_MM), n.clone().negate());
    if (grid === undefined) grid = triangleGrid(geometry);
    let hit;
    if (grid) hit = grid.nearest(ray, PROBE_MM + 1);
    else {
      if (!raycaster) raycaster = new Raycaster();
      raycaster.ray.copy(ray);
      raycaster.far = PROBE_MM + 1;
      hit = raycaster.intersectObject(new Mesh(geometry, PROBE_MATERIAL), false)[0];
    }
    return Boolean(
      hit &&
      Math.abs(hit.distance - PROBE_MM) < SURFACE_TOLERANCE_MM &&
      hit.face &&
      hit.face.normal.dot(n) > 0.99,
    );
  };
}

// --- The probe's triangle grid ---------------------------------------------
// three.js raycasts test every triangle of a mesh (there is no spatial
// index, and `far` only drops hits after the test), and a probe runs for
// nearly every frame of a hole's move drag and for every hole of a nudge
// on every key repeat: over a 156k-triangle Gridfinity baseplate one took
// 7.6 ms (15 ms off the face), so a 20-hole pattern's nudge outlasted the
// key repeat and went on moving after the key came up. Bucketed in a
// uniform grid over the mesh's box, a probe's 1.5 mm segment visits a few
// cells and tests the triangles in them: the same nearest hit, as three's
// double-sided raycast finds it, from a few dozen triangles.

// About this many triangles a cell, on average — or, for a mesh whose
// big triangles cross too many cells of that grid, up to the second
// figure, in steps of four.
const GRID_TRIANGLES_PER_CELL = 2;
const GRID_MAX_TRIANGLES_PER_CELL = 128;
// The most cells along one axis (a mesh far longer than it is wide gets
// long cells rather than a huge grid).
const GRID_MAX_CELLS_PER_AXIS = 1024;
// A grid whose triangles fill more cells than this many per triangle
// costs more memory than it saves time; a mesh that fills that many even
// on the coarsest grid is raycast whole instead.
const GRID_MAX_ENTRIES_PER_TRIANGLE = 16;
// Float slack for the segment's box, mm, so a hit exactly on a cell's
// boundary still finds its triangle.
const GRID_EPSILON_MM = 1e-4;

/**
 * @typedef {object} TriangleGrid
 * @property {(ray: import("three").Ray, far: number) =>
 *   { distance: number, face: { normal: import("three").Vector3 } } | null} nearest
 *   the nearest triangle `ray` meets within `far` of its origin (either
 *   side of the triangle), as three's raycast reports it, or null
 */

/**
 * The triangles of `geometry` bucketed by the grid cells their boxes
 * overlap, or null for a mesh with none or one too awkward to bucket.
 * @param {import("three").BufferGeometry} geometry
 * @returns {TriangleGrid | null}
 */
function triangleGrid(geometry) {
  const coords = triangleCoords(geometry);
  const count = coords.length / 9;
  if (!count) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < coords.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = coords[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (![...min, ...max].every(Number.isFinite)) return null;
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  // Big triangles crossing a fine grid (a Skadis board's faces) fill too
  // many cells: a coarser grid then holds them in fewer.
  let grid = null;
  for (let perCell = GRID_TRIANGLES_PER_CELL; !grid && perCell <= GRID_MAX_TRIANGLES_PER_CELL; perCell *= 4) {
    grid = bucketTriangles(coords, min, size, perCell);
  }
  if (!grid) return null;
  const { dims, cellOf, starts, triangles } = grid;

  // Which triangles this query has tested already (a triangle sits in
  // every cell its box overlaps): stamped with the query's number.
  const seen = new Uint32Array(count);
  let query = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const at = new Vector3();
  const end = new Vector3();
  return {
    nearest(ray, far) {
      end.copy(ray.direction).multiplyScalar(far).add(ray.origin);
      const lo = [0, 1, 2].map((k) => Math.min(ray.origin.getComponent(k), end.getComponent(k)));
      const hi = [0, 1, 2].map((k) => Math.max(ray.origin.getComponent(k), end.getComponent(k)));
      for (let k = 0; k < 3; k++) {
        if (hi[k] + GRID_EPSILON_MM < min[k] || lo[k] - GRID_EPSILON_MM > max[k]) return null;
      }
      const from = lo.map((v, k) => cellOf(v - GRID_EPSILON_MM, k));
      const to = hi.map((v, k) => cellOf(v + GRID_EPSILON_MM, k));
      if (++query === 0xffffffff) {
        seen.fill(0);
        query = 1;
      }
      let best = -1;
      let bestDistance = Infinity;
      for (let z = from[2]; z <= to[2]; z++)
        for (let y = from[1]; y <= to[1]; y++)
          for (let x = from[0]; x <= to[0]; x++) {
            const cellIndex = (z * dims[1] + y) * dims[0] + x;
            for (let i = starts[cellIndex]; i < starts[cellIndex + 1]; i++) {
              const t = triangles[i];
              if (seen[t] === query) continue;
              seen[t] = query;
              a.fromArray(coords, t * 9);
              b.fromArray(coords, t * 9 + 3);
              c.fromArray(coords, t * 9 + 6);
              if (!ray.intersectTriangle(a, b, c, false, at)) continue;
              const distance = ray.origin.distanceTo(at);
              // Equal distances go to the first triangle, as three's
              // stable sort of its hits does.
              if (distance > far || distance > bestDistance || (distance === bestDistance && t > best)) {
                continue;
              }
              best = t;
              bestDistance = distance;
            }
          }
      if (best < 0) return null;
      a.fromArray(coords, best * 9);
      b.fromArray(coords, best * 9 + 3);
      c.fromArray(coords, best * 9 + 6);
      return { distance: bestDistance, face: { normal: Triangle.getNormal(a, b, c, new Vector3()) } };
    },
  };
}

/**
 * The triangles in `coords` (nine floats each) bucketed in a grid of
 * cubic cells over the box from `min` of `size`, about `perCell` to a
 * cell, or null when they would fill more than
 * GRID_MAX_ENTRIES_PER_TRIANGLE cells each.
 * @param {ArrayLike<number>} coords
 * @param {number[]} min
 * @param {number[]} size
 * @param {number} perCell
 */
function bucketTriangles(coords, min, size, perCell) {
  const count = coords.length / 9;
  // As many cells as the triangles want; a flat mesh's thin side is
  // floored so its volume (and the cell size) doesn't collapse to zero.
  const floor = Math.max(...size) / 1000 || 1;
  const volume = size.reduce((product, s) => product * Math.max(s, floor), 1);
  const cell = Math.cbrt(volume / Math.max(1, count / perCell));
  const dims = size.map((s) => Math.min(GRID_MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil(s / cell))));
  const scale = size.map((s, k) => (s > 0 ? dims[k] / s : 0));
  /** @type {(v: number, k: number) => number} */
  const cellOf = (v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) * scale[k])));
  const cells = dims[0] * dims[1] * dims[2];

  // The cell range [x0, y0, z0, x1, y1, z1] of triangle t's box.
  const range = new Int32Array(6);
  const rangeOf = (t) => {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const a = coords[o + k];
      const b = coords[o + 3 + k];
      const c = coords[o + 6 + k];
      range[k] = cellOf(Math.min(a, b, c), k);
      range[k + 3] = cellOf(Math.max(a, b, c), k);
    }
  };
  // Two passes: count each cell's triangles, then fill them in.
  const starts = new Uint32Array(cells + 1);
  let entries = 0;
  for (let t = 0; t < count; t++) {
    rangeOf(t);
    for (let z = range[2]; z <= range[5]; z++)
      for (let y = range[1]; y <= range[4]; y++)
        for (let x = range[0]; x <= range[3]; x++) starts[(z * dims[1] + y) * dims[0] + x + 1]++;
    entries += (range[3] - range[0] + 1) * (range[4] - range[1] + 1) * (range[5] - range[2] + 1);
    if (entries > count * GRID_MAX_ENTRIES_PER_TRIANGLE + cells) return null;
  }
  for (let c = 0; c < cells; c++) starts[c + 1] += starts[c];
  const triangles = new Uint32Array(entries);
  const fill = starts.slice(0, cells);
  for (let t = 0; t < count; t++) {
    rangeOf(t);
    for (let z = range[2]; z <= range[5]; z++)
      for (let y = range[1]; y <= range[4]; y++)
        for (let x = range[0]; x <= range[3]; x++) triangles[fill[(z * dims[1] + y) * dims[0] + x]++] = t;
  }
  return { dims, cellOf, starts, triangles };
}

/**
 * A geometry's triangles as nine floats each (three corners): the
 * position array itself for an STLLoader mesh, a copy through the index
 * otherwise.
 * @param {import("three").BufferGeometry} geometry
 * @returns {ArrayLike<number> & { length: number }}
 */
function triangleCoords(geometry) {
  const position = geometry.getAttribute("position");
  if (!position) return [];
  const index = geometry.getIndex();
  if (
    !index &&
    position.itemSize === 3 &&
    !("isInterleavedBufferAttribute" in position) &&
    position.array.length % 9 === 0
  ) {
    return position.array;
  }
  const corners = index ? index.count : position.count;
  const out = new Float32Array(Math.floor(corners / 3) * 9);
  for (let i = 0; i < out.length / 3; i++) {
    const v = index ? index.getX(i) : i;
    out[i * 3] = position.getX(v);
    out[i * 3 + 1] = position.getY(v);
    out[i * 3 + 2] = position.getZ(v);
  }
  return out;
}
