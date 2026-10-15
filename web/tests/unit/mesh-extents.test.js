import test from "node:test";
import assert from "node:assert/strict";

import { meshExtents } from "../../src/lib/meshExtents.js";

// A binary STL: an 80-byte header, a triangle count, then 50 bytes per
// triangle (normal, three vertices, attribute count).
function binaryStl(triangles) {
  const buffer = new ArrayBuffer(84 + 50 * triangles.length);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((vertices, t) => {
    vertices.flat().forEach((value, k) => view.setFloat32(84 + 50 * t + 12 + 4 * k, value, true));
  });
  return buffer;
}

test("an STL's extents are its bounding box size", () => {
  const stl = binaryStl([
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 4, 2],
    ],
  ]);
  assert.deepEqual(meshExtents(stl), [10, 4, 2]);
  // Memoised per buffer: the same array comes back.
  assert.equal(meshExtents(stl), meshExtents(stl));
});

test("an STL with no triangles is zero in size, not -Infinity", () => {
  assert.deepEqual(meshExtents(binaryStl([])), [0, 0, 0]);
});
