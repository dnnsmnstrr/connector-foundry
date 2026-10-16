import test from "node:test";
import assert from "node:assert/strict";

import { meshBounds, meshExtents } from "../../src/lib/meshExtents.js";

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

test("an STL's bounds are its min and max corners, memoised per buffer", () => {
  const stl = binaryStl([
    [
      [-5, 2, 0],
      [10, 0, 1],
      [0, 4, -2],
    ],
    [
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 7],
    ],
  ]);
  assert.deepEqual(meshBounds(stl), { min: [-5, 0, -2], max: [10, 4, 7] });
  assert.equal(meshBounds(stl), meshBounds(stl));
  assert.deepEqual(meshExtents(stl), [15, 4, 9]);
});

test("an STL with no triangles is a point at the origin", () => {
  assert.deepEqual(meshBounds(binaryStl([])), { min: [0, 0, 0], max: [0, 0, 0] });
});

test("an ASCII STL goes through the loader and gives the same box", () => {
  const text = `solid tri
facet normal 0 0 1
  outer loop
    vertex -1 -2 0
    vertex 3 0 0.5
    vertex 0 4 2
  endloop
endfacet
endsolid tri
`;
  const stl = new TextEncoder().encode(text).buffer;
  assert.deepEqual(meshBounds(stl), { min: [-1, -2, 0], max: [3, 4, 2] });
  assert.deepEqual(meshExtents(stl), [4, 6, 2]);
});

test("a view into a larger buffer is read at its own offset, and keyed apart from it", () => {
  const stl = binaryStl([
    [
      [0, 0, 0],
      [6, 0, 0],
      [0, 3, 9],
    ],
  ]);
  // The STL sits 16 bytes into a bigger buffer, after junk.
  const backing = new Uint8Array(16 + stl.byteLength + 8).fill(0xff);
  backing.set(new Uint8Array(stl), 16);
  const view = new Uint8Array(backing.buffer, 16, stl.byteLength);
  assert.deepEqual(meshBounds(view), { min: [0, 0, 0], max: [6, 3, 9] });
  assert.equal(meshBounds(view), meshBounds(view));
  // An ASCII STL in a view takes the loader path, which needs a buffer
  // of its own.
  const ascii = new TextEncoder().encode(
    "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 2 1\nendloop\nendfacet\nendsolid t\n",
  );
  const padded = new Uint8Array(4 + ascii.byteLength);
  padded.set(ascii, 4);
  assert.deepEqual(meshExtents(new Uint8Array(padded.buffer, 4)), [2, 2, 1]);
});
