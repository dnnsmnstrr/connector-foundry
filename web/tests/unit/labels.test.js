import assert from "node:assert/strict";
import { test } from "node:test";
import { humanizeParam, optionLabel, paramLabel, slotLabel } from "../../src/lib/labels.js";

test("a parameter without a label is its name in words, short forms spelled out", () => {
  assert.equal(humanizeParam("side_holes"), "Side holes");
  assert.equal(humanizeParam("base_h"), "Base height");
  assert.equal(humanizeParam("insert_od"), "Insert outside diameter");
  assert.equal(humanizeParam("cols"), "Columns");
  assert.equal(humanizeParam("pitch_x"), "Pitch X");
  // "d" is a depth in some parts and a diameter in others: left as it is.
  assert.equal(humanizeParam("head_d"), "Head d");
  assert.equal(humanizeParam("magnets"), "Magnets");
});

test("a part's own label wins, and a blank or non-string one is ignored", () => {
  const part = { labels: { gx: "Width (cells)", gy: "  ", gz: 3 } };
  assert.equal(paramLabel(part, "gx"), "Width (cells)");
  assert.equal(paramLabel(part, "gy"), "Gy");
  assert.equal(paramLabel(part, "gz"), "Gz");
  // An imported part has no labels.
  assert.equal(paramLabel({ kind: "imported" }, "screw_holes"), "Screw holes");
  assert.equal(paramLabel(null, "w"), "Width");
});

test("an option that is a word starts with a capital; numbers and sizes stay as they are", () => {
  assert.equal(optionLabel("thin"), "Thin");
  assert.equal(optionLabel("Threaded Snap Connector"), "Threaded Snap Connector");
  assert.equal(optionLabel("1/4"), "1/4");
  assert.equal(optionLabel("4mm"), "4mm");
  assert.equal(optionLabel(2), "2");
});

test("a grid slot is counted from the middle, a row slot from 1, a face by name", () => {
  assert.equal(slotLabel("mount_0_0"), "Centre");
  assert.equal(slotLabel("mount_1_-2"), "1 right, 2 front of centre");
  assert.equal(slotLabel("mount_-1_0"), "1 left of centre");
  assert.equal(slotLabel("mount_0_3"), "3 back of centre");
  // An even grid's slots sit on half steps (lib/slots.scad).
  assert.equal(slotLabel("mount_0.5_-1.5"), "½ right, 1½ front of centre");
  assert.equal(slotLabel("mount"), "Top");
  assert.equal(slotLabel("bot"), "Bottom");
  assert.equal(slotLabel("xpos_0"), "Right side 1");
  assert.equal(slotLabel("yneg_2"), "Front side 3");
  assert.equal(slotLabel("something_else"), "something_else");
});
