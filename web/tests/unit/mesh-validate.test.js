import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";

import { validateAndRepair } from "../../src/lib/meshValidate.js";

// A box as an STL arrives: a triangle soup with no shared vertices.
const soupBox = () => new BoxGeometry(20, 10, 4).toNonIndexed();

function withoutTriangle(geometry, t) {
  const p = geometry.attributes.position.array;
  const kept = [...p.slice(0, 9 * t), ...p.slice(9 * (t + 1))];
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(kept, 3));
  return out;
}

function reversed(geometry, triangles) {
  const p = geometry.attributes.position;
  for (const t of triangles) {
    const a = 3 * t + 1,
      b = 3 * t + 2;
    const x = p.getX(a),
      y = p.getY(a),
      z = p.getZ(a);
    p.setXYZ(a, p.getX(b), p.getY(b), p.getZ(b));
    p.setXYZ(b, x, y, z);
  }
  return geometry;
}

test("a clean box passes untouched", () => {
  const { ok, report, extents, center } = validateAndRepair(soupBox());
  assert.equal(ok, true);
  assert.match(report.join(" "), /Clean/);
  assert.deepEqual(extents, [20, 10, 4]);
  assert.deepEqual(center, [0, 0, 0]);
});

test("a missing triangle is a real hole: open edges, refused", () => {
  const { ok, report } = validateAndRepair(withoutTriangle(soupBox(), 0));
  assert.equal(ok, false);
  assert.match(report.join(" "), /3 open edge/);
});

test("mixed winding is repaired and passes", () => {
  const { ok, report } = validateAndRepair(reversed(soupBox(), [0, 3, 7]));
  assert.equal(ok, true, report.join(" "));
  // Which side counts as "flipped" depends on the seed triangle the
  // repair grows from, so only that it happened is fixed.
  assert.match(report.join(" "), /Fixed winding direction/);
  assert.match(report.join(" "), /Passed after repair/);
});

test("an inside-out box is turned to face outward", () => {
  const box = soupBox();
  const { ok, report } = validateAndRepair(
    reversed(box, [...Array(box.attributes.position.count / 3).keys()]),
  );
  assert.equal(ok, true, report.join(" "));
  assert.match(report.join(" "), /inside-out/);
});

test("an empty mesh is refused, with a size of nothing rather than -Infinity", () => {
  const empty = new BufferGeometry();
  empty.setAttribute("position", new Float32BufferAttribute([], 3));
  const { ok, report, extents, center } = validateAndRepair(empty);
  assert.equal(ok, false);
  assert.match(report.join(" "), /No solid geometry/);
  assert.deepEqual(extents, [0, 0, 0]);
  assert.deepEqual(center, [0, 0, 0]);
});
