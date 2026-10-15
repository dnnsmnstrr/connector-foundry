import assert from "node:assert/strict";
import { test } from "node:test";
import { isOpenscadError } from "../../src/lib/openscadLog.js";

test("OpenSCAD's per-run status line is not an error", () => {
  assert.equal(isOpenscadError("Status: NoError"), false);
  assert.equal(isOpenscadError("Geometries in cache: 12"), false);
});

test("real OpenSCAD errors still classify as errors", () => {
  assert.equal(isOpenscadError("ERROR: Assertion failed"), true);
  assert.equal(isOpenscadError('ERROR: Can\'t open include file \'missing.scad\'.'), true);
  assert.equal(isOpenscadError("Parser error: syntax error in file x.scad, line 3"), true);
});
