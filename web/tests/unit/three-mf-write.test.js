import assert from "node:assert/strict";
import { test } from "node:test";
import * as fflate from "three/examples/jsm/libs/fflate.module.js";

import { looksLikeZip, modelUnitOf, unitScale } from "../../src/lib/threeMfMesh.js";
import { indexedFromStl, stlBodiesTo3mf, write3mf } from "../../src/lib/threeMfWrite.js";

// Binary STL of the given triangles ([[x,y,z] x3] each), laid out as
// OpenSCAD writes it: zero normals and attributes, vertices as float32.
function binaryStl(triangles) {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) => {
    triangle.flat().forEach((v, i) => view.setFloat32(84 + t * 50 + 12 + i * 4, v, true));
  });
  return buffer;
}

// Closed box from `min` to `max`: 12 triangles over 8 corners, every
// corner shared by at least three faces.
function box(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return binaryStl(
    quads.flatMap(([a, b, cc, d]) => [
      [c(a), c(b), c(cc)],
      [c(a), c(cc), c(d)],
    ]),
  );
}

// An n×n heightfield as a triangle soup: 2n² triangles over (n+1)²
// vertices, each interior vertex shared by six triangles, the shape of
// a real render's surface.
function heightfield(n) {
  const h = (i, j) => 5 * Math.sin(i / 3) * Math.cos(j / 3) + 10;
  const p = (i, j) => [i * 0.7, j * 0.7, h(i, j)];
  const triangles = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      triangles.push([p(i, j), p(i + 1, j), p(i + 1, j + 1)], [p(i, j), p(i + 1, j + 1), p(i, j + 1)]);
    }
  }
  return binaryStl(triangles);
}

const BOX = box([0, 0, 0], [10, 10, 4]);

function unzip(bytes) {
  const entries = fflate.unzipSync(bytes);
  const text = (name) => new TextDecoder().decode(entries[name]);
  return { names: Object.keys(entries), text };
}

const count = (text, pattern) => (text.match(new RegExp(pattern, "g")) ?? []).length;

test("a box STL welds to 8 vertices and 36 indices, exactly on the float bits", () => {
  const { vertices, indices } = indexedFromStl(BOX);
  assert.ok(vertices instanceof Float32Array);
  assert.ok(indices instanceof Uint32Array);
  assert.equal(vertices.length, 8 * 3);
  assert.equal(indices.length, 12 * 3);
  assert.ok(indices.every((i) => i < 8));
  // The corners, and nothing else.
  const corners = new Set();
  for (let v = 0; v < 8; v++) corners.add(`${vertices[3 * v]},${vertices[3 * v + 1]},${vertices[3 * v + 2]}`);
  assert.equal(corners.size, 8);
  for (const x of [0, 10])
    for (const y of [0, 10]) for (const z of [0, 4]) assert.ok(corners.has(`${x},${y},${z}`));
  // Each triangle reads back to the soup's own vertices, in order.
  const view = new DataView(BOX);
  for (let t = 0; t < 12; t++) {
    for (let corner = 0; corner < 3; corner++) {
      const index = indices[3 * t + corner];
      for (let k = 0; k < 3; k++) {
        assert.equal(vertices[3 * index + k], view.getFloat32(84 + 50 * t + 12 + 12 * corner + 4 * k, true));
      }
    }
  }
});

test("a view into a larger buffer is read at its offset, and an empty STL is an empty mesh", () => {
  const padded = new Uint8Array(BOX.byteLength + 16);
  padded.set(new Uint8Array(BOX), 8);
  const mesh = indexedFromStl(padded.subarray(8, 8 + BOX.byteLength));
  assert.equal(mesh.vertices.length, 24);
  assert.equal(mesh.indices.length, 36);
  const empty = indexedFromStl(binaryStl([]));
  assert.equal(empty.vertices.length, 0);
  assert.equal(empty.indices.length, 0);
});

test("a buffer shorter than its count says is refused", () => {
  assert.throws(() => indexedFromStl(new ArrayBuffer(50)), {
    name: "TypeError",
    message: /shorter than the 84-byte header/,
  });
  assert.throws(() => indexedFromStl(BOX.slice(0, BOX.byteLength - 1)), {
    name: "TypeError",
    message: /truncated: 12 triangles need 684 bytes, got 683/,
  });
});

test("write3mf() packs the three spec parts, one object per body, each placed once", () => {
  const bytes = write3mf([
    { name: "Base", ...indexedFromStl(BOX) },
    { name: "Lid", ...indexedFromStl(box([0, 0, 4], [10, 10, 6])) },
  ]);
  assert.ok(bytes instanceof Uint8Array);
  const { names, text } = unzip(bytes);
  assert.deepEqual(names, ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);

  const types = text("[Content_Types].xml");
  assert.match(types, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(types, /xmlns="http:\/\/schemas\.openxmlformats\.org\/package\/2006\/content-types"/);
  assert.match(
    types,
    /Extension="rels" ContentType="application\/vnd\.openxmlformats-package\.relationships\+xml"/,
  );
  assert.match(
    types,
    /Extension="model" ContentType="application\/vnd\.ms-package\.3dmanufacturing-3dmodel\+xml"/,
  );

  const rels = text("_rels/.rels");
  assert.match(rels, /xmlns="http:\/\/schemas\.openxmlformats\.org\/package\/2006\/relationships"/);
  assert.match(rels, /Id="rel0"/);
  assert.match(rels, /Target="\/3D\/3dmodel\.model"/);
  assert.match(rels, /Type="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/2013\/01\/3dmodel"/);

  const model = text("3D/3dmodel.model");
  assert.match(model, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(
    model,
    /<model unit="millimeter" xml:lang="en-US" xmlns="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/core\/2015\/02">/,
  );
  const objects = model.split("<object ").slice(1);
  assert.equal(objects.length, 2);
  assert.match(objects[0], /^id="1" name="Base" type="model">/);
  assert.match(objects[1], /^id="2" name="Lid" type="model">/);
  for (const object of objects) {
    assert.equal(count(object, "<vertex x="), 8);
    assert.equal(count(object, "<triangle v1="), 12);
    assert.match(
      object,
      /<mesh>\s*<vertices>[\s\S]*<\/vertices>\s*<triangles>[\s\S]*<\/triangles>\s*<\/mesh>\s*<\/object>/,
    );
  }
  assert.match(
    model,
    /<\/resources>\s*<build>\s*<item objectid="1"\/>\s*<item objectid="2"\/>\s*<\/build>\s*<\/model>\s*$/,
  );
  // The lid's vertices sit at z 4 and 6, the base's at 0 and 4.
  assert.equal(count(objects[1], 'z="6"'), 4);
  assert.equal(count(objects[1], 'z="4"'), 4);
  assert.equal(count(objects[0], 'z="0"'), 4);
  // A triangle's indices are the welded ones.
  const first = objects[0].match(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/);
  assert.ok(first);
  assert.ok(first.slice(1).every((i) => Number(i) < 8));
});

test("coordinates are written to a micron and never as -0", () => {
  const vertices = new Float32Array([1.00049, -0.0001, 2.5, 0.0005, 123.456789, -7]);
  const indices = new Uint32Array([0, 1, 1]);
  const model = unzip(write3mf([{ name: "p", vertices, indices }])).text("3D/3dmodel.model");
  assert.match(model, /<vertex x="1" y="0" z="2.5"\/>/);
  // 0.0005 in float32 is 0.000500000023..., which rounds up; -7 stays an integer.
  assert.match(model, /<vertex x="0.001" y="123.457" z="-7"\/>/);
  assert.doesNotMatch(model, /-0"/);
});

test("names are escaped for XML and stripped of control characters", () => {
  const mesh = indexedFromStl(BOX);
  const model = unzip(write3mf([{ name: "A & B <\"c'>\u0007\ttab", ...mesh }])).text("3D/3dmodel.model");
  assert.match(model, /name="A &amp; B &lt;&quot;c&apos;&gt;\ttab"/);
  assert.ok(!model.includes("\u0007"));
});

test("the validation refuses what a slicer could not print", () => {
  const mesh = indexedFromStl(BOX);
  assert.throws(() => write3mf([]), { name: "RangeError", message: /Nothing to print/ });
  assert.throws(() => write3mf(/** @type {any} */ (null)), {
    name: "RangeError",
    message: /Nothing to print/,
  });
  assert.throws(() => write3mf([{ name: /** @type {any} */ (42), ...mesh }]), {
    name: "TypeError",
    message: /name must be a string/,
  });
  const nan = { name: "nan", vertices: Float32Array.from(mesh.vertices), indices: mesh.indices };
  nan.vertices[4] = NaN;
  assert.throws(() => write3mf([nan]), {
    name: "RangeError",
    message: /vertex 1 has a non-finite coordinate/,
  });
  const inf = { name: "inf", vertices: Float32Array.from(mesh.vertices), indices: mesh.indices };
  inf.vertices[0] = Infinity;
  assert.throws(() => write3mf([inf]), { name: "RangeError", message: /non-finite/ });
  const out = { name: "out", vertices: mesh.vertices, indices: Uint32Array.from(mesh.indices) };
  out.indices[7] = 8;
  assert.throws(() => write3mf([out]), { name: "RangeError", message: /triangle 2 refers to vertex 8 of 8/ });
  const ragged = { name: "ragged", vertices: mesh.vertices, indices: mesh.indices.subarray(0, 35) };
  assert.throws(() => write3mf([ragged]), {
    name: "RangeError",
    message: /35 indices is not a whole number of triangles/,
  });
  assert.throws(
    () => write3mf([{ name: "plain", vertices: /** @type {any} */ ([0, 0, 0]), indices: mesh.indices }]),
    {
      name: "TypeError",
      message: /Float32Array/,
    },
  );
  // The second body is checked too, and the message says which.
  assert.throws(
    () =>
      write3mf([
        { name: "ok", ...mesh },
        { ...ragged, name: "second" },
      ]),
    /body 2 \("second"\)/,
  );
  // Nothing bad above was written: the good case still does.
  assert.ok(write3mf([{ name: "ok", ...mesh }]).length > 0);
});

test("the app's own 3MF reader opens the file and finds it in millimetres", () => {
  const bytes = stlBodiesTo3mf([{ name: "Box", stl: BOX }]);
  assert.equal(looksLikeZip(bytes), true);
  const unit = modelUnitOf(bytes);
  assert.equal(unit, "millimeter");
  assert.equal(unitScale(unit), 1);
  // (ThreeMFLoader itself needs the browser's DOMParser; app.spec.js
  // covers the loader end to end.)
});

test("stlBodiesTo3mf() is write3mf() over indexedFromStl(), body for body", () => {
  const bodies = [
    { name: "Base", stl: BOX },
    { name: "Lid", stl: new Uint8Array(box([0, 0, 4], [10, 10, 6])) },
  ];
  const direct = unzip(write3mf(bodies.map(({ name, stl }) => ({ name, ...indexedFromStl(stl) }))));
  const convenience = unzip(stlBodiesTo3mf(bodies));
  assert.equal(convenience.text("3D/3dmodel.model"), direct.text("3D/3dmodel.model"));
  assert.throws(() => stlBodiesTo3mf([]), /Nothing to print/);
  assert.throws(() => stlBodiesTo3mf(/** @type {any} */ ({})), { name: "TypeError" });
});

test("a welded 3MF is far smaller than the STL it came from", () => {
  const stl = heightfield(12); // 288 triangles, 169 vertices
  const mesh = indexedFromStl(stl);
  assert.equal(mesh.indices.length, 288 * 3);
  assert.equal(mesh.vertices.length, 169 * 3);
  const bytes = write3mf([{ name: "surface", ...mesh }]);
  // Measured at 0.26 of the STL here and 0.18 at 200k triangles; the
  // bound leaves room for a different fflate without hiding a regression
  // to an unwelded or uncompressed file (3.6× and 1.2× the STL).
  assert.ok(bytes.length * 2 < stl.byteLength, `${bytes.length} B of 3MF for ${stl.byteLength} B of STL`);
});
