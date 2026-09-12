import test from "node:test";
import assert from "node:assert/strict";

import { sceneMarkers } from "../../src/lib/benchLayout.js";

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
  assert.deepEqual(evenMarkers.map((marker) => marker.radius), [undefined, undefined]);
});
