// STEP → triangle mesh, the pure half. A STEP file is B-rep (exact
// surfaces, not triangles), so before it can go through the same
// validate/repair gate and OpenSCAD `import()` an uploaded STL does it has
// to be tessellated. That runs in src/worker/step-worker.js (OpenCASCADE
// compiled to WebAssembly via occt-import-js — the same OCCT the Python
// side's `cascadio` wraps in tools/refcache.py); this module is everything
// around it that has no WebAssembly in it, so it can be unit-tested in
// Node: deciding whether a file is STEP, the tessellation settings, and
// turning the reader's result into bodies and a three.js geometry.
import * as THREE from "three";
import { THREE_MF_EXTENSIONS } from "./threeMfMesh.js";

export const STEP_EXTENSIONS = [".step", ".stp"];

// `accept=` for a file input that takes any kind of mesh upload: STL as
// it is, STEP tessellated here, 3MF unpacked here (threeMfMesh.js).
export const MESH_FILE_ACCEPT = [".stl", ...STEP_EXTENSIONS, ...THREE_MF_EXTENSIONS].join(",");

export function isStepFilename(name) {
  const lower = String(name ?? "").toLowerCase();
  return STEP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Every STEP file (ISO 10303-21) opens with this exact token. Checked in
// addition to the extension so a file named `.stl` that is really STEP
// (or the other way round) gets read by the right parser rather than
// failing with a parse error from the wrong one.
const STEP_MAGIC = "ISO-10303-21;";
export function looksLikeStep(bytes) {
  const head = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, Math.min(bytes.byteLength, 256));
  let text = "";
  for (let i = 0; i < head.length; i++) text += String.fromCharCode(head[i]);
  return text.trimStart().startsWith(STEP_MAGIC);
}

// Meshing tolerances handed to occt-import-js. The output is always in
// millimetres whatever unit the file declares (`linearUnit`); the
// deflections are absolute, in those millimetres. 0.05 mm chord error
// and 0.2 rad (~11.5°, so 32 segments on a full circle) is below what an
// FDM printer resolves and keeps a typical downloaded part at a few
// thousand triangles — the Bench renders every imported mesh through
// OpenSCAD and Manifold on each change, so triangle count is render
// time. tools/refcache.py tessellates the same way for `make verify`
// but ten times finer (0.01 mm / 0.05 rad): that is metrology against a
// reference, this is a part to print.
export const STEP_TESSELLATION = Object.freeze({
  linearUnit: "millimeter",
  linearDeflectionType: "absolute_value",
  linearDeflection: 0.05,
  angularDeflection: 0.2,
});

// occt-import-js's result -> [{ name, positions, triangleCount, extents }],
// one per mesh (a STEP "body" — a solid, or a shell). `positions` is a
// flat Float32Array of triangle corners, three vertices per triangle with
// no index: the same triangle soup an STL parses to, so the downstream
// weld in meshValidate.js treats both uploads identically. Empty meshes
// (a body that tessellated to nothing) are dropped.
export function bodiesFromOcct(result) {
  if (!result?.success) throw new Error("OpenCASCADE could not read this file as STEP.");
  const bodies = [];
  for (const mesh of result.meshes ?? []) {
    const source = mesh.attributes?.position?.array;
    const index = mesh.index?.array;
    if (!source || !index || index.length < 3) continue;
    const positions = new Float32Array(index.length * 3);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < index.length; i++) {
      const at = index[i] * 3;
      positions[3 * i] = source[at];
      positions[3 * i + 1] = source[at + 1];
      positions[3 * i + 2] = source[at + 2];
      box.expandByPoint(v.set(source[at], source[at + 1], source[at + 2]));
    }
    bodies.push({
      name: typeof mesh.name === "string" ? mesh.name.trim() : "",
      positions,
      triangleCount: index.length / 3,
      extents: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
    });
  }
  if (bodies.length === 0) throw new Error("This STEP file contains no solid geometry.");
  return bodies;
}

// What to call a body in the picker: its own name when the file has one
// (Fusion/FreeCAD exports usually do), else "Body N". Many exporters
// name every body "SOLID" or leave it blank, so the index is appended
// whenever a name repeats within the file.
export function bodyLabels(bodies) {
  const counts = new Map();
  for (const b of bodies) counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
  return bodies.map((b, i) => {
    if (!b.name) return `Body ${i + 1}`;
    return counts.get(b.name) > 1 ? `${b.name} (${i + 1})` : b.name;
  });
}

// One non-indexed BufferGeometry from the chosen bodies — the shape
// STLLoader produces, which is what validateAndRepair() expects.
export function geometryFromBodies(bodies) {
  let total = 0;
  for (const b of bodies) total += b.positions.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const b of bodies) {
    merged.set(b.positions, offset);
    offset += b.positions.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  return geometry;
}
