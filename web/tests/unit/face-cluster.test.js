import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";

import { clusterFace, primeNeighbors } from "../../src/lib/faceCluster.js";
import { triangleNeighbors } from "../../src/lib/meshTopology.js";
import { validateAndRepair } from "../../src/lib/meshValidate.js";

const sortedLists = (lists) => lists.map((l) => [...l].sort((a, b) => a - b));

// A box as an STL would arrive: a triangle soup, so the gate has to weld
// it. `flipped` reverses the winding of every other triangle so the
// gate also rewrites the index (and rebuilds its adjacency from it).
function soupBox(flipped = false) {
  const raw = new BoxGeometry(20, 10, 4, 2, 2, 2).toNonIndexed();
  if (flipped) {
    const p = raw.attributes.position;
    for (let t = 0; t < p.count / 3; t += 2) {
      const i = 3 * t;
      const x = p.getX(i + 1),
        y = p.getY(i + 1),
        z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
  return raw;
}

for (const flipped of [false, true]) {
  test(`validateAndRepair's neighbours match the index it returns (${flipped ? "after winding repair" : "clean"})`, () => {
    const { geometry, ok, neighbors, report } = validateAndRepair(soupBox(flipped));
    assert.equal(ok, true, report.join(" "));
    if (flipped) assert.match(report.join(" "), /winding/);
    const fresh = triangleNeighbors(geometry.index.array, geometry.attributes.position.count);
    assert.deepEqual(sortedLists(neighbors), sortedLists(fresh));
  });
}

test("a primed cluster is the one the lazy build finds", () => {
  const validation = validateAndRepair(soupBox(true));
  const lazy = clusterFace(validation.geometry.clone(), 0);

  const primed = validation.geometry;
  primeNeighbors(primed, validation.neighbors);
  const result = clusterFace(primed, 0);
  // The neighbour lists are the same sets in a different order, so the
  // flood fill visits the same triangles, not necessarily in sequence.
  assert.deepEqual(
    { ...result, triangles: new Set(result.triangles) },
    { ...lazy, triangles: new Set(lazy.triangles) },
  );
  // One whole face of the 2x2x2 box: 8 triangles.
  assert.equal(result.triangleCount, 8);
});

test("priming is dropped once the index is swapped", () => {
  const validation = validateAndRepair(soupBox());
  const geometry = validation.geometry;
  primeNeighbors(
    geometry,
    validation.neighbors.map(() => []),
  );
  // Primed with empty lists, a cluster can't grow past the clicked triangle…
  assert.equal(clusterFace(geometry, 0).triangleCount, 1);
  // …until the index changes, which invalidates what was primed.
  geometry.setIndex(geometry.index.clone());
  assert.equal(clusterFace(geometry, 0).triangleCount, 8);
});

test("a degenerate seed triangle has no face to cluster", () => {
  const geometry = new BufferGeometry();
  // Triangle 0 is three points on a line; triangle 1 is a real one.
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 1, 3]);
  assert.equal(clusterFace(geometry, 0), null);
  assert.deepEqual(clusterFace(geometry, 1).normal, [0, 0, 1]);
});
