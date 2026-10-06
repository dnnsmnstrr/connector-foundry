import test from "node:test";
import assert from "node:assert/strict";

import { addChild, createAssembly } from "../../src/lib/assembly.js";
import { nodeWorldRotation, uprightSpin, worldAxis } from "../../src/lib/benchOrientation.js";

const parts = new Map([
  ["basics/plate", { id: "basics/plate", anchors: ["bot", "xpos", "xneg", "ypos", "yneg"] }],
  ["opengrid/openconnect", { id: "opengrid/openconnect", attached_up: [0, 1] }],
]);
const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const head = (a, parentId, slotName, spin) => addChild(a, { parentId, partId: "opengrid/openconnect", params: {}, slotName, spin });
const lastId = (a) => a.nodes[a.nodes.length - 1].id;

// Where an openConnect head's local +Y pointed in native renders of
// Bench-generated sources (measured 2026-10-06; see benchOrientation.js).
const MEASURED_ON_ROOT = [
  ["xpos", 0, [0, 1, 0]], ["xpos", 90, [0, 0, 1]],
  ["xneg", 0, [0, 1, 0]], ["xneg", 90, [0, 0, -1]],
  ["ypos", 0, [0, 0, -1]], ["ypos", 90, [-1, 0, 0]],
  ["yneg", 0, [0, 0, 1]], ["yneg", 90, [-1, 0, 0]],
];

test("the modelled rotation matches the renders on every side of the root", () => {
  for (const [slot, spin, expected] of MEASURED_ON_ROOT) {
    const a = head(createAssembly("basics/plate", {}), "root", slot, spin);
    const axis = worldAxis(nodeWorldRotation(a, parts, lastId(a)), [0, 1]);
    assert.ok(close(axis, expected), `${slot} at ${spin}°: ${axis} vs ${expected}`);
  }
});

test("...and on the side of a part stacked (so flipped) onto it", () => {
  // A plate on root's top slot, turned 0° or 90°, the head on ITS xpos.
  const measured = [
    [0, 0, [0, 1, 0]], [0, 90, [0, 0, -1]],
    [90, 0, [-1, 0, 0]], [90, 90, [0, 0, -1]],
  ];
  for (const [midSpin, spin, expected] of measured) {
    let a = addChild(createAssembly("basics/plate", {}), { parentId: "root", partId: "basics/plate", params: {}, slotName: "mount", spin: midSpin });
    a = head(a, lastId(a), "xpos", spin);
    const axis = worldAxis(nodeWorldRotation(a, parts, lastId(a)), [0, 1]);
    assert.ok(close(axis, expected), `mid ${midSpin}°, head ${spin}°: ${axis} vs ${expected}`);
  }
});

test("the upright spin points the axis straight up on any side face, and leaves a level slot alone", () => {
  const root = createAssembly("basics/plate", {});
  const expected = { xpos: 90, xneg: 270, ypos: 180, yneg: 0 };
  for (const [slot, spin] of Object.entries(expected)) {
    assert.equal(uprightSpin(root, parts, "root", slot, [0, 1]), spin, slot);
    const a = head(root, "root", slot, spin);
    assert.ok(close(worldAxis(nodeWorldRotation(a, parts, lastId(a)), [0, 1]), [0, 0, 1]), `${slot} points up`);
  }
  // On the flipped stacked plate too.
  let a = addChild(root, { parentId: "root", partId: "basics/plate", params: {}, slotName: "mount", spin: 90 });
  const mid = lastId(a);
  const spin = uprightSpin(a, parts, mid, "xpos", [0, 1]);
  a = head(a, mid, "xpos", spin);
  assert.ok(close(worldAxis(nodeWorldRotation(a, parts, lastId(a)), [0, 1]), [0, 0, 1]), `stacked: ${spin}`);
  // Top and bottom slots face up/down: every spin keeps the axis level.
  assert.equal(uprightSpin(root, parts, "root", "mount", [0, 1]), null);
  assert.equal(uprightSpin(root, parts, "root", "bot", [0, 1]), null);
  // A side-row slot ("xpos_<i>") is a side face like any other.
  assert.equal(uprightSpin(root, parts, "root", "xpos_1", [0, 1]), 90);
});
