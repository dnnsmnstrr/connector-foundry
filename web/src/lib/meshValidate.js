// Validate-and-repair gate for a user-uploaded STL, run before it's
// allowed to become a Bench part. Mirrors the checks
// tests/test_manifold.py uses via trimesh (winding consistency, a
// single positive-volume solid) — reimplemented here because the Bench
// runs entirely client-side with no Python/trimesh available, not
// because the criteria are different. One addition: a real per-edge
// manifold check. test_manifold.py explicitly skips that (OpenSCAD's
// own STL export leaves harmless seam artifacts that would fail it),
// but an arbitrary uploaded mesh can have actual holes or T-junctions,
// which is exactly what this gate exists to catch.
//
// Repair order matters: STL is a triangle soup with no shared vertices
// at all, even at seams, so welding coincident vertices has to happen
// before any edge-adjacency analysis means anything. After that,
// winding-consistency and outward-facing-normal repairs are safe
// (they change no geometry, only triangle order); an open or
// non-manifold edge that survives welding is a real hole or junction,
// which is not something to silently patch over — surface it and
// refuse.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const WELD_TOLERANCE_MM = 1e-3;
const MIN_COMPONENT_AREA_MM2 = 1e-6;

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function buildTopology(geometry) {
  const index = geometry.index.array;
  const triCount = index.length / 3;
  const faces = new Array(triCount);
  const edgeMap = new Map(); // edgeKey -> [{tri, dir: [v1,v2]}, ...]

  for (let t = 0; t < triCount; t++) {
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    faces[t] = [a, b, c];
    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(v1, v2);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ tri: t, dir: [v1, v2] });
    }
  }
  return { faces, edgeMap, triCount };
}

function faceAdjacency(faces, edgeMap) {
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

function connectedComponents(faces, adjacency) {
  const componentOf = new Int32Array(faces.length).fill(-1);
  const components = [];
  for (let start = 0; start < faces.length; start++) {
    if (componentOf[start] !== -1) continue;
    const id = components.length;
    const members = [];
    const queue = [start];
    componentOf[start] = id;
    while (queue.length) {
      const f = queue.pop();
      members.push(f);
      for (const { face } of adjacency[f]) {
        if (componentOf[face] === -1) {
          componentOf[face] = id;
          queue.push(face);
        }
      }
    }
    components.push(members);
  }
  return { componentOf, components };
}

function analyzeEdges(edgeMap) {
  let openEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const occurrences of edgeMap.values()) {
    if (occurrences.length === 1) openEdges++;
    else if (occurrences.length > 2) nonManifoldEdges++;
    else {
      const [d0, d1] = occurrences.map((o) => o.dir);
      const consistent = d0[0] === d1[1] && d0[1] === d1[0];
      if (!consistent) inconsistentEdges++;
    }
  }
  return { openEdges, nonManifoldEdges, inconsistentEdges };
}

// BFS orientation propagation within one component: make every face's
// winding consistent with its neighbors, relative to an arbitrary seed
// face. Mutates `faces` in place (swaps two indices to flip a face).
function fixWindingConsistency(faces, adjacency, members) {
  const visited = new Set();
  const seed = members[0];
  visited.add(seed);
  const queue = [seed];
  let flips = 0;

  while (queue.length) {
    const f = queue.shift();
    for (const { face: g, edge } of adjacency[f]) {
      if (visited.has(g)) continue;
      visited.add(g);
      queue.push(g);

      // `edge` is one of the two occurrences of the shared edge; find
      // both directions to see whether f and g already disagree
      // correctly (opposite directions = consistent) or not.
      const [v1, v2] = edge.dir;
      const gFace = faces[g];
      const gHasForward = (gFace[0] === v1 && gFace[1] === v2) ||
        (gFace[1] === v1 && gFace[2] === v2) ||
        (gFace[2] === v1 && gFace[0] === v2);
      // f's occurrence of this edge is `edge.dir` itself if edge.tri === f,
      // otherwise we need the other occurrence — but since we only need
      // to know f's direction for this edge, and f is already visited
      // (fixed), derive it directly from faces[f].
      const fFace = faces[f];
      const fHasForward = (fFace[0] === v1 && fFace[1] === v2) ||
        (fFace[1] === v1 && fFace[2] === v2) ||
        (fFace[2] === v1 && fFace[0] === v2);

      // Consistent mating means f and g traverse the shared edge in
      // opposite directions. If both traverse it the same way, g is
      // backwards relative to f — flip it.
      if (fHasForward === gHasForward) {
        const tmp = gFace[1];
        gFace[1] = gFace[2];
        gFace[2] = tmp;
        flips++;
      }
    }
  }
  return flips;
}

function signedVolume(faces, members, position) {
  let volume = 0;
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  for (const f of members) {
    const [a, b, c] = faces[f];
    v0.fromBufferAttribute(position, a);
    v1.fromBufferAttribute(position, b);
    v2.fromBufferAttribute(position, c);
    volume += v0.dot(v1.clone().cross(v2));
  }
  return volume / 6;
}

function flipComponent(faces, members) {
  for (const f of members) {
    const face = faces[f];
    const tmp = face[1];
    face[1] = face[2];
    face[2] = tmp;
  }
}

function facesToIndex(faces) {
  const out = new (faces.length * 3 > 65535 ? Uint32Array : Uint16Array)(faces.length * 3);
  for (let t = 0; t < faces.length; t++) {
    out[3 * t] = faces[t][0];
    out[3 * t + 1] = faces[t][1];
    out[3 * t + 2] = faces[t][2];
  }
  return out;
}

function triangleArea(position, a, b, c) {
  const v0 = new THREE.Vector3().fromBufferAttribute(position, a);
  const v1 = new THREE.Vector3().fromBufferAttribute(position, b);
  const v2 = new THREE.Vector3().fromBufferAttribute(position, c);
  return v1.clone().sub(v0).cross(v2.clone().sub(v0)).length() / 2;
}

// Returns { geometry, ok, report, extents, center }. `geometry` is
// always indexed and welded, whether or not `ok`; a caller that wants
// to render a rejected mesh for diagnostic purposes still can.
export function validateAndRepair(rawGeometry) {
  const report = [];

  // mergeVertices() hashes by every attribute, not just position. STL's
  // parsed geometry carries a `normal` attribute duplicated per-vertex
  // from each triangle's flat facet normal, which differs across every
  // pair of faces meeting at an edge — so without dropping it first,
  // vertices at the exact same position never merge across a face
  // boundary, only within one face's own two triangles. Position is
  // the only thing that should define "the same vertex" here; normals
  // get recomputed cleanly after topology is sorted out below.
  const stripped = rawGeometry.clone();
  stripped.deleteAttribute("normal");
  stripped.deleteAttribute("uv");
  const geometry = mergeVertices(stripped, WELD_TOLERANCE_MM);
  if (!geometry.index) {
    return { geometry, ok: false, report: ["Mesh has no triangles after welding — empty or degenerate file."] };
  }

  let { faces, edgeMap } = buildTopology(geometry);
  const position = geometry.attributes.position;

  // Drop near-zero-area triangles (degenerate slivers, common in
  // exports) before topology analysis — they otherwise show up as
  // spurious open/non-manifold edges.
  const before = faces.length;
  faces = faces.filter(([a, b, c]) => triangleArea(position, a, b, c) > MIN_COMPONENT_AREA_MM2);
  if (faces.length !== before) {
    report.push(`Dropped ${before - faces.length} degenerate (near-zero-area) triangles.`);
  }
  geometry.setIndex(Array.from(facesToIndex(faces)));
  ({ faces, edgeMap } = buildTopology(geometry));

  let adjacency = faceAdjacency(faces, edgeMap);
  let { components } = connectedComponents(faces, adjacency);

  let totalFlips = 0;
  for (const members of components) {
    totalFlips += fixWindingConsistency(faces, adjacency, members);
  }
  if (totalFlips > 0) report.push(`Fixed winding direction on ${totalFlips} triangle(s).`);

  let flippedComponents = 0;
  for (const members of components) {
    if (signedVolume(faces, members, position) < 0) {
      flipComponent(faces, members);
      flippedComponents++;
    }
  }
  if (flippedComponents > 0) {
    report.push(`Flipped ${flippedComponents} inside-out shell(s) to face outward.`);
  }

  geometry.setIndex(Array.from(facesToIndex(faces)));
  ({ faces, edgeMap } = buildTopology(geometry));
  adjacency = faceAdjacency(faces, edgeMap);
  ({ components } = connectedComponents(faces, adjacency));

  const { openEdges, nonManifoldEdges, inconsistentEdges } = analyzeEdges(edgeMap);
  const solidComponents = components.filter((members) =>
    members.reduce((sum, f) => sum + triangleArea(position, ...faces[f]), 0) > MIN_COMPONENT_AREA_MM2);

  if (openEdges > 0) {
    report.push(`${openEdges} open edge(s) remain — this mesh has an actual hole, not just an export artifact. Welding and winding repair can't fix a real hole.`);
  }
  if (nonManifoldEdges > 0) {
    report.push(`${nonManifoldEdges} non-manifold edge(s) remain — an edge shared by 3+ faces (a T-junction or self-intersection).`);
  }
  if (inconsistentEdges > 0) {
    report.push(`${inconsistentEdges} edge(s) still have inconsistent winding after repair — likely tangled with a non-manifold region above.`);
  }
  if (solidComponents.length > 1) {
    report.push(`${solidComponents.length} disconnected solids in one file — is this really one part, or several?`);
  }
  if (solidComponents.length === 0) {
    report.push("No solid geometry found.");
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const extents = [max.x - min.x, max.y - min.y, max.z - min.z];
  const center = [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2];

  const ok = openEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0 && solidComponents.length === 1;
  if (ok && report.length === 0) report.push("Clean — watertight, single solid, no repairs needed.");
  else if (ok) report.push("Passed after repair.");

  return { geometry, ok, report, extents, center };
}
