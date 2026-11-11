import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { weldVertices } from "../../src/lib/meshWeld.js";
import { cubeStl } from "./bench-fixtures.js";

// weldVertices() is mergeVertices() done faster: every test here holds
// its result to three's, to the bit.

// A repeatable stand-in for Math.random().
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function positionOnly(values) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(values), 3));
  return geometry;
}

// Triangles over `points` lattice points jittered by up to `jitter`: with
// a jitter near the tolerance, neighbours fall in the same cell or the
// next one, on both sides of zero.
function soup(triangles, points, jitter, random) {
  const lattice = Array.from({ length: points }, () => [
    Math.round((random() - 0.5) * 200) / 10,
    Math.round((random() - 0.5) * 200) / 10,
    Math.round((random() - 0.5) * 200) / 10,
  ]);
  const values = [];
  for (let i = 0; i < triangles * 3; i++) {
    const p = lattice[Math.floor(random() * points)];
    for (const c of p) values.push(c + (random() - 0.5) * 2 * jitter);
  }
  return positionOnly(values);
}

function assertSameArray(actual, expected, what) {
  assert.equal(actual.constructor, expected.constructor, `${what}: array type`);
  assert.equal(actual.length, expected.length, `${what}: length`);
  for (let i = 0; i < expected.length; i++) {
    if (!Object.is(actual[i], expected[i]))
      assert.fail(`${what}: [${i}] is ${actual[i]}, not ${expected[i]}`);
  }
}

function assertSameWeld(geometry, tolerance) {
  const expected = mergeVertices(geometry, tolerance);
  const actual = weldVertices(geometry, tolerance);
  assert.deepEqual(Object.keys(actual.attributes), Object.keys(expected.attributes));
  for (const name of Object.keys(expected.attributes)) {
    const a = actual.attributes[name];
    const e = expected.attributes[name];
    assert.equal(a.constructor, e.constructor, `${name}: attribute class`);
    assert.equal(a.itemSize, e.itemSize);
    assert.equal(a.normalized, e.normalized);
    assertSameArray(a.array, e.array, name);
  }
  assert.equal(actual.index.constructor, expected.index.constructor, "index: attribute class");
  assertSameArray(actual.index.array, expected.index.array, "index");
  assert.deepEqual(actual.groups, expected.groups);
  assert.deepEqual(actual.userData, expected.userData);
  assert.deepEqual(actual.boundingBox, expected.boundingBox);
  return actual;
}

test("a cube's 36 corners weld to 8, as mergeVertices welds them", () => {
  const parsed = new STLLoader().parse(cubeStl());
  const cube = new THREE.BufferGeometry();
  cube.setAttribute("position", parsed.getAttribute("position"));
  for (const tolerance of [1e-3, 1e-4, 1]) {
    const welded = assertSameWeld(cube, tolerance);
    assert.equal(welded.attributes.position.count, tolerance === 1 ? welded.attributes.position.count : 8);
    assert.ok(welded.index.array instanceof Uint16Array);
  }
  // The source is left as it was: still a soup.
  assert.equal(cube.getIndex(), null);
  assert.equal(cube.attributes.position.count, 36);
});

test("jittered soups weld the same at every tolerance, either side of zero", () => {
  const random = seeded(7);
  for (const [tolerance, jitter] of [
    [1e-3, 0],
    [1e-3, 4e-4],
    [1e-3, 2e-3],
    [1e-4, 6e-5],
    [0.5, 0.3],
    [0, 0],
  ]) {
    assertSameWeld(soup(4000, 900, jitter, random), tolerance);
  }
});

test("past 65535 vertices the index is 32 bits wide, as three's is", () => {
  const random = seeded(11);
  const values = Array.from({ length: 70000 * 3 }, () => (random() - 0.5) * 500);
  const welded = assertSameWeld(positionOnly(values.slice(0, 69999 * 3)), 1e-3);
  assert.ok(welded.index.array instanceof Uint32Array);
  assert.ok(welded.attributes.position.count > 65535);
});

test("odd values land where mergeVertices puts them", () => {
  // NaN and the infinities truncate to cell 0, as `~~` has them; -0 and
  // values past 32 bits of cells wrap the same way in both.
  assertSameWeld(
    positionOnly([NaN, 0, 0, 0, 0, 0, Infinity, -Infinity, 1, -0, 0, 0, 3e9, -3e9, 5e6, 3e9, -3e9, 5e6]),
    1e-3,
  );
  assertSameWeld(positionOnly([]), 1e-3);
});

test("an indexed geometry, and one with a Float32BufferAttribute, weld the same", () => {
  const random = seeded(3);
  const geometry = soup(300, 60, 0, random);
  geometry.setIndex(Array.from({ length: 600 }, () => Math.floor(random() * 900)));
  geometry.addGroup(0, 300, 0);
  geometry.userData.name = "kept";
  geometry.computeBoundingBox();
  assertSameWeld(geometry, 1e-3);

  const typed = new THREE.BufferGeometry();
  typed.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0], 3));
  const welded = assertSameWeld(typed, 1e-3);
  assert.ok(welded.attributes.position instanceof THREE.Float32BufferAttribute);
});

test("a geometry with more than positions goes to mergeVertices, which hashes them all", () => {
  const parsed = new STLLoader().parse(cubeStl());
  // Positions and facet normals: corners of different faces do not merge.
  const welded = assertSameWeld(parsed, 1e-3);
  assert.equal(welded.attributes.position.count, 24);
  assert.ok(welded.attributes.normal);

  const normalized = new THREE.BufferGeometry();
  normalized.setAttribute(
    "position",
    new THREE.BufferAttribute(new Int16Array([0, 0, 0, 100, 0, 0, 0, 0, 0]), 3, true),
  );
  assertSameWeld(normalized, 1e-3);
});
