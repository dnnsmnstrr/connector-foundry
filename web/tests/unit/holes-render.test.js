import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry } from "three";

import {
  baseBuffer,
  holedRequest,
  holedRequestIfKnown,
  meshSource,
  renderHoled,
} from "../../src/lib/holesRender.js";
import { addHole, createHolesDoc } from "../../src/lib/screwHoles.js";
import { meshExtents } from "../../src/lib/meshExtents.js";

const catalogueById = new Map([
  [
    "basics/plate",
    { id: "basics/plate", name: "Flat plate", file: "parts/basics/plate.scad", module: "basics_plate" },
  ],
]);

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);

test("meshSource grounds the mesh: centered on x/y, bottom at z = 0, bytes and extents alike", () => {
  const geometry = new BoxGeometry(20, 10, 4).translate(100, 50, 30);
  const source = meshSource("box", geometry, false);
  assert.equal(source.kind, "mesh");
  assert.equal(source.name, "box");
  assert.equal(source.flip, false);
  assert.equal(source.geometry, geometry);
  assert.ok(close(source.extents, [20, 10, 4]));
  assert.ok(close(meshExtents(source.stlBytes), [20, 10, 4]));
});

test("meshSource with flip turns the mesh over about X: y and z keep their sizes", () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), true);
  assert.equal(source.flip, true);
  assert.ok(close(source.extents, [20, 10, 4]));
});

test("baseBuffer: a mesh source is its own bytes; an unknown catalogue part rejects", async () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  assert.equal(await baseBuffer(source, catalogueById), source.stlBytes);
  await assert.rejects(
    baseBuffer({ kind: "catalogue", partId: "nope/missing", params: {} }, catalogueById),
    /Unknown catalogue part nope\/missing/,
  );
});

test("holedRequest cuts the holes from the base and mounts a mesh source's bytes", () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  const { doc } = addHole(createHolesDoc(source), { point: [0, 0, 4], normal: [0, 0, 1] });
  const globals = { FIT_CLEARANCE: 0.2 };
  const request = holedRequest(doc, catalogueById, source.extents, globals);
  assert.match(request.scadSource, /difference\(\)/);
  assert.equal(request.globalOverrides, globals);
  assert.deepEqual([...request.importedFiles.values()], [source.stlBytes]);
});

test("holedRequestIfKnown stands in an uncacheable request when the request can't be formed", () => {
  const plate = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } });
  const { doc } = addHole(plate, { point: [0, 0, 4], normal: [0, 0, 1] });
  const unknown = holedRequestIfKnown(doc, catalogueById, null, {});
  assert.match(unknown.scadSource, /^\0/);

  const missing = { ...doc, source: { kind: "catalogue", partId: "nope/missing", params: {} } };
  assert.deepEqual(holedRequestIfKnown(missing, catalogueById, [40, 40, 4], {}), unknown);

  const known = holedRequestIfKnown(doc, catalogueById, [40, 40, 4], {});
  assert.match(known.scadSource, /include <\.\.\/parts\/basics\/plate\.scad>/);
});

test("renderHoled with no holes is the base itself, with its extents", async () => {
  const source = meshSource("box", new BoxGeometry(20, 10, 4), false);
  const { stl, baseExtents } = await renderHoled(createHolesDoc(source), catalogueById, {});
  assert.equal(stl, source.stlBytes);
  assert.ok(close(baseExtents, [20, 10, 4]));
});
