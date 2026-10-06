import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { validateAndRepair } from "../../src/lib/meshValidate.js";
import {
  MESH_FILE_ACCEPT,
  STEP_TESSELLATION,
  bodiesFromOcct,
  bodyLabels,
  geometryFromBodies,
  isStepFilename,
  looksLikeStep,
} from "../../src/lib/stepMesh.js";

const require = createRequire(import.meta.url);
// occt-import-js runs in Node as well as in the browser, so the same
// reader the worker uses can be exercised here, against the small STEP
// fixtures the package ships with.
const fixtures = `${require.resolve("occt-import-js").replace(/dist[\\/]occt-import-js\.js$/, "")}test/testfiles/`;
let occtModule;
async function occt() {
  occtModule ??= await require("occt-import-js")();
  return occtModule;
}
async function readStep(file) {
  return bodiesFromOcct((await occt()).ReadStepFile(new Uint8Array(readFileSync(file)), { ...STEP_TESSELLATION }));
}
function extentsOf(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [max.x - min.x, max.y - min.y, max.z - min.z].map((n) => Math.round(n * 1000) / 1000);
}

test("recognises STEP by extension or by its ISO 10303-21 header", () => {
  assert.equal(isStepFilename("Bracket.STEP"), true);
  assert.equal(isStepFilename("bracket.stp"), true);
  assert.equal(isStepFilename("bracket.stl"), false);
  assert.equal(isStepFilename(undefined), false);
  assert.equal(looksLikeStep(new TextEncoder().encode("ISO-10303-21;\nHEADER;")), true);
  assert.equal(looksLikeStep(new TextEncoder().encode("solid cube\n facet normal")), false);
  assert.equal(looksLikeStep(new ArrayBuffer(0)), false);
  assert.equal(MESH_FILE_ACCEPT, ".stl,.step,.stp,.3mf");
});

test("a single-body STEP tessellates to one watertight solid in millimetres", async () => {
  const bodies = await readStep(`${fixtures}rounded-cube/rounded-cube.step`);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].extents.map((n) => Math.round(n * 1000) / 1000), [10, 10, 10]);
  assert.equal(bodies[0].positions.length, bodies[0].triangleCount * 9);
  const result = validateAndRepair(geometryFromBodies(bodies));
  assert.equal(result.ok, true, result.report.join(" "));
  assert.deepEqual(extentsOf(result.geometry), [10, 10, 10]);
});

test("a STEP file's declared unit is converted to millimetres", async () => {
  // The same cube saved from FreeCAD in metres, inches and millimetres.
  const [m, inch, mm] = await Promise.all(
    ["cube-m", "cube-in", "cube-mm"].map((name) => readStep(`${fixtures}cube-units/${name}.step`)),
  );
  assert.deepEqual(extentsOf(geometryFromBodies(m)), [1000, 1000, 1000]);
  assert.deepEqual(extentsOf(geometryFromBodies(inch)), [1000, 1000, 1000]);
  assert.deepEqual(extentsOf(geometryFromBodies(mm)), [1000, 1000, 1000]);
});

test("a multi-body STEP lists every body, and one body on its own passes the gate", async () => {
  const bodies = await readStep(`${fixtures}cax-if/as1_pe_203.stp`);
  assert.equal(bodies.length, 18);
  // Every body in this file is called "SOLID": labels disambiguate by index.
  const labels = bodyLabels(bodies);
  assert.equal(new Set(labels).size, 18);
  assert.match(labels[0], /^SOLID \(1\)$/);
  // The whole assembly as one mesh is refused — parts touch and overlap.
  assert.equal(validateAndRepair(geometryFromBodies(bodies)).ok, false);
  // A single body is a clean solid.
  const one = validateAndRepair(geometryFromBodies([bodies[0]]));
  assert.equal(one.ok, true, one.report.join(" "));
});

test("body labels fall back to Body N for unnamed bodies and keep unique names", () => {
  const named = (name) => ({ name, positions: new Float32Array(9), triangleCount: 1, extents: [1, 1, 1] });
  assert.deepEqual(bodyLabels([named(""), named("Lid"), named("")]), ["Body 1", "Lid", "Body 3"]);
});

test("a reader failure or an empty result is an error, not an empty part", () => {
  assert.throws(() => bodiesFromOcct({ success: false }), /could not read/);
  assert.throws(() => bodiesFromOcct({ success: true, meshes: [] }), /no solid geometry/);
});

// The vendored Deskware connector is a real-world export (three bodies,
// blank names). Only present with the QuackWorks submodule checked out.
const deskware = new URL("../../../vendor/QuackWorks/Deskware/Connector v0.5 v3.step", import.meta.url);
test("a vendored three-body STEP yields three bodies, each a solid", { skip: !existsSync(deskware) }, async () => {
  const bodies = await readStep(deskware);
  assert.equal(bodies.length, 3);
  assert.deepEqual(bodyLabels(bodies), ["Body 1", "Body 2", "Body 3"]);
  for (const body of bodies) assert.equal(validateAndRepair(geometryFromBodies([body])).ok, true);
  assert.match(validateAndRepair(geometryFromBodies(bodies)).report.join(" "), /3 disconnected solids/);
});
