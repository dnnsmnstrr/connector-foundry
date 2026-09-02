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

export function createImportedPart(name, validation) {
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
    anchors: [], // [{ name, point: [x,y,z] relative to center, normal: [nx,ny,nz] }]
  };
}

function exportStlBytesFor(geometry) {
  const mesh = new THREE.Mesh(geometry);
  const data = new STLExporter().parse(mesh, { binary: true });
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export function addAnchor(part, name, worldPoint, worldNormal) {
  const point = [
    worldPoint[0] - part.center[0],
    worldPoint[1] - part.center[1],
    worldPoint[2] - part.center[2],
  ];
  return { ...part, anchors: [...part.anchors, { name, point, normal: [...worldNormal] }] };
}

export function removeAnchor(part, name) {
  return { ...part, anchors: part.anchors.filter((a) => a.name !== name) };
}

export function nextAnchorName(part) {
  let n = part.anchors.length + 1;
  while (part.anchors.some((a) => a.name === `slot${n}`)) n++;
  return `slot${n}`;
}
