import test from "node:test";
import assert from "node:assert/strict";
import { matchesSearch } from "../../src/lib/catalogueUtils.js";

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
