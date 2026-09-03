// A part the user brought in via STL upload, not one of ours. Once it
// passes web/src/lib/meshValidate.js's gate it becomes a first-class
// Bench part: confidence "imported" ("we didn't derive this, the user
// brought it"), with user-placed anchors standing in for the
// catalogue's slots/mount conventions.
//
// Licensing/hygiene: this whole module is runtime/session state only.
// Nothing here is ever written to disk in this repo — no imported STL
// is committed, shipped as a fixture, or fetched programmatically from
// Printables/Mechanism/Thingiverse. The user supplies the file; it
// lives in browser memory for the session and nowhere else.
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

let nextImportId = 1;

// `anchors` is only ever passed by benchConfig.js, rebuilding a part
// from a saved config: the anchors are already in the centered frame
// addAnchor() below stores them in, and the bytes being re-validated are
// the repaired mesh this same module exported, so its center is the one
// they were measured against. Always a fresh id, even then — the id
// namespace is per session, and a config's ids are just labels.
export function createImportedPart(name, validation, anchors = []) {
  const geometry = validation.geometry;
  return {
    id: `imported:${nextImportId++}`,
    kind: "imported",
    name,
    confidence: "imported",
    geometry, // welded + repaired, LOCAL (un-centered) coordinates
    // Computed once here, not per-render: this is what actually goes to
    // the worker (the validated/repaired mesh, not the raw upload), and
    // re-serializing on every compileToScad() call would be wasted work
    // since the geometry never changes after import.
    stlBytes: exportStlBytesFor(geometry),
    extents: validation.extents,
    center: validation.center,
    report: validation.report,
    // [{ name, point: [x,y,z] relative to center, normal: [nx,ny,nz] }]
    anchors: anchors.map((a) => ({ name: a.name, point: [...a.point], normal: [...a.normal] })),
  };
}

function exportStlBytesFor(geometry) {
  const mesh = new THREE.Mesh(geometry);
  const data = new STLExporter().parse(mesh, { binary: true });
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Anchors are stored relative to the part's bounding-box center (the
// frame the generated attachable() wrapper puts the geometry in — see
// assembly.js's importedModuleSource()); `part.geometry` itself is still
// in the file's own un-centered coordinates. These two convert between
// the frames — the import viewer shows the raw geometry, so it places
// markers and reads clicks in that un-centered frame.
export function anchorDisplayPoint(part, anchor) {
  return [
    anchor.point[0] + part.center[0],
    anchor.point[1] + part.center[1],
    anchor.point[2] + part.center[2],
  ];
}

export function addAnchor(part, name, displayPoint, normal) {
  const point = [
    displayPoint[0] - part.center[0],
    displayPoint[1] - part.center[1],
    displayPoint[2] - part.center[2],
  ];
  return { ...part, anchors: [...part.anchors, { name, point, normal: [...normal] }] };
}

// The existing anchor within `toleranceMm` of `displayPoint`, if any.
// clusterFace() is deterministic per connected coplanar patch, so
// clicking the same flat face again (anywhere on it) recomputes the same
// center regardless of which triangle was hit — "very close to an
// existing anchor" means "that one", not a second marker on top of it.
export function findAnchorNear(part, displayPoint, toleranceMm) {
  return part.anchors.find((a) => {
    const [x, y, z] = anchorDisplayPoint(part, a);
    return Math.hypot(x - displayPoint[0], y - displayPoint[1], z - displayPoint[2]) < toleranceMm;
  });
}

export function removeAnchor(part, name) {
  return { ...part, anchors: part.anchors.filter((a) => a.name !== name) };
}

export function nextAnchorName(part) {
  let n = part.anchors.length + 1;
  while (part.anchors.some((a) => a.name === `slot${n}`)) n++;
  return `slot${n}`;
}
