// The landing page hero's meshes, packed into one small binary file
// (assets/hero-parts.bin, written by scripts/hero-parts.mjs).
//
// OpenSCAD's binary STL spends 50 bytes on every triangle: a normal and
// three full-precision corners, so a vertex shared by six triangles is
// stored six times. Here each mesh keeps one copy of every vertex,
// quantised to 16 bits across the mesh's own bounding box, and three
// 16-bit indices per triangle — about a fifth of the STL's bytes. The
// largest hero part is a few centimetres across, so a step is well under
// a micrometre: nothing a viewer could see.
//
// Layout, little-endian: "CFHP", version, mesh count; then per mesh its
// name (length + UTF-8, padded to 4 bytes), vertex and triangle counts,
// bounding box min and max (float32 x 3 each), the bytes per index (2 or
// 4), the quantised positions (uint16 x 3 per vertex, padded to 4 bytes)
// and the indices.

const MAGIC = "CFHP";
const VERSION = 1;
const STEPS = 65535;

/**
 * @typedef {object} Mesh
 * @property {string} name
 * @property {Float32Array} positions x, y, z per vertex
 * @property {Uint16Array | Uint32Array} indices three per triangle
 */

/**
 * A binary STL's triangles as an indexed mesh: every distinct corner once.
 * OpenSCAD writes a shared corner as the same float32 bits each time, so an
 * exact match is the right test.
 * @param {Uint8Array} bytes
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function indexStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  if (bytes.byteLength < 84 + triangles * 50) throw new Error("Truncated binary STL");
  /** @type {Map<string, number>} */
  const seen = new Map();
  const positions = [];
  const indices = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    for (let corner = 0; corner < 3; corner++) {
      const at = 84 + t * 50 + 12 + corner * 12;
      const x = view.getFloat32(at, true);
      const y = view.getFloat32(at + 4, true);
      const z = view.getFloat32(at + 8, true);
      const key = `${x},${y},${z}`;
      let index = seen.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        seen.set(key, index);
        positions.push(x, y, z);
      }
      indices[t * 3 + corner] = index;
    }
  }
  return { positions: new Float32Array(positions), indices };
}

const pad4 = (n) => (n + 3) & ~3;

/**
 * @param {{ name: string, positions: Float32Array, indices: ArrayLike<number> }[]} meshes
 * @returns {Uint8Array}
 */
export function encodeMeshes(meshes) {
  const encoder = new TextEncoder();
  const prepared = meshes.map((mesh) => {
    const name = encoder.encode(mesh.name);
    const vertices = mesh.positions.length / 3;
    const indexBytes = vertices <= 0xffff ? 2 : 4;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], mesh.positions[i]);
      max[axis] = Math.max(max[axis], mesh.positions[i]);
    }
    const size =
      4 + pad4(name.length) + 8 + 24 + 4 + pad4(vertices * 6) + pad4(mesh.indices.length * indexBytes);
    return { mesh, name, vertices, indexBytes, min, max, size };
  });
  const bytes = new Uint8Array(12 + prepared.reduce((sum, p) => sum + p.size, 0));
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode(MAGIC), 0);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, prepared.length, true);
  let at = 12;
  for (const { mesh, name, vertices, indexBytes, min, max } of prepared) {
    view.setUint32(at, name.length, true);
    bytes.set(name, at + 4);
    at += 4 + pad4(name.length);
    view.setUint32(at, vertices, true);
    view.setUint32(at + 4, mesh.indices.length / 3, true);
    at += 8;
    for (let axis = 0; axis < 3; axis++) {
      view.setFloat32(at + axis * 4, min[axis], true);
      view.setFloat32(at + 12 + axis * 4, max[axis], true);
    }
    at += 24;
    view.setUint32(at, indexBytes, true);
    at += 4;
    for (let i = 0; i < mesh.positions.length; i++) {
      const axis = i % 3;
      const span = max[axis] - min[axis];
      const q = span > 0 ? Math.round(((mesh.positions[i] - min[axis]) / span) * STEPS) : 0;
      view.setUint16(at + i * 2, q, true);
    }
    at += pad4(vertices * 6);
    for (let i = 0; i < mesh.indices.length; i++) {
      if (indexBytes === 2) view.setUint16(at + i * 2, mesh.indices[i], true);
      else view.setUint32(at + i * 4, mesh.indices[i], true);
    }
    at += pad4(mesh.indices.length * indexBytes);
  }
  return bytes;
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Map<string, Mesh>}
 */
export function decodeMeshes(buffer) {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  if (buffer.byteLength < 12 || decoder.decode(new Uint8Array(buffer, 0, 4)) !== MAGIC)
    throw new Error("Not a hero mesh file");
  if (view.getUint32(4, true) !== VERSION) throw new Error("Unknown hero mesh file version");
  const count = view.getUint32(8, true);
  /** @type {Map<string, Mesh>} */
  const meshes = new Map();
  let at = 12;
  for (let m = 0; m < count; m++) {
    const nameLength = view.getUint32(at, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 4, nameLength));
    at += 4 + pad4(nameLength);
    const vertices = view.getUint32(at, true);
    const triangles = view.getUint32(at + 4, true);
    at += 8;
    const min = [0, 1, 2].map((axis) => view.getFloat32(at + axis * 4, true));
    const max = [0, 1, 2].map((axis) => view.getFloat32(at + 12 + axis * 4, true));
    at += 24;
    const indexBytes = view.getUint32(at, true);
    at += 4;
    const positions = new Float32Array(vertices * 3);
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      positions[i] = min[axis] + (view.getUint16(at + i * 2, true) / STEPS) * (max[axis] - min[axis]);
    }
    at += pad4(vertices * 6);
    const indexCount = triangles * 3;
    // A view, not a copy: every section is padded to four bytes, so the
    // offset is always a multiple of the element size a view needs.
    const indices =
      indexBytes === 2 ? new Uint16Array(buffer, at, indexCount) : new Uint32Array(buffer, at, indexCount);
    at += pad4(indexCount * indexBytes);
    meshes.set(name, { name, positions, indices });
  }
  return meshes;
}
