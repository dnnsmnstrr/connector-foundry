// Triangle-mesh topology shared by the STL-import pipeline: the
// validate/repair gate (meshValidate.js) needs per-edge occurrence lists
// with winding direction; face-center snapping (faceCluster.js) needs
// only "which triangles share an edge with this one". Both used to build
// their own edge maps with string keys — on a detailed scan (hundreds of
// thousands of triangles) that was seconds of string hashing per
// operation, so the shared builders here key on a packed number instead.
//
// Everything takes an indexed geometry's index array: adjacency is
// meaningless on a raw STL triangle soup, where no two triangles share
// a vertex index even across a shared edge — weld first (mergeVertices).

// Two vertex indices packed into one double: exact while both are below
// 2^26 (67 million vertices), which no browser mesh approaches. The
// string fallback keeps the code correct rather than merely fast if one
// ever does.
const KEY_STRIDE = 2 ** 26;

function edgeKeyFor(vertexCount) {
  if (vertexCount < KEY_STRIDE) return (a, b) => (a < b ? a * KEY_STRIDE + b : b * KEY_STRIDE + a);
  return (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
}

// { faces: [[a, b, c], ...], edgeMap: Map<edgeKey, [{ tri, dir: [v1, v2] }, ...]> }
// `faces` is a plain array of arrays on purpose — meshValidate.js repairs
// winding by swapping two indices of a face in place.
export function buildTopology(indexArray, vertexCount) {
  const triCount = Math.floor(indexArray.length / 3);
  const edgeKey = edgeKeyFor(vertexCount);
  const faces = new Array(triCount);
  const edgeMap = new Map();

  const record = (key, tri, v1, v2) => {
    const occurrence = { tri, dir: [v1, v2] };
    const list = edgeMap.get(key);
    if (list) list.push(occurrence);
    else edgeMap.set(key, [occurrence]);
  };

  for (let t = 0; t < triCount; t++) {
    const a = indexArray[3 * t], b = indexArray[3 * t + 1], c = indexArray[3 * t + 2];
    faces[t] = [a, b, c];
    record(edgeKey(a, b), t, a, b);
    record(edgeKey(b, c), t, b, c);
    record(edgeKey(c, a), t, c, a);
  }
  return { faces, edgeMap, triCount };
}

// face index -> [{ face: neighbour, edge: this face's own occurrence of
// the shared edge }, ...]. An edge shared by three or more faces (a
// non-manifold junction) links every pair.
export function faceAdjacency(faces, edgeMap) {
  const adjacency = Array.from({ length: faces.length }, () => []);
  for (const occurrences of edgeMap.values()) {
    for (let i = 0; i < occurrences.length; i++) {
      for (let j = i + 1; j < occurrences.length; j++) {
        adjacency[occurrences[i].tri].push({ face: occurrences[j].tri, edge: occurrences[i] });
        adjacency[occurrences[j].tri].push({ face: occurrences[i].tri, edge: occurrences[j] });
      }
    }
  }
  return adjacency;
}

// face index -> [neighbouring face indices] — the lighter structure
// clusterFace()'s flood fill needs, without recording edge directions.
export function triangleNeighbors(indexArray, vertexCount) {
  const triCount = Math.floor(indexArray.length / 3);
  const edgeKey = edgeKeyFor(vertexCount);
  const neighbors = Array.from({ length: triCount }, () => []);
  const seenAt = new Map(); // edgeKey -> first tri, or [tri, ...] once shared

  const link = (key, t) => {
    const seen = seenAt.get(key);
    if (seen === undefined) {
      seenAt.set(key, t);
    } else if (typeof seen === "number") {
      neighbors[seen].push(t);
      neighbors[t].push(seen);
      seenAt.set(key, [seen, t]);
    } else {
      for (const other of seen) {
        neighbors[other].push(t);
        neighbors[t].push(other);
      }
      seen.push(t);
    }
  };

  for (let t = 0; t < triCount; t++) {
    const a = indexArray[3 * t], b = indexArray[3 * t + 1], c = indexArray[3 * t + 2];
    link(edgeKey(a, b), t);
    link(edgeKey(b, c), t);
    link(edgeKey(c, a), t);
  }
  return neighbors;
}
