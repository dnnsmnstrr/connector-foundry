import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh } from "three";

import { bodiesFromGroup, is3mfFilename, looksLikeZip, modelUnitOf, unitScale } from "../../src/lib/threeMfMesh.js";
import { MESH_FILE_ACCEPT } from "../../src/lib/stepMesh.js";
import { make3mf } from "../fixtures/threeMf.js";

test("recognises 3MF by extension or by the zip signature", () => {
  assert.equal(is3mfFilename("Part.3MF"), true);
  assert.equal(is3mfFilename("part.stl"), false);
  assert.equal(looksLikeZip(make3mf()), true);
  assert.equal(looksLikeZip(new TextEncoder().encode("solid cube")), false);
  assert.equal(looksLikeZip(new ArrayBuffer(2)), false);
  assert.equal(MESH_FILE_ACCEPT, ".stl,.step,.stp,.3mf");
});

test("the model unit is read from the zip and converted to millimetres", () => {
  assert.equal(modelUnitOf(make3mf({ unit: "inch" })), "inch");
  assert.equal(modelUnitOf(make3mf({ unit: "centimeter" })), "centimeter");
  assert.equal(modelUnitOf(new Uint8Array([1, 2, 3])), null);
  assert.equal(unitScale("inch"), 25.4);
  assert.equal(unitScale("centimeter"), 10);
  assert.equal(unitScale("micron"), 0.001);
  assert.equal(unitScale("millimeter"), 1);
  assert.equal(unitScale(undefined), 1);
  assert.equal(unitScale("furlong"), 1);
});

test("a loader Group flattens to bodies in world space, scaled, named after the object", () => {
  const group = new Group();
  const part = new Group();
  part.name = "Bracket";
  const mesh = new Mesh(new BoxGeometry(2, 1, 0.5)); // indexed, like a hand-built geometry
  mesh.position.set(10, 0, 0);
  part.add(mesh);
  group.add(part);

  const bodies = bodiesFromGroup(group, 10);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].name, "Bracket");
  assert.equal(bodies[0].triangleCount, 12);
  assert.equal(bodies[0].positions.length, 12 * 9);
  assert.deepEqual(bodies[0].extents, [20, 10, 5]);
  // Translated by the mesh's own position, then scaled: x runs 90..110.
  const xs = Array.from({ length: 36 }, (_, i) => bodies[0].positions[3 * i]);
  assert.equal(Math.min(...xs), 90);
  assert.equal(Math.max(...xs), 110);
});
