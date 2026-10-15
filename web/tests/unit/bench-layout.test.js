import test from "node:test";
import assert from "node:assert/strict";

import {
  centeredToWorld,
  exposedTopWorldPosition,
  rootSlots,
  sceneMarkers,
} from "../../src/lib/benchLayout.js";
import { nodeWorldBox } from "../../src/lib/benchPick.js";

function markersFor(openRootSlots) {
  return sceneMarkers({
    assembly: { nodes: [] },
    partsById: new Map(),
    openRootSlots,
    rootExtents: [30, 10, 4],
    rootSlotWorldPositions: new Map(),
    nodeExtents: new Map(),
  });
}

test("sceneMarkers makes a unique center slot slightly larger", () => {
  const markers = markersFor([
    { name: "left", point: [-10, 0, 2] },
    { name: "center", point: [0, 0, 2] },
    { name: "right", point: [10, 0, 2] },
  ]);

  assert.equal(markers.find((marker) => marker.id.endsWith("::center")).radius, 3.2);
  assert.equal(markers.find((marker) => marker.id.endsWith("::left")).radius, undefined);
  assert.equal(markers.find((marker) => marker.id.endsWith("::right")).radius, undefined);
});

test("sceneMarkers keeps a single or even set of slots the same size", () => {
  assert.equal(markersFor([{ name: "only", point: [0, 0, 2] }])[0].radius, undefined);

  const evenMarkers = markersFor([
    { name: "left", point: [-5, 0, 2] },
    { name: "right", point: [5, 0, 2] },
  ]);
  assert.deepEqual(
    evenMarkers.map((marker) => marker.radius),
    [undefined, undefined],
  );
});

// A 40×40×4 plate with a top "mount", a "bot" and an "xpos" face anchor,
// as root and as every child, all fused through their own "mount".
const plate = { id: "basics/plate", name: "Plate", anchors: ["bot", "xpos"], defaults: {} };
const plateParts = new Map([[plate.id, plate]]);
const PLATE = [40, 40, 4];

function plateScene(nodes) {
  const assembly = {
    root: { id: "root", partId: plate.id, params: {} },
    nodes: nodes.map((n) => ({
      partId: plate.id,
      params: {},
      joint: "fused",
      childAnchor: "mount",
      overlap: 0,
      spin: 0,
      shift: [0, 0],
      ...n,
    })),
  };
  const rootSlotWorldPositions = new Map(
    rootSlots(plate, {}, PLATE).map((s) => [s.name, centeredToWorld(s.point, PLATE)]),
  );
  const nodeExtents = new Map([["root", PLATE], ...assembly.nodes.map((n) => [n.id, PLATE])]);
  const markers = sceneMarkers({
    assembly,
    partsById: plateParts,
    openRootSlots: [],
    rootExtents: PLATE,
    rootSlotWorldPositions,
    nodeExtents,
  });
  const top = (id) => exposedTopWorldPosition(assembly, plateParts, rootSlotWorldPositions, nodeExtents, id);
  const box = (id) => nodeWorldBox(assembly, plateParts, rootSlotWorldPositions, nodeExtents, id);
  return { markers, top, box };
}

test("a child on root's top stacks its marker straight above (sanity)", () => {
  const { markers, top } = plateScene([{ id: "c1", parentId: "root", slotName: "mount" }]);
  assert.deepEqual(top("c1"), [0, 0, 8]);
  assert.deepEqual(markers, [{ id: "c1::bot", x: 0, y: 0, z: 8 }]);
});

test("a child on a side slot gets no stack marker instead of one floating above the slot", () => {
  // Root's xpos is at (20, 0, 2); the child lies on its side there, so its
  // "bot" faces +x (about (24, 0, 2)), not up at (20, 0, 6).
  const { markers, top, box } = plateScene([
    { id: "c1", parentId: "root", slotName: "xpos" },
    { id: "c2", parentId: "c1", slotName: "bot" },
  ]);
  assert.equal(top("c1"), null);
  assert.deepEqual(markers, []);
  assert.equal(box("c1"), null);
  assert.equal(box("c2"), null);
  assert.equal(top("c2"), null);
});

test("a stack under a child hanging from root's bot goes further down, not into root", () => {
  const { markers, top, box } = plateScene([
    { id: "c1", parentId: "root", slotName: "bot" },
    { id: "c2", parentId: "c1", slotName: "bot" },
  ]);
  assert.deepEqual(top("c1"), [0, 0, -4]);
  assert.deepEqual(box("c1"), { min: [-20, -20, -4], max: [20, 20, 0] });
  // Before, c2's box was z 4..8 — on top of root — and c1's marker sat
  // inside root at z=4.
  assert.deepEqual(box("c2"), { min: [-20, -20, -8], max: [20, 20, -4] });
  assert.deepEqual(top("c2"), [0, 0, -8]);
  assert.deepEqual(
    markers.map((m) => m.id),
    ["c2::bot"],
  );
});

test("a shifted child hanging underneath gets no marker, since the flip decides the shift's direction", () => {
  const { top } = plateScene([{ id: "c1", parentId: "root", slotName: "bot", shift: [3, 0] }]);
  assert.equal(top("c1"), null);
});
