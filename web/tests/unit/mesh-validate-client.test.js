// The import gate runs in a worker (src/worker/mesh-worker.js): its
// result travels as validationToMessage()'s arrays and is rebuilt by
// validationFromMessage(), and must come back as the very result
// validateAndRepair() gave there. Node has no Worker, which is also the
// client's main-thread fallback.
import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, SphereGeometry } from "three";

import { validateAndRepair, validationFromMessage, validationToMessage } from "../../src/lib/meshValidate.js";
import { validateAndRepairAsync } from "../../src/lib/meshValidateClient.js";
import { clusterFace, primeNeighbors } from "../../src/lib/faceCluster.js";

// Through a structured clone, as postMessage() would carry it.
function roundTrip(result) {
  const { message, transfer } = validationToMessage(result);
  assert.equal(new Set(transfer).size, transfer.length, "no buffer is transferred twice");
  return validationFromMessage(structuredClone(message, { transfer }));
}

// The neighbour lists as arrays, from either form (the worker's are packed,
// see faceCluster.js's primeNeighbors()).
function unpacked(neighbors) {
  if (!neighbors || Array.isArray(neighbors)) return neighbors;
  const { offsets, faces } = neighbors;
  return Array.from({ length: offsets.length - 1 }, (_, t) =>
    Array.from(faces.subarray(offsets[t], offsets[t + 1])),
  );
}

function assertSameResult(actual, expected) {
  assert.equal(actual.ok, expected.ok);
  assert.deepEqual(actual.report, expected.report);
  assert.deepEqual(actual.extents, expected.extents);
  assert.deepEqual(actual.center, expected.center);
  assert.deepEqual(unpacked(actual.neighbors), unpacked(expected.neighbors));
  for (const name of ["position", "normal"]) {
    assert.deepEqual(
      actual.geometry.attributes[name]?.array,
      expected.geometry.attributes[name]?.array,
      name,
    );
  }
  assert.deepEqual(actual.geometry.index?.array, expected.geometry.index?.array, "index");
  assert.deepEqual(actual.geometry.boundingBox, expected.geometry.boundingBox);
}

test("a validated mesh survives the trip to the main thread unchanged", () => {
  const box = new BoxGeometry(20, 10, 4).toNonIndexed();
  const sphere = new SphereGeometry(5, 48, 32).toNonIndexed();
  for (const geometry of [box, sphere]) {
    const expected = validateAndRepair(geometry);
    assert.equal(expected.ok, true);
    assertSameResult(roundTrip(validateAndRepair(geometry)), expected);
  }
});

test("a rejected or empty mesh survives the trip too", () => {
  const open = new BoxGeometry(20, 10, 4).toNonIndexed();
  open.setAttribute("position", open.attributes.position.clone());
  open.attributes.position.array.fill(0, 0, 9);
  const empty = new BoxGeometry(1, 1, 1).toNonIndexed();
  empty.attributes.position.array.fill(0);
  for (const geometry of [open, empty]) {
    const expected = validateAndRepair(geometry);
    assert.equal(expected.ok, false);
    assertSameResult(roundTrip(validateAndRepair(geometry)), expected);
  }
});

test("without a Worker the gate runs on this thread, and leaves the input alone", async () => {
  const geometry = new BoxGeometry(20, 10, 4).toNonIndexed();
  const before = geometry.attributes.position.array.slice();
  const result = await validateAndRepairAsync(geometry);
  assertSameResult(result, validateAndRepair(geometry));
  assert.deepEqual(geometry.attributes.position.array, before);
});

test("a slot click finds the same face from the worker's packed neighbours", () => {
  const direct = validateAndRepair(new BoxGeometry(20, 10, 4, 3, 2, 1).toNonIndexed());
  const packed = roundTrip(validateAndRepair(new BoxGeometry(20, 10, 4, 3, 2, 1).toNonIndexed()));
  primeNeighbors(direct.geometry, direct.neighbors);
  primeNeighbors(packed.geometry, packed.neighbors);
  for (const face of [0, 5, 11]) {
    const found = clusterFace(packed.geometry, face);
    assert.ok(found && found.triangleCount > 1, `face ${face} is a cluster`);
    assert.deepEqual(found, clusterFace(direct.geometry, face), `face ${face}`);
  }
});
