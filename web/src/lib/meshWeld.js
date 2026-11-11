// Welding a triangle soup into an indexed mesh: what three's
// mergeVertices() does, for the one shape of input this app welds.
//
// An STL has no shared vertices, and everything that reads a mesh's
// topology (the import's validate/repair gate, face-center snapping, the
// Holes tab's face guides) needs them, so every imported mesh and every
// Holes preview is welded first. mergeVertices() builds a string key per
// vertex ("12345,-678,90,") and looks it up in an object: 174 ms for a
// 200k-triangle import in Node, most of a second on a phone, and the
// largest single item in the profile of an import, of "Use this mesh"
// and of each holed render that follows.
//
// weldVertices() keys the same three truncated coordinates as integers in
// an open-addressed table: 10 ms for the same mesh, and the same result
// to the bit — the same vertices in the same order, the same index, the
// same array types — which web/tests/unit/mesh-weld.test.js holds it to.
// It does that for a geometry whose only attribute is a plain float
// `position`; anything else (a normal or colour attribute, which
// mergeVertices() hashes too, morph targets, an interleaved or
// normalised buffer) goes to mergeVertices() as before.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Three well-known primes for hashing a 3D integer cell (Teschner et
// al.'s spatial hash); any odd multipliers would do, the table resolves
// collisions by comparing the keys themselves.
const HASH_X = 73856093;
const HASH_Y = 19349663;
const HASH_Z = 83492791;

/**
 * Whether weldVertices() can weld `geometry` itself rather than hand it
 * to mergeVertices().
 * @param {THREE.BufferGeometry} geometry
 */
function isPositionOnly(geometry) {
  const names = Object.keys(geometry.attributes);
  if (names.length !== 1 || names[0] !== "position") return false;
  if (Object.keys(geometry.morphAttributes).length > 0) return false;
  const position = geometry.attributes.position;
  return (
    position instanceof THREE.BufferAttribute &&
    position.itemSize === 3 &&
    !position.normalized &&
    (position.array instanceof Float32Array || position.array instanceof Float64Array)
  );
}

/**
 * `geometry` with the vertices that share a position (to within
 * `tolerance`, as mergeVertices() counts it: the same cell of a grid that
 * fine) merged into one and an index over them. The result is a new
 * geometry, exactly the one `mergeVertices(geometry, tolerance)` returns;
 * `geometry` is left as it was.
 * @param {THREE.BufferGeometry} geometry
 * @param {number} [tolerance]
 * @returns {THREE.BufferGeometry}
 */
export function weldVertices(geometry, tolerance = 1e-4) {
  if (!isPositionOnly(geometry)) return mergeVertices(geometry, tolerance);

  const source = /** @type {THREE.BufferAttribute} */ (geometry.attributes.position);
  const coords = source.array;
  const indices = geometry.getIndex();
  const count = indices ? indices.count : source.count;

  // mergeVertices()'s own arithmetic, so the cells are the same ones: a
  // coordinate is scaled to tolerance units, moved half a unit up and
  // truncated toward zero (`~~`).
  const scale = Math.pow(10, Math.log10(1 / Math.max(tolerance, Number.EPSILON)));
  const shift = Math.max(tolerance, Number.EPSILON) * 0.5 * scale;

  // Open addressing, at most half full: a slot holds a welded vertex's
  // number plus one (zero is "empty"), and that vertex's three cell
  // coordinates are in `cells`.
  let capacity = 16;
  while (capacity < count * 2) capacity *= 2;
  const mask = capacity - 1;
  const slots = new Int32Array(capacity);
  const cells = new Int32Array(count * 3);
  const welded = new /** @type {Float32ArrayConstructor} */ (coords.constructor)(count * 3);
  const index = new Uint32Array(count);
  let next = 0;

  for (let i = 0; i < count; i++) {
    const from = 3 * (indices ? indices.getX(i) : i);
    const x = coords[from];
    const y = coords[from + 1];
    const z = coords[from + 2];
    const cx = ~~(x * scale + shift);
    const cy = ~~(y * scale + shift);
    const cz = ~~(z * scale + shift);
    let slot = (Math.imul(cx, HASH_X) ^ Math.imul(cy, HASH_Y) ^ Math.imul(cz, HASH_Z)) & mask;
    for (;;) {
      const held = slots[slot];
      if (held === 0) {
        // The first vertex seen in a cell is the one kept, as it is.
        slots[slot] = next + 1;
        cells[3 * next] = cx;
        cells[3 * next + 1] = cy;
        cells[3 * next + 2] = cz;
        welded[3 * next] = x;
        welded[3 * next + 1] = y;
        welded[3 * next + 2] = z;
        index[i] = next++;
        break;
      }
      const vertex = held - 1;
      if (cells[3 * vertex] === cx && cells[3 * vertex + 1] === cy && cells[3 * vertex + 2] === cz) {
        index[i] = vertex;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }

  // As mergeVertices() builds its result: a clone (groups, user data and
  // any computed bounds come along), the trimmed attribute, and an index
  // 16 bits wide unless a vertex number needs more (three's own rule,
  // 65535 being WebGL's primitive-restart value).
  const result = geometry.clone();
  const Attribute = /** @type {typeof THREE.BufferAttribute} */ (source.constructor);
  result.setAttribute("position", new Attribute(welded.slice(0, next * 3), 3, false));
  result.setIndex(
    next > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1),
  );
  return result;
}
