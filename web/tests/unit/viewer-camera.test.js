import test from "node:test";
import assert from "node:assert/strict";

import {
  VIEW_PRESETS,
  boxCenter,
  clipPlanes,
  dollyOutDistance,
  dollyToFit,
  fitView,
  grabOffset,
  handlesGrew,
  inReach,
  modelRadius,
  presetView,
  projectToNdc,
  refitMode,
  viewBasis,
} from "../../src/lib/viewerCamera.js";

const close = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const box = { min: [-20, -10, 0], max: [20, 10, 8] };
const view = (pose, aspect = 1.5) => ({ ...pose, fovDeg: 45, aspect });
const corners = (b) =>
  [b.min[0], b.max[0]].flatMap((x) =>
    [b.min[1], b.max[1]].flatMap((y) => [b.min[2], b.max[2]].map((z) => [x, y, z])),
  );
const maxNdc = (b, v) =>
  Math.max(
    ...corners(b).map((c) => {
      const [x, y] = projectToNdc(c, v);
      return Math.max(Math.abs(x), Math.abs(y));
    }),
  );

test("Home is the framing a new model always got", () => {
  // 1.6 radii out along +X, -Y and +Z, the radius being the largest side.
  const { target, position } = presetView("home", box);
  assert.deepEqual(target, [0, 0, 4]);
  assert.ok(close(position, [64, -64, 68]));
  assert.equal(modelRadius(box), 40);
  assert.deepEqual(clipPlanes(40), { near: 0.4, far: 800 });
  // A flat or empty model still gets a usable radius.
  assert.equal(modelRadius({ min: [0, 0, 0], max: [0, 0, 0] }), 1);
});

test("Top, Front and Right look along the axes from Home's distance", () => {
  const home = presetView("home", box);
  const distance = (p) => Math.hypot(...p.position.map((v, i) => v - p.target[i]));
  for (const { id } of VIEW_PRESETS) {
    const pose = presetView(id, box);
    assert.ok(Math.abs(distance(pose) - distance(home)) < 1e-9, id);
    assert.deepEqual(pose.target, boxCenter(box));
  }
  // Top: +Y at the top of the screen, +X to the right, looking down.
  const top = viewBasis(presetView("top", box).position, boxCenter(box));
  assert.ok(close(top.right, [1, 0, 0], 1e-3));
  assert.ok(close(top.up, [0, 1, 0], 1e-2));
  assert.ok(top.back[2] > 0.999);
  // ...but not exactly down the Z axis, where OrbitControls has no azimuth.
  assert.ok(Math.abs(top.back[1]) > 1e-6);
  // Front from -Y with +X right; Right from +X with +Y right; Z up in both.
  const front = viewBasis(presetView("front", box).position, boxCenter(box));
  assert.ok(close(front.right, [1, 0, 0]) && close(front.up, [0, 0, 1]));
  const right = viewBasis(presetView("right", box).position, boxCenter(box));
  assert.ok(close(right.right, [0, 1, 0]) && close(right.up, [0, 0, 1]));
});

test("Fit keeps the viewing direction and fills the view to its margin", () => {
  const position = [300, -120, 90];
  const target = [50, 40, 0];
  const pose = fitView({ box, position, target, fovDeg: 45, aspect: 1.5, margin: 0.8 });
  assert.deepEqual(pose.target, boxCenter(box));
  const before = viewBasis(position, target).back;
  const after = viewBasis(pose.position, pose.target).back;
  assert.ok(close(before, after));
  // The box touches the margin and stays inside it.
  assert.ok(Math.abs(maxNdc(box, view(pose)) - 0.8) < 1e-6);
  // A camera sitting on its target falls back to Home's direction.
  const stuck = fitView({ box, position: [0, 0, 4], target: [0, 0, 4], fovDeg: 45, aspect: 1 });
  assert.ok(Number.isFinite(stuck.position[0]));
});

test("a grown model backs the camera out along its direction; a shrunk one keeps it", () => {
  const pose = { target: [0, 0, 4], position: [60, -60, 64] };
  // Fits already: nothing to do.
  assert.equal(dollyToFit({ box, ...pose, fovDeg: 45, aspect: 1.5 }), null);
  // Five times as wide: back out, same direction and target, just inside 0.95.
  const grown = { min: [-100, -10, 0], max: [100, 10, 8] };
  const moved = dollyToFit({ box: grown, ...pose, fovDeg: 45, aspect: 1.5 });
  assert.ok(moved);
  assert.ok(close(viewBasis(moved, pose.target).back, viewBasis(pose.position, pose.target).back));
  assert.ok(Math.hypot(...moved) > Math.hypot(...pose.position));
  assert.ok(Math.abs(maxNdc(grown, view({ position: moved, target: pose.target })) - 0.95) < 1e-6);
  // A smaller model never pulls the camera in.
  const shrunk = { min: [-2, -2, 0], max: [2, 2, 1] };
  assert.equal(dollyToFit({ box: shrunk, ...pose, fovDeg: 45, aspect: 1.5 }), null);
});

test("fitKey decides between a full re-fit and keeping the view", () => {
  const previous = { key: "basics/plate", center: [0, 0, 4], radius: 40 };
  assert.equal(refitMode(null, "basics/plate", [0, 0, 4], 40), "fit");
  assert.equal(refitMode(previous, "basics/plate", [0, 0, 30], 200), "contain");
  assert.equal(refitMode(previous, "basics/post", [0, 0, 4], 40), "fit");
  // Without a fitKey, the old 2% rule.
  const legacy = { key: undefined, center: [0, 0, 4], radius: 40 };
  assert.equal(refitMode(legacy, undefined, [0.5, 0, 4], 40.5), "keep");
  assert.equal(refitMode(legacy, undefined, [0, 0, 4], 44), "fit");
  assert.equal(refitMode(previous, undefined, [0, 0, 4], 40), "fit");
});

test("Fit never puts the camera inside a flat part, and points behind the camera say so", () => {
  // A thin plate seen exactly edge-on fills the view at almost no
  // distance; the camera stays at least the part's own size away.
  const plate = { min: [-50, -50, 0], max: [50, 50, 0.2] };
  const pose = fitView({ box: plate, position: [0, -500, 0.1], target: [0, 0, 0.1], fovDeg: 45, aspect: 1 });
  assert.ok(Math.hypot(...pose.position.map((v, i) => v - pose.target[i])) >= modelRadius(plate) - 1e-9);
  // projectToNdc's depth goes negative behind the camera.
  const v = { position: [0, -100, 0], target: [0, 0, 0], fovDeg: 45, aspect: 1 };
  assert.ok(projectToNdc([0, 50, 0], v)[2] > 0);
  assert.ok(projectToNdc([0, -150, 0], v)[2] < 0);
  // A camera on its own target has no view to project through.
  assert.equal(projectToNdc([1, 2, 3], { ...v, position: [0, 0, 0] }), null);
});

test("an unknown view name is Home, and a caller that starts passing a fitKey re-fits once", () => {
  assert.deepEqual(presetView(/** @type {any} */ ("isometric"), box), presetView("home", box));
  const legacy = { key: undefined, center: [0, 0, 4], radius: 40 };
  assert.equal(refitMode(legacy, "basics/plate", [0, 0, 4], 40), "fit");
  const keyed = { key: "basics/plate", center: [0, 0, 4], radius: 40 };
  assert.equal(refitMode(keyed, "basics/plate", [0, 0, 4], 40), "contain");
});

test("a grab target sits out past its point, and past the side of the body it stands on", () => {
  // 12 px out along the projected direction.
  assert.deepEqual(grabOffset([100, 100], [110, 100], null, 12), [12, 0]);
  // Looking down on a tall part: its top rim projects 30 px further out
  // than the bottom edge, so the target goes 30 + 12 px out.
  assert.deepEqual(grabOffset([100, 100], [100, 90], [100, 70], 12), [0, -42]);
  // A side that runs back in, or across, on screen (the usual view from
  // above at an angle) moves nothing.
  assert.deepEqual(grabOffset([100, 100], [110, 100], [95, 60], 12), [12, 0]);
  // A direction pointing at the camera has no way to go: on the point.
  assert.deepEqual(grabOffset([100, 100], [100.2, 100], [140, 100], 12), [0, 0]);
  assert.deepEqual(grabOffset([100, 100], null, null, 12), [0, 0]);
});

test("a grab target is in reach inside the view and clear of the chrome over it", () => {
  const view = { width: 400, height: 300, obstacles: [[300, 10, 390, 40]], gap: 2 };
  assert.ok(inReach([200, 150], 10, view));
  // Its hit area, not just its centre, has to be inside.
  assert.ok(!inReach([392, 150], 10, view));
  assert.ok(!inReach([200, 8], 10, view));
  // Under (or touching, with the gap) a toolbar button.
  assert.ok(!inReach([320, 30], 10, view));
  assert.ok(!inReach([289, 30], 10, view));
  assert.ok(inReach([288, 30], 10, view));
  assert.ok(inReach([320, 53], 10, view));
});

test("handles grew when the same subject's points reach past the old ones", () => {
  const at = (id, point) => ({ id, point });
  const before = [at("x+", [20, 0, 0]), at("x-", [-20, 0, 0]), at("z+", [0, 0, 8])];
  // Wider, or taller: grown.
  assert.ok(handlesGrew(before, [at("x+", [41, 0, 0]), at("x-", [-41, 0, 0]), at("z+", [0, 0, 8])]));
  assert.ok(handlesGrew([before[2]], [at("z+", [0, 0, 15])]));
  // Narrower, the same size again (a landed render), float noise: not.
  assert.ok(!handlesGrew(before, [at("x+", [10, 0, 0]), at("x-", [-10, 0, 0]), at("z+", [0, 0, 8])]));
  assert.ok(
    !handlesGrew(
      before,
      before.map((h) =>
        at(
          h.id,
          h.point.map((v) => v + 0.001),
        ),
      ),
    ),
  );
  // Handles with no id in common are a new selection, wherever they are.
  assert.ok(!handlesGrew(before, [at("xy:x+", [90, 0, 0])]));
  assert.ok(!handlesGrew([], before));
});

test("the camera backs out just far enough, and never closer", () => {
  // Fits from 230 on.
  const fits = (d) => d >= 230;
  const d = dollyOutDistance(fits, 100);
  assert.ok(d >= 230 && d < 230 + 100 * 0.005 + 1e-9, String(d));
  // Already fits, or nothing within 8× does: stay.
  assert.equal(dollyOutDistance(fits, 300), null);
  assert.equal(
    dollyOutDistance(() => false, 100),
    null,
  );
  assert.equal(dollyOutDistance(fits, 0), null);
  // Every distance it tries is past the current one.
  const tried = [];
  dollyOutDistance((x) => (tried.push(x), x > 150), 100);
  assert.ok(tried.every((x) => x >= 100));
});
