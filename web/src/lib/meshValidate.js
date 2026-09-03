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
import { buildTopology, faceAdjacency } from "./meshTopology.js";

const WELD_TOLERANCE_MM = 1e-3;
const MIN_COMPONENT_AREA_MM2 = 1e-6;

// Scratch vectors for the per-triangle loops: an uploaded scan can run
// to hundreds of thousands of faces, and allocating three Vector3s per
// face was most of the cost of the area and volume passes.
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

function triangleArea(position, a, b, c) {
  _v0.fromBufferAttribute(position, a);
  _v1.fromBufferAttribute(position, b).sub(_v0);
  _v2.fromBufferAttribute(position, c).sub(_v0);
  return _v1.cross(_v2).length() / 2;
}

function signedVolume(faces, members, position) {
  let volume = 0;
  for (const f of members) {
    const [a, b, c] = faces[f];
    _v0.fromBufferAttribute(position, a);
    _v1.fromBufferAttribute(position, b);
    _v2.fromBufferAttribute(position, c);
    volume += _v0.dot(_v1.cross(_v2));
  }
  return volume / 6;
}

function connectedComponents(faces, adjacency) {
  const componentOf = new Int32Array(faces.length).fill(-1);
  const components = [];
  for (let start = 0; start < faces.length; start++) {
    if (componentOf[start] !== -1) continue;
    const id = components.length;
    const members = [];
    const stack = [start];
    componentOf[start] = id;
    while (stack.length) {
      const f = stack.pop();
      members.push(f);
      for (const { face } of adjacency[f]) {
        if (componentOf[face] === -1) {
          componentOf[face] = id;
          stack.push(face);
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
      const d0 = occurrences[0].dir, d1 = occurrences[1].dir;
      const consistent = d0[0] === d1[1] && d0[1] === d1[0];
      if (!consistent) inconsistentEdges++;
    }
  }
  return { openEdges, nonManifoldEdges, inconsistentEdges };
}

// Does `face` traverse the edge v1 -> v2 in that direction? Read from the
// face's CURRENT index order, since faces get flipped in place below and
// the direction recorded at topology-build time may be stale.
function traversesForward(face, v1, v2) {
  return (face[0] === v1 && face[1] === v2) ||
    (face[1] === v1 && face[2] === v2) ||
    (face[2] === v1 && face[0] === v2);
}

function flipFace(face) {
  const tmp = face[1];
  face[1] = face[2];
  face[2] = tmp;
}

// BFS orientation propagation within one component: make every face's
// winding consistent with its neighbors, relative to an arbitrary seed
// face. Mutates `faces` in place. `visited` is shared across components
// (each face belongs to exactly one). The queue is an array with a head
// pointer rather than shift() — shift() is O(n) on a large array, which
// made this quadratic on a big component.
function fixWindingConsistency(faces, adjacency, members, visited) {
  const seed = members[0];
  visited[seed] = 1;
  const queue = [seed];
  let head = 0;
  let flips = 0;

  while (head < queue.length) {
    const f = queue[head++];
    const fFace = faces[f];
    for (const { face: g, edge } of adjacency[f]) {
      if (visited[g]) continue;
      visited[g] = 1;
      queue.push(g);

      // Consistent mating means f and g traverse the shared edge in
      // opposite directions. If both traverse it the same way, g is
      // backwards relative to f (already fixed) — flip it.
      const [v1, v2] = edge.dir;
      if (traversesForward(fFace, v1, v2) === traversesForward(faces[g], v1, v2)) {
        flipFace(faces[g]);
        flips++;
      }
    }
  }
  return flips;
}

function facesToIndex(faces, vertexCount) {
  const out = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(faces.length * 3);
  for (let t = 0; t < faces.length; t++) {
    out[3 * t] = faces[t][0];
    out[3 * t + 1] = faces[t][1];
    out[3 * t + 2] = faces[t][2];
  }
  return out;
}

// Write `faces` back as the geometry's index and rebuild the topology
// from it. A typed array goes straight in as the attribute — no detour
// through a plain Array, which for a large mesh was a multi-megabyte
// copy per call.
function commitFaces(geometry, faces) {
  const vertexCount = geometry.attributes.position.count;
  geometry.setIndex(new THREE.BufferAttribute(facesToIndex(faces, vertexCount), 1));
  return buildTopology(geometry.index.array, vertexCount);
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

  const position = geometry.attributes.position;
  let { faces, edgeMap } = buildTopology(geometry.index.array, position.count);

  // Drop near-zero-area triangles (degenerate slivers, common in
  // exports) before topology analysis — they otherwise show up as
  // spurious open/non-manifold edges.
  const before = faces.length;
  faces = faces.filter(([a, b, c]) => triangleArea(position, a, b, c) > MIN_COMPONENT_AREA_MM2);
  if (faces.length !== before) {
    report.push(`Dropped ${before - faces.length} degenerate (near-zero-area) triangles.`);
    // Only now is the topology just built stale. Each rebuild is a full
    // pass over every edge (a Map with ~1.5 entries per triangle), and on
    // the common clean upload nothing was dropped, so the first one stands.
    ({ faces, edgeMap } = commitFaces(geometry, faces));
  }

  let adjacency = faceAdjacency(faces, edgeMap);
  let { components } = connectedComponents(faces, adjacency);

  const visited = new Uint8Array(faces.length);
  let totalFlips = 0;
  for (const members of components) {
    totalFlips += fixWindingConsistency(faces, adjacency, members, visited);
  }
  if (totalFlips > 0) report.push(`Fixed winding direction on ${totalFlips} triangle(s).`);

  let flippedComponents = 0;
  for (const members of components) {
    if (signedVolume(faces, members, position) < 0) {
      for (const f of members) flipFace(faces[f]);
      flippedComponents++;
    }
  }
  if (flippedComponents > 0) {
    report.push(`Flipped ${flippedComponents} inside-out shell(s) to face outward.`);
  }

  // A flip changes a face's index order, so the edge directions recorded
  // at build time — what analyzeEdges() reads — go stale, and the index
  // has to be written back; with no flip at all, faces, edgeMap,
  // adjacency and components are exactly what a rebuild would produce.
  // Skipping it there saves the second of the two big passes on a mesh
  // that arrived correctly wound, which most exported ones do.
  if (totalFlips > 0 || flippedComponents > 0) {
    ({ faces, edgeMap } = commitFaces(geometry, faces));
    adjacency = faceAdjacency(faces, edgeMap);
    ({ components } = connectedComponents(faces, adjacency));
  }

  const { openEdges, nonManifoldEdges, inconsistentEdges } = analyzeEdges(edgeMap);
  // A component with any area to speak of. Stops at the first face that
  // gets the running total over the line — after the degenerate filter
  // above every face does on its own, so this is one triangle per
  // component rather than a third sweep over the whole mesh.
  const solidComponents = components.filter((members) => {
    let area = 0;
    for (const f of members) {
      const [a, b, c] = faces[f];
      area += triangleArea(position, a, b, c);
      if (area > MIN_COMPONENT_AREA_MM2) return true;
    }
    return false;
  });

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
