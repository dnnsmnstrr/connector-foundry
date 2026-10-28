import test from "node:test";
import assert from "node:assert/strict";

import {
  DIAL_REACH,
  DIAL_SNAP_DEG,
  dialSegments,
  dialStep,
  planeAngle,
  rotateAbout,
  snapTurn,
  unwrapAngle,
} from "../../src/lib/rotateDial.js";

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test("planeAngle: right-handed about the axis, projected onto the plane", () => {
  const c = [1, 2, 3];
  // Looking down +Z, +X to +Y is a quarter turn counter-clockwise.
  assert.equal(planeAngle(c, [0, 0, 1], [2, 2, 3], [1, 3, 3]), 90);
  assert.equal(planeAngle(c, [0, 0, -1], [2, 2, 3], [1, 3, 3]), -90);
  // Height off the plane doesn't count; neither does the axis's length.
  assert.equal(Math.round(planeAngle(c, [0, 0, 5], [2, 2, 9], [0, 2, -4])), 180);
  // On the centre there is no angle.
  assert.equal(planeAngle(c, [0, 0, 1], c, [2, 2, 3]), null);
});

test("unwrapAngle carries a turn past ±180°", () => {
  let total = 0;
  for (const raw of [60, 120, 170, -170, -100, -10, 30]) total = unwrapAngle(total, raw);
  assert.equal(total, 390);
  assert.equal(unwrapAngle(0, -30), -30);
  assert.equal(unwrapAngle(-170, 170), -190);
});

test("on the dial a turn snaps to its ticks, off it to whole degrees, to absolute angles", () => {
  assert.equal(dialStep(10, 10), DIAL_SNAP_DEG);
  assert.equal(dialStep(10 * DIAL_REACH, 10), DIAL_SNAP_DEG);
  assert.equal(dialStep(10 * DIAL_REACH + 0.01, 10), 1);
  // From 37°, the nearest tick is 45°: a turn of 8, not 15.
  assert.equal(snapTurn(37, 10, 15), 8);
  assert.equal(snapTurn(0, 22, 15), 15);
  assert.equal(snapTurn(0, -7, 15), 0);
  assert.ok(Object.is(snapTurn(0, -7, 15), 0));
  assert.equal(snapTurn(37.5, 2.2, 1), 2.5);
});

test("rotateAbout turns a point round a line through the centre", () => {
  assert.ok(close(rotateAbout([2, 0, 5], [1, 0, 0], [0, 0, 1], 90), [1, 1, 5]));
  assert.ok(close(rotateAbout([0, 1, 0], [0, 0, 0], [1, 0, 0], 90), [0, 0, 1]));
  // Agrees with planeAngle's sense.
  const p = rotateAbout([3, 0, 0], [0, 0, 0], [1, 1, 1], 40);
  assert.ok(Math.abs(planeAngle([0, 0, 0], [1, 1, 1], [3, 0, 0], p) - 40) < 1e-9);
});

test("dialSegments: a ring in the plane, ticks at absolute angles, two spokes", () => {
  const dial = { center: [0, 0, 5], axis: [0, 0, 1], radius: 10, base: 30 };
  const segments = dialSegments(dial, [20, 0, 5], 45);
  // 96 ring pieces, 24 ticks, the start and the current spoke.
  assert.equal(segments.length, 96 + 24 + 2);
  for (const [a, b] of segments) assert.ok(a[2] === 5 && b[2] === 5);
  const ring = segments.slice(0, 96);
  for (const [a] of ring) assert.ok(Math.abs(Math.hypot(a[0], a[1]) - 10) < 1e-9);
  // Absolute 0° is 30° back from the start spoke (+X), and is a long tick.
  const zero = segments[96];
  const at = (deg, r) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), 5];
  assert.ok(close(zero[0], at(-30, 10)) && close(zero[1], at(-30, 12.2)));
  const [start, now] = segments.slice(-2);
  assert.ok(close(start[0], [0, 0, 5]) && close(start[1], [10, 0, 5]));
  assert.ok(close(now[1], at(45, 10 * DIAL_REACH)));
  // No start direction to count from: nothing to draw.
  assert.deepEqual(dialSegments(dial, [0, 0, 9], 0), []);
});
