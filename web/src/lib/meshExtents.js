import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// Bounding-box size [x, y, z] of an STL, memoised per buffer. The render
// pipeline emits ASCII STL (OpenSCAD's default for -o *.stl), so this
// needs a real parser, not a fixed binary layout — STLLoader handles
// both. The Bench re-derives every node's standalone extents on each
// assembly edit; openscad-client hands back the same ArrayBuffer for a
// cache hit, so keying on the buffer makes the re-derivation a lookup
// instead of a re-parse of a mesh that can run to megabytes.
const extentsByBuffer = new WeakMap();

export function meshExtents(stlBuffer) {
  let extents = extentsByBuffer.get(stlBuffer);
  if (!extents) {
    const geometry = new STLLoader().parse(stlBuffer);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    extents = [max.x - min.x, max.y - min.y, max.z - min.z];
    geometry.dispose();
    extentsByBuffer.set(stlBuffer, extents);
  }
  return extents;
}
