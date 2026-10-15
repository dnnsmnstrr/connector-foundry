// Face-center snapping for STL-import slot placement: given a raycast
// hit on one triangle, find the connected group of coplanar triangles
// forming the flat surface the user actually clicked (not just that
// one triangle), and report its center and normal — "click anywhere on
// a mounting face, land the slot in the middle of it" rather than
// wherever the ray happened to hit.
//
// Degrades gracefully on a curved or faceted surface: the flood fill
// simply stops at the first triangle whose normal diverges beyond
// tolerance, so a single triangle's own centroid is reported — never
// worse than a raw click point, and exactly right on any genuinely
// flat CAD-exported face (those tessellate with a uniform per-triangle
// normal).
//
// Requires an indexed, welded geometry (meshValidate.js's output) —
// triangle adjacency is meaningless on a raw STL triangle soup, where
// no two triangles share a vertex index even across a shared edge.
import * as THREE from "three";
import { triangleNeighbors } from "./meshTopology.js";

const DEFAULT_ANGLE_TOL_DEG = 3;
const DEFAULT_PLANE_TOL_MM = 0.05;

// Adjacency is a property of the geometry, not of the click: building
// it is the expensive part of a pick (one pass over every triangle),
// and the same imported mesh gets clicked many times while its slots
// are placed. Keyed on the geometry, invalidated if its index is ever
// swapped for another.
const neighborsByGeometry = new WeakMap();

// The adjacency meshValidate.js's validateAndRepair() already built for
// the same index: handed over here, the first slot click on a large
// import costs what every later one does, instead of a second pass over
// every edge. `neighbors`: face index -> [neighbouring face indices], in
// the order of `geometry.index` as it is now.
export function primeNeighbors(geometry, neighbors) {
  if (!geometry.index || !neighbors) return;
  neighborsByGeometry.set(geometry, { index: geometry.index, neighbors });
}

function neighborsFor(geometry) {
  const index = geometry.index;
  const cached = neighborsByGeometry.get(geometry);
  if (cached && cached.index === index) return cached.neighbors;
  const neighbors = triangleNeighbors(index.array, geometry.attributes.position.count);
  neighborsByGeometry.set(geometry, { index, neighbors });
  return neighbors;
}

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3();

function loadTriangle(position, index, t) {
  _a.fromBufferAttribute(position, index.getX(3 * t));
  _b.fromBufferAttribute(position, index.getX(3 * t + 1));
  _c.fromBufferAttribute(position, index.getX(3 * t + 2));
}

function triNormal(position, index, t, out) {
  loadTriangle(position, index, t);
  return out.subVectors(_b, _a).cross(_c.sub(_a)).normalize();
}

function triCentroid(position, index, t, out) {
  loadTriangle(position, index, t);
  return out
    .copy(_a)
    .add(_b)
    .add(_c)
    .multiplyScalar(1 / 3);
}

// `geometry`: indexed BufferGeometry (validateAndRepair()'s output).
// `faceIndex`: the triangle THREE's raycaster hit (Intersection.faceIndex).
// Returns { point: [x,y,z], normal: [nx,ny,nz], triangleCount, triangles }
// — all in the geometry's own local space (caller transforms to world if
// needed). `triangles` is every triangle index in the cluster, which
// snapCandidates.js walks again for the face's outline.
// null when the seed triangle is degenerate (zero area, or a NaN
// vertex): it has no normal, so there is no plane to grow — and a
// [0, 0, 0] normal handed on would place a hole with no direction.
export function clusterFace(geometry, faceIndex, options = {}) {
  const angleTolDeg = options.angleTolDeg ?? DEFAULT_ANGLE_TOL_DEG;
  const planeTol = options.planeTol ?? DEFAULT_PLANE_TOL_MM;
  const cosTol = Math.cos((angleTolDeg * Math.PI) / 180);

  const position = geometry.attributes.position;
  const index = geometry.index;
  const neighbors = neighborsFor(geometry);

  const startNormal = triNormal(position, index, faceIndex, new THREE.Vector3());
  // normalize() leaves a zero vector at zero (and NaN as NaN); a real
  // normal is length 1, so anything well short of that has none.
  if (!(startNormal.lengthSq() > 0.5)) return null;
  const planePoint = triCentroid(position, index, faceIndex, new THREE.Vector3());

  const normal = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const visited = new Set([faceIndex]);
  const stack = [faceIndex];
  while (stack.length) {
    const t = stack.pop();
    for (const nb of neighbors[t]) {
      if (visited.has(nb)) continue;
      if (triNormal(position, index, nb, normal).dot(startNormal) < cosTol) continue;
      triCentroid(position, index, nb, centroid);
      if (Math.abs(centroid.sub(planePoint).dot(startNormal)) > planeTol) continue;
      visited.add(nb);
      stack.push(nb);
    }
  }

  // Center = midpoint of the cluster's 2D bounding box, projected onto
  // the plane — robust to uneven triangulation, unlike an area-weighted
  // centroid (which an L-shaped or lopsidedly-tessellated face would
  // pull off visual-center).
  const up = startNormal;
  const arbitrary = Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = arbitrary.cross(up).normalize();
  const v = up.clone().cross(u).normalize();

  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  const seenVerts = new Set();
  const p = new THREE.Vector3();
  for (const t of visited) {
    for (let k = 0; k < 3; k++) {
      const vi = index.getX(3 * t + k);
      if (seenVerts.has(vi)) continue;
      seenVerts.add(vi);
      p.fromBufferAttribute(position, vi).sub(planePoint);
      const du = p.dot(u);
      const dv = p.dot(v);
      if (du < minU) minU = du;
      if (du > maxU) maxU = du;
      if (dv < minV) minV = dv;
      if (dv > maxV) maxV = dv;
    }
  }
  const center = planePoint
    .clone()
    .addScaledVector(u, (minU + maxU) / 2)
    .addScaledVector(v, (minV + maxV) / 2);

  return {
    point: [center.x, center.y, center.z],
    normal: [startNormal.x, startNormal.y, startNormal.z],
    triangleCount: visited.size,
    triangles: [...visited],
  };
}
