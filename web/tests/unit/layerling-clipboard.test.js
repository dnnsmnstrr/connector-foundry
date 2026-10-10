import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYERLING_CLIPBOARD_PREFIX, layerlingClipboardText, layerlingShapes } from "../../src/lib/layerlingClipboard.js";

// Binary STL of the given triangles ([[x,y,z] x3] each), as OpenSCAD
// writes it (Z-up).
function binaryStl(triangles) {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) => {
    triangle.flat().forEach((v, i) => view.setFloat32(84 + t * 50 + 12 + i * 4, v, true));
  });
  return buffer;
}

// Closed box from `min` to `max`, Z-up.
function box(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return binaryStl(quads.flatMap(([a, b, cc, d]) => [[c(a), c(b), c(cc)], [c(a), c(cc), c(d)]]));
}

// What Layerling's pasteShape()/parseClipboardShapes() accept: the
// prefix, a {copiedAt, shapes} object, and string name/kind/color on
// every shape.
function parseLikeLayerling(text) {
  assert.ok(text.startsWith(LAYERLING_CLIPBOARD_PREFIX));
  assert.equal(LAYERLING_CLIPBOARD_PREFIX, "LAYERLING/1\n");
  const payload = JSON.parse(text.slice(LAYERLING_CLIPBOARD_PREFIX.length));
  assert.equal(typeof payload.copiedAt, "number");
  assert.ok(Array.isArray(payload.shapes));
  for (const shape of payload.shapes) {
    for (const key of ["name", "kind", "color"]) assert.equal(typeof shape[key], "string");
  }
  return payload;
}

test("writes Layerling's clipboard format with the given stamp", () => {
  const text = layerlingClipboardText([{ name: "Clip", stlBuffer: box([0, 0, 0], [10, 10, 10]) }], 1234);
  const payload = parseLikeLayerling(text);
  assert.equal(payload.copiedAt, 1234);
  assert.equal(payload.shapes.length, 1);
  const [shape] = payload.shapes;
  assert.equal(shape.kind, "mesh");
  assert.equal(shape.name, "Clip");
  assert.equal(shape.importedMesh.sourceFormat, "stl");
  assert.equal(shape.importedMesh.triangleCount, 12);
  assert.equal(shape.importedMesh.positions.length, 12 * 9);
});

test("turns Z-up into Layerling's Y-up and centres the mesh on its own footprint", () => {
  // 30 wide (X), 20 deep (Y), 15 tall (Z), off the origin.
  const [shape] = layerlingShapes([{ name: "Block", stlBuffer: box([5, -40, 2], [35, -20, 17]) }]);
  assert.deepEqual([shape.width, shape.depth, shape.height], [30, 20, 15]);
  assert.deepEqual([shape.importedMesh.baseWidth, shape.importedMesh.baseDepth, shape.importedMesh.baseHeight], [30, 20, 15]);
  const p = shape.importedMesh.positions;
  const axis = (a) => p.filter((_, i) => i % 3 === a);
  assert.deepEqual([Math.min(...axis(0)), Math.max(...axis(0))], [-15, 15]);
  assert.deepEqual([Math.min(...axis(1)), Math.max(...axis(1))], [0, 15]);
  assert.deepEqual([Math.min(...axis(2)), Math.max(...axis(2))], [-10, 10]);
  // A lone body lands centred on the plate, standing on it.
  assert.deepEqual([shape.x, shape.z, shape.elevation], [0, 0, 0]);
});

test("keeps several bodies where they are relative to each other", () => {
  const [base, lid] = layerlingShapes([
    { name: "Base", stlBuffer: box([0, 0, 0], [40, 20, 10]) },
    // 40 mm further along X, 20 mm further back (+Y), sitting on top.
    { name: "Lid", stlBuffer: box([40, 20, 10], [60, 40, 12]) },
  ]);
  // Group spans X 0..60 (centre 30) and Y 0..40 -> Layerling Z -40..0 (centre -20).
  assert.deepEqual([base.x, base.z, base.elevation], [-10, 10, 0]);
  assert.deepEqual([lid.x, lid.z, lid.elevation], [20, -10, 10]);
  assert.notEqual(base.color, lid.color);
});

test("skips empty bodies and refuses a copy with nothing in it", () => {
  const shapes = layerlingShapes([
    { name: "Empty", stlBuffer: binaryStl([]) },
    { name: "Cube", stlBuffer: box([0, 0, 0], [5, 5, 5]) },
  ]);
  assert.deepEqual(shapes.map((s) => s.name), ["Cube"]);
  assert.throws(() => layerlingClipboardText([{ name: "Empty", stlBuffer: binaryStl([]) }]), /no geometry/);
});

test("keeps sub-millimetre bodies at Layerling's 1 mm minimum without rescaling", () => {
  const [shape] = layerlingShapes([{ name: "Shim", stlBuffer: box([0, 0, 0], [10, 10, 0.4]) }]);
  assert.equal(shape.height, 1);
  assert.equal(shape.importedMesh.baseHeight, 1);
  assert.equal(Math.max(...shape.importedMesh.positions.filter((_, i) => i % 3 === 1)), 0.4);
});
