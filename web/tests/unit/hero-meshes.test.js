import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { decodeMeshes, encodeMeshes, indexStl } from "../../src/site/heroMeshes.js";
import { HERO_PAIRS, meshNames } from "../../src/site/heroPairs.js";

// A binary STL of these triangles, each three [x, y, z] corners.
function binaryStl(triangles) {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) =>
    triangle.forEach((corner, c) =>
      corner.forEach((value, axis) => view.setFloat32(84 + t * 50 + 12 + c * 12 + axis * 4, value, true)),
    ),
  );
  return bytes;
}

function arrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("an STL's shared corners are stored once", () => {
  const { positions, indices } = indexStl(
    binaryStl([
      [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
      ],
      [
        [0, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
      ],
    ]),
  );
  assert.equal(positions.length, 4 * 3);
  assert.deepEqual([...indices], [0, 1, 2, 0, 2, 3]);
});

test("a cut-short STL is refused", () => {
  const bytes = binaryStl([
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  ]);
  assert.throws(() => indexStl(bytes.slice(0, 100)), /Truncated/);
});

test("meshes come back from the file within a micrometre", () => {
  // Corners spread over 60 mm, the size of the largest hero part.
  const positions = new Float32Array(300).map((_, i) => ((i * 7919) % 6000) / 100 - (i % 3 === 2 ? 0 : 30));
  const indices = new Uint32Array(Array.from({ length: 99 }, (_, i) => i % 100));
  const flat = new Float32Array([5, 5, 5, 5, 5, 5, 5, 5, 5]);
  const meshes = decodeMeshes(
    arrayBuffer(
      encodeMeshes([
        { name: "pair/base", positions, indices },
        // A mesh flat in every axis: no span to quantise across.
        { name: "pair/attached", positions: flat, indices: new Uint32Array([0, 1, 2]) },
      ]),
    ),
  );
  const base = meshes.get("pair/base");
  assert.ok(base);
  assert.ok(base.indices instanceof Uint16Array, "under 65536 vertices: 16-bit indices");
  assert.deepEqual([...base.indices], [...indices]);
  const worst = Math.max(...positions.map((value, i) => Math.abs(value - base.positions[i])));
  assert.ok(worst < 0.001, `worst error ${worst} mm`);
  assert.deepEqual([...meshes.get("pair/attached").positions], [...flat]);
});

test("a mesh past 65535 vertices keeps 32-bit indices", () => {
  const count = 70000;
  const positions = new Float32Array(count * 3).map((_, i) => i % 97);
  const indices = new Uint32Array([0, count - 1, 12345]);
  const [mesh] = decodeMeshes(arrayBuffer(encodeMeshes([{ name: "big", positions, indices }]))).values();
  assert.ok(mesh.indices instanceof Uint32Array);
  assert.deepEqual([...mesh.indices], [...indices]);
});

test("a file that is not a hero mesh file is refused", () => {
  assert.throws(() => decodeMeshes(new ArrayBuffer(16)), /Not a hero mesh file/);
});

// The committed meshes against the pair list: run scripts/hero-parts.mjs
// after changing heroPairs.js, or this fails.
test("hero-parts.bin has every pair, the attached part on its base's top slot", () => {
  const bytes = fs.readFileSync(new URL("../../src/site/assets/hero-parts.bin", import.meta.url));
  const meshes = decodeMeshes(arrayBuffer(bytes));
  // The mesh's extent along one axis (0 = X, 1 = Y, 2 = Z).
  const range = (mesh, axis) => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < mesh.positions.length; i += 3) {
      min = Math.min(min, mesh.positions[i]);
      max = Math.max(max, mesh.positions[i]);
    }
    return { min, max };
  };
  for (const pair of HERO_PAIRS) {
    const names = meshNames(pair);
    const base = meshes.get(names.base);
    const attached = meshes.get(names.attached);
    assert.ok(base && attached, `${pair.key} is in hero-parts.bin`);
    assert.ok(base.indices.length > 0 && attached.indices.length > 0, pair.key);
    // Every hero base has its "mount" slot on its top face, so attach()
    // puts the attached part's underside exactly there.
    assert.ok(Math.abs(range(attached, 2).min - range(base, 2).max) < 0.01, `${pair.key} sits on its base`);
    // A mount on something, never a plate balanced on a peg: the attached
    // part stays within its base's footprint (heroPairs.js).
    for (const axis of [0, 1]) {
      const on = range(base, axis);
      const top = range(attached, axis);
      assert.ok(
        top.min >= on.min - 0.5 && top.max <= on.max + 0.5,
        `${pair.key}: ${pair.attached.part} reaches past ${pair.base.part} along ${"XY"[axis]}`,
      );
    }
  }
  const expected = new Set(HERO_PAIRS.flatMap((pair) => Object.values(meshNames(pair))));
  assert.deepEqual([...meshes.keys()].sort(), [...expected].sort(), "no meshes for pairs that are gone");
});
