// 3MF → triangle mesh. A 3MF file is a zip holding an XML model
// (`3D/3dmodel.model`): indexed vertices and triangles per object,
// objects composed of other objects, and a build list placing them with
// transforms. three.js's ThreeMFLoader reads all of that (components,
// transforms, per-part materials) and hands back a Group of meshes, so
// the reader here is thin: run the loader, flatten the Group into the
// same `[{ name, positions, triangleCount, extents }]` bodies a STEP
// file tessellates to (stepMesh.js), and apply the file's unit — which
// the loader reads but never applies: a model saved in inches or
// centimetres would otherwise arrive 25.4 or 10 times too small, since
// everything downstream is millimetres.
//
// The loader needs the browser's DOMParser, so read3mf() is browser-only;
// everything else here is pure and unit-tested in Node (the zip is
// opened with the fflate build three.js ships, which runs anywhere).
import * as THREE from "three";
import * as fflate from "three/examples/jsm/libs/fflate.module.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

export const THREE_MF_EXTENSIONS = [".3mf"];

export function is3mfFilename(name) {
  const lower = String(name ?? "").toLowerCase();
  return THREE_MF_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// A 3MF is a zip, and every zip starts with the local-file-header
// signature. Checked alongside the extension the way looksLikeStep()
// is, so a mislabelled file still meets the right reader.
export function looksLikeZip(bytes) {
  const head = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, Math.min(bytes.byteLength, 4));
  return head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

// The 3MF core spec's `unit` values, in millimetres.
const UNIT_MM = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

// Millimetres per model unit; an unknown or missing unit is treated as
// millimetres, which is also the spec's default.
export function unitScale(unit) {
  return UNIT_MM[String(unit ?? "").toLowerCase()] ?? 1;
}

// The `unit` attribute of the file's root model part, read straight
// from the zip: the loader parses it but does not expose it. Returns
// null when there is no model part (the loader will fail on it too).
export function modelUnitOf(buffer) {
  let entries;
  try {
    entries = fflate.unzipSync(new Uint8Array(buffer));
  } catch {
    return null;
  }
  const modelName = Object.keys(entries).find((name) => /^3D\/.*\.model$/.test(name));
  if (!modelName) return null;
  const xml = new TextDecoder().decode(entries[modelName]);
  const open = xml.match(/<model\b[^>]*>/);
  const unit = open?.[0].match(/\bunit\s*=\s*["']([^"']*)["']/);
  return unit ? unit[1] : "millimeter";
}

// The loader's Group -> bodies, one per mesh, in world space and scaled
// to millimetres. Build items that place the same object twice give two
// bodies (two parts on the plate), each where the file puts it. A
// mesh's name is its own object's, else the nearest named ancestor's.
export function bodiesFromGroup(group, scale = 1) {
  group.updateMatrixWorld(true);
  const bodies = [];
  const v = new THREE.Vector3();
  group.traverse((node) => {
    if (!node.isMesh) return;
    const position = node.geometry?.getAttribute("position");
    if (!position || position.count < 3) return;
    const source = node.geometry.index
      ? expandIndexed(position, node.geometry.index)
      : position;
    const count = source.count;
    const positions = new Float32Array(count * 3);
    const box = new THREE.Box3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(source, i).applyMatrix4(node.matrixWorld).multiplyScalar(scale);
      positions[3 * i] = v.x;
      positions[3 * i + 1] = v.y;
      positions[3 * i + 2] = v.z;
      box.expandByPoint(v);
    }
    bodies.push({
      name: nameOf(node),
      positions,
      triangleCount: count / 3,
      extents: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
    });
  });
  return bodies;
}

function nameOf(node) {
  for (let n = node; n; n = n.parent) {
    if (n.name) return n.name;
  }
  return "";
}

// A non-indexed copy of an indexed position attribute (the loader emits
// triangle soup already; this keeps a hand-built Group honest too).
function expandIndexed(position, index) {
  const out = new THREE.BufferAttribute(new Float32Array(index.count * 3), 3);
  for (let i = 0; i < index.count; i++) {
    const vi = index.getX(i);
    out.setXYZ(i, position.getX(vi), position.getY(vi), position.getZ(vi));
  }
  return out;
}

// Browser only (ThreeMFLoader parses XML with DOMParser). `buffer`: the
// file's ArrayBuffer. Returns the bodies in millimetres; throws when the
// file is not a 3MF the loader can open.
export function read3mf(buffer) {
  const unit = modelUnitOf(buffer);
  if (unit === null) throw new Error("No 3D model part found — is this a 3MF file?");
  const group = new ThreeMFLoader().parse(buffer);
  if (!group) throw new Error("The 3MF file could not be read.");
  const bodies = bodiesFromGroup(group, unitScale(unit));
  group.traverse((node) => {
    if (node.isMesh) {
      node.geometry?.dispose();
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
      else node.material?.dispose();
    }
  });
  return bodies;
}
