import test from "node:test";
import assert from "node:assert/strict";

import {
  EDGE_ON_DEG,
  edgeOnToView,
  facingViewer,
  rayLinePoint,
  rayPlanePoint,
  screenAxisDelta,
} from "../../src/lib/dragMath.js";

const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const deg = (d) => (d * Math.PI) / 180;

test("a ray crossing a line meets it at the closest point", () => {
  // Camera above the X axis looking straight down at x = 7.
  const p = rayLinePoint([7, 0, 100], [0, 0, -1], [0, 0, 0], [1, 0, 0]);
  assert.ok(close(p, [7, 0, 0]));
  // A skew ray: the closest point on the line is under it.
  const q = rayLinePoint([3, 5, 10], [0, 0, -1], [0, 0, 0], [1, 0, 0]);
  assert.ok(close(q, [3, 0, 0]));
  // The line's direction may point either way.
  assert.ok(close(rayLinePoint([7, 0, 100], [0, 0, -2], [0, 0, 0], [-3, 0, 0]), [7, 0, 0]));
});

test("a line close to the ray's direction gives no point, not hundreds of mm", () => {
  // The height handle seen from almost straight above (Top view).
  const within = deg(EDGE_ON_DEG - 1);
  const ray = [Math.sin(within), 0, -Math.cos(within)];
  assert.equal(rayLinePoint([0, 0, 100], ray, [0, 0, 0], [0, 0, 1]), null);
  // Just outside the cone a point comes back: this ray, from 30 mm off
  // the axis, crosses it where plain trigonometry says.
  const outside = deg(EDGE_ON_DEG + 1);
  const ray2 = [Math.sin(outside), 0, -Math.cos(outside)];
  const p = rayLinePoint([-30, 0, 100], ray2, [0, 0, 0], [0, 0, 1]);
  const t = 30 / Math.sin(outside);
  assert.ok(close(p, [0, 0, 100 - Math.cos(outside) * t], 1e-6));
  // Exactly parallel, and degenerate directions.
  assert.equal(rayLinePoint([0, 0, 100], [0, 0, -1], [0, 0, 0], [0, 0, 1]), null);
  assert.equal(rayLinePoint([0, 0, 100], [0, 0, 0], [0, 0, 0], [1, 0, 0]), null);
  assert.equal(rayLinePoint([0, 0, NaN], [0, 0, -1], [0, 0, 0], [1, 0, 0]), null);
});

test("a line whose closest approach is behind the camera gives no point", () => {
  assert.equal(rayLinePoint([0, 0, 10], [0, 0, 1], [0, 0, 0], [1, 0, 0]), null);
});

test("a ray meets a plane where it crosses it", () => {
  const p = rayPlanePoint([10, 20, 50], [0, -1, -1], [0, 0, 0], [0, 0, 1]);
  assert.ok(close(p, [10, -30, 0]));
  // The normal's sign doesn't matter.
  assert.ok(close(rayPlanePoint([10, 20, 50], [0, -1, -1], [0, 0, 0], [0, 0, -5]), [10, -30, 0]));
});

test("a plane seen nearly edge-on, or behind the camera, gives no point", () => {
  const grazing = deg(EDGE_ON_DEG - 1);
  assert.equal(
    rayPlanePoint([0, 0, 1], [Math.cos(grazing), 0, -Math.sin(grazing)], [0, 0, 0], [0, 0, 1]),
    null,
  );
  assert.equal(rayPlanePoint([0, 0, 10], [0, 0, 1], [0, 0, 0], [0, 0, 1]), null);
  assert.equal(rayPlanePoint([0, 0, 10], [1, 0, 0], [0, 0, 0], [0, 0, 1]), null);
});

test("screen-space travel along a projected axis converts to mm at that axis's scale", () => {
  // 1 mm of the axis projects to 4 px to the right: 20 px right is 5 mm.
  assert.equal(screenAxisDelta([100, 100], [104, 100], [20, 0]), 5);
  // Travel across the axis counts for nothing; backwards is negative.
  assert.equal(screenAxisDelta([100, 100], [104, 100], [0, 30]), 0);
  assert.equal(screenAxisDelta([100, 100], [104, 100], [-8, 0]), -2);
  // A 10 mm segment that projects to 40 px is the same scale.
  assert.equal(screenAxisDelta([0, 0], [0, -40], [0, -20], 10), 5);
  // An axis that projects to a point has no direction to read.
  assert.equal(screenAxisDelta([5, 5], [5, 5], [10, 0]), null);
});

test("the fallback is no more sensitive than the drag was at the edge of the cone", () => {
  // The height axis 1° off the view ray, at a depth where 1 mm face-on is
  // 5 px: 1 mm of it projects to 5·sin 1° ≈ 0.087 px.
  const faceOn = 5;
  const at = (d) => faceOn * Math.sin(deg(d));
  // Without the floor, 50 px of travel reads as ~573 mm.
  assert.ok(screenAxisDelta([0, 0], [0, -at(1)], [0, -50]) > 500);
  // With it, the scale stops at the cone's edge: 50 / (5·sin 15°) ≈ 38.6 mm.
  const held = screenAxisDelta([0, 0], [0, -at(1)], [0, -50], 1, faceOn);
  assert.ok(Math.abs(held - 50 / at(EDGE_ON_DEG)) < 1e-6, String(held));
  // Exactly at the edge the two readings agree, so switching to the
  // fallback mid-drag doesn't jump; outside the cone the floor is inert.
  const edge = at(EDGE_ON_DEG);
  assert.ok(
    Math.abs(
      screenAxisDelta([0, 0], [0, -edge], [0, -50], 1, faceOn) -
        screenAxisDelta([0, 0], [0, -edge], [0, -50]),
    ) < 1e-9,
  );
  assert.equal(screenAxisDelta([100, 100], [104, 100], [20, 0], 1, 4), 5);
});

test("a handle faces the viewer when its outward direction points back at the camera", () => {
  const view = [0, 1, -0.5]; // looking along +Y and down
  assert.equal(facingViewer([0, -1, 0], view), true, "the -Y face is towards the camera");
  assert.equal(facingViewer([0, 1, 0], view), false);
  assert.equal(facingViewer([1, 0, 0], view), true, "side-on counts as facing");
});

test("edge-on matches the cone the intersections refuse", () => {
  const line = { type: "line", dir: [0, 0, 1] };
  const plane = { type: "plane", normal: [0, 0, 1] };
  const top = [0, 0, -1];
  const front = [0, 1, 0];
  assert.equal(edgeOnToView(line, top), true, "height handle from the Top view");
  assert.equal(edgeOnToView(line, front), false);
  assert.equal(edgeOnToView(plane, front), true, "a corner from the Front view");
  assert.equal(edgeOnToView(plane, top), false);
  const tilted = deg(EDGE_ON_DEG + 2);
  assert.equal(edgeOnToView(plane, [0, Math.cos(tilted), -Math.sin(tilted)]), false);
  assert.equal(edgeOnToView(line, [0, 0, 0]), true, "no view direction: hide");
});
