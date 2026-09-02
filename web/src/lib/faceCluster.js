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

const DEFAULT_ANGLE_TOL_DEG = 3;
const DEFAULT_PLANE_TOL_MM = 0.05;

function buildAdjacency(index, triCount) {
  const edgeMap = new Map(); // edgeKey -> [triIndex, ...] (0, 1, or rarely more)
  const adjacency = Array.from({ length: triCount }, () => []);
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(3 * t), b = index.getX(3 * t + 1), c = index.getX(3 * t + 2);
    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      let occurrences = edgeMap.get(key);
      if (!occurrences) {
        occurrences = [];
        edgeMap.set(key, occurrences);
      }
      for (const other of occurrences) {
        adjacency[t].push(other);
        adjacency[other].push(t);
      }
      occurrences.push(t);
    }
  }
  return adjacency;
}

function triVerts(position, index, t) {
  const a = index.getX(3 * t), b = index.getX(3 * t + 1), c = index.getX(3 * t + 2);
  return [
    new THREE.Vector3().fromBufferAttribute(position, a),
    new THREE.Vector3().fromBufferAttribute(position, b),
    new THREE.Vector3().fromBufferAttribute(position, c),
  ];
}

function triNormal(position, index, t) {
  const [v0, v1, v2] = triVerts(position, index, t);
  return v1.clone().sub(v0).cross(v2.clone().sub(v0)).normalize();
}

function triCentroid(position, index, t) {
  const [v0, v1, v2] = triVerts(position, index, t);
  return v0.add(v1).add(v2).multiplyScalar(1 / 3);
}

// `geometry`: indexed BufferGeometry (validateAndRepair()'s output).
// `faceIndex`: the triangle THREE's raycaster hit (Intersection.faceIndex).
// Returns { point: [x,y,z], normal: [nx,ny,nz], triangleCount } — all in
// the geometry's own local space (caller transforms to world if needed).
export function clusterFace(geometry, faceIndex, options = {}) {
  const angleTolDeg = options.angleTolDeg ?? DEFAULT_ANGLE_TOL_DEG;
  const planeTol = options.planeTol ?? DEFAULT_PLANE_TOL_MM;
  const cosTol = Math.cos((angleTolDeg * Math.PI) / 180);

  const position = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index.count / 3;
  const adjacency = buildAdjacency(index, triCount);

  const startNormal = triNormal(position, index, faceIndex);
  const planePoint = triCentroid(position, index, faceIndex);

  const visited = new Set([faceIndex]);
  const queue = [faceIndex];
  while (queue.length) {
    const t = queue.pop();
    for (const nb of adjacency[t]) {
      if (visited.has(nb)) continue;
      const n = triNormal(position, index, nb);
      if (n.dot(startNormal) < cosTol) continue;
      const c = triCentroid(position, index, nb);
      if (Math.abs(c.clone().sub(planePoint).dot(startNormal)) > planeTol) continue;
      visited.add(nb);
      queue.push(nb);
    }
  }

  // Center = midpoint of the cluster's 2D bounding box, projected onto
  // the plane — robust to uneven triangulation, unlike an area-weighted
  // centroid (which an L-shaped or lopsidedly-tessellated face would
  // pull off visual-center).
  const up = startNormal;
  const arbitrary = Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = arbitrary.clone().cross(up).normalize();
  const v = up.clone().cross(u).normalize();

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const seenVerts = new Set();
  for (const t of visited) {
    const a = index.getX(3 * t), b = index.getX(3 * t + 1), c = index.getX(3 * t + 2);
    for (const vi of [a, b, c]) {
      if (seenVerts.has(vi)) continue;
      seenVerts.add(vi);
      const p = new THREE.Vector3().fromBufferAttribute(position, vi).sub(planePoint);
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
    .add(u.clone().multiplyScalar((minU + maxU) / 2))
    .add(v.clone().multiplyScalar((minV + maxV) / 2));

  return {
    point: [center.x, center.y, center.z],
    normal: [startNormal.x, startNormal.y, startNormal.z],
    triangleCount: visited.size,
  };
}
