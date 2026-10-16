import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// Bounding box of an STL, memoised per buffer. The render pipeline emits
// binary STL (openscad-worker.js passes --export-format=binstl), which
// is read here directly: a fixed-layout scan of each triangle's nine
// vertex floats, with no geometry built. Anything else — an ASCII STL
// from an import — goes through STLLoader, which detects and parses that
// form. The Bench re-derives every node's standalone extents on each
// assembly edit, and the resize handles read the box on every render;
// openscad-client hands back the same ArrayBuffer for a cache hit, so
// keying on the buffer makes the re-derivation a lookup instead of a
// re-parse of a mesh that can run to megabytes.
//
// The key is the object passed, an ArrayBuffer or a view: mesh sources
// and decoded imports can be Uint8Arrays, and two views of one buffer at
// different offsets are different meshes.

/** @typedef {{ min: number[], max: number[] }} MeshBounds */

/** @type {WeakMap<object, MeshBounds>} */
const boundsByBuffer = new WeakMap();
/** @type {WeakMap<object, number[]>} */
const extentsByBuffer = new WeakMap();

// A binary STL: an 80-byte header, a uint32 triangle count, then 50 bytes
// per triangle (normal, three vertices, a 2-byte attribute). STLLoader
// treats exactly this length as binary even when the header happens to
// start with "solid", and so does this.
function binaryBounds(view) {
  if (view.byteLength < 84) return null;
  const count = view.getUint32(80, true);
  if (view.byteLength !== 84 + 50 * count) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) {
    const base = 84 + 50 * t + 12;
    for (let k = 0; k < 9; k++) {
      const v = view.getFloat32(base + 4 * k, true);
      const axis = k % 3;
      // A NaN (a corrupt float) fails both comparisons and is skipped,
      // so one bad vertex doesn't take the whole box with it. (Box3, on
      // the loader path, lets it poison the box instead, which
      // meshBounds() then turns into the empty answer.)
      if (v < min[axis]) min[axis] = v;
      if (v > max[axis]) max[axis] = v;
    }
  }
  return { min, max };
}

function loaderBounds(stl) {
  // STLLoader builds a DataView over its argument, which takes an
  // ArrayBuffer only — a view is copied out to one first.
  const buffer = ArrayBuffer.isView(stl)
    ? stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength)
    : stl;
  const geometry = new STLLoader().parse(buffer);
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  geometry.dispose();
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
}

/**
 * The STL's axis-aligned bounding box, `{ min, max }` in mm. An STL with
 * no triangles is a point at the origin — nothing there, rather than an
 * inverted box of ±Infinity that would flow into slot positions,
 * handle positions and generated .scad. The result is shared between
 * callers: don't mutate it.
 * @param {ArrayBuffer | ArrayBufferView} stl
 * @returns {MeshBounds}
 */
export function meshBounds(stl) {
  let bounds = boundsByBuffer.get(stl);
  if (!bounds) {
    const view = ArrayBuffer.isView(stl)
      ? new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
      : new DataView(/** @type {ArrayBuffer} */ (stl));
    bounds = binaryBounds(view) ?? loaderBounds(stl);
    if (![...bounds.min, ...bounds.max].every(Number.isFinite)) bounds = { min: [0, 0, 0], max: [0, 0, 0] };
    boundsByBuffer.set(stl, bounds);
  }
  return bounds;
}

/**
 * Bounding-box size [x, y, z] of an STL, memoised per buffer like
 * meshBounds() (the same array comes back for the same buffer).
 * @param {ArrayBuffer | ArrayBufferView} stl
 * @returns {number[]}
 */
export function meshExtents(stl) {
  let extents = extentsByBuffer.get(stl);
  if (!extents) {
    const { min, max } = meshBounds(stl);
    extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    extentsByBuffer.set(stl, extents);
  }
  return extents;
}
