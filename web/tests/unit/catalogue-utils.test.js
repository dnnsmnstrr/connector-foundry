import test from "node:test";
import assert from "node:assert/strict";
import { isFinishedEdit, matchesSearch } from "../../src/lib/catalogueUtils.js";

test("part search matches catalogue keywords without regard to case", () => {
  const part = {
    name: "Beam",
    system: "BitBeam",
    id: "bitbeam/beam",
    confidence: "exact",
    keywords: ["Technic", "LEGO"],
  };
  assert.equal(matchesSearch(part, "technic"), true);
  assert.equal(matchesSearch(part, "lego"), true);
  assert.equal(matchesSearch(part, "not-a-match"), false);
});

test("a tick or a choice from the part's list is a finished edit; a typed value is not", () => {
  const part = { options: { variant: ["full", "lite"] } };
  const before = { w: 40, rounded: false, variant: "full" };
  assert.equal(isFinishedEdit(part, before, { ...before, rounded: true }), true);
  assert.equal(isFinishedEdit(part, before, { ...before, variant: "lite" }), true);
  assert.equal(isFinishedEdit(part, before, { ...before, variant: "lite", rounded: true }), true);
  assert.equal(isFinishedEdit(part, before, { ...before, w: 41 }), false);
  assert.equal(isFinishedEdit(part, before, { ...before, w: 41, rounded: true }), false);
  assert.equal(isFinishedEdit(part, before, before), false, "nothing changed");
  assert.equal(isFinishedEdit(undefined, before, { ...before, variant: "lite" }), false, "no list known");
});
