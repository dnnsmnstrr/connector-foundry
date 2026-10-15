import test from "node:test";
import assert from "node:assert/strict";

import { compileToScad, normalizeSpin } from "../../src/lib/assembly.js";

const parts = new Map([
  [
    "basics/plate",
    {
      id: "basics/plate",
      name: "Plate",
      file: "parts/basics/plate.scad",
      module: "basic_plate",
      anchors: ["bot", "xpos"],
    },
  ],
  ["gopro/male", { id: "gopro/male", name: "GoPro", file: "parts/gopro/male.scad", module: "gopro_male" }],
]);

// Built by hand rather than through addChild(), so the ids don't depend
// on the session's id counter.
function node(fields) {
  return { params: {}, joint: "fused", childAnchor: "mount", overlap: 0, spin: 0, shift: [0, 0], ...fields };
}

function smallTree() {
  return {
    root: { id: "root", partId: "basics/plate", params: { w: 40, label: 'a"b' } },
    nodes: [
      node({
        id: "c1",
        parentId: "root",
        partId: "basics/plate",
        params: { w: 20 },
        slotName: "mount",
        overlap: -0.5,
        spin: 90,
      }),
      node({ id: "c2", parentId: "c1", partId: "gopro/male", slotName: "bot", joint: "bolted", spin: -1e-9 }),
    ],
    cropTo: "root",
  };
}

test("a fused + bolted tree with a crop, spin and offset compiles to the expected source", () => {
  const expected = `include <../vendor/BOSL2/std.scad>
include <../lib/joints.scad>
include <../parts/basics/plate.scad>
include <../parts/gopro/male.scad>


part = "all"; // ["root","c2"]

// Crop: everything outside the vertical outline of root (Plate) is cut away.
intersection() {
    if (part == "all" || part == "root")
        basic_plate(w=40, label="a\\"b") {
            attach("mount", "mount", overlap=0.5, spin=90) basic_plate(w=20) {
                attach("bot", "mount") bolted_flange_a() {
                    if (part == "all" || part == "c2")
                        attach(BOTTOM, "mount") bolted_flange_b() attach(BOTTOM, "mount") gopro_male();
                    else
                        attach(BOTTOM, "mount") hide_this() bolted_flange_b() attach(BOTTOM, "mount") hide_this() gopro_male();
                }
            }
        }
    else
        hide_this() basic_plate(w=40, label="a\\"b") {
            attach("mount", "mount", overlap=0.5, spin=90) hide_this() basic_plate(w=20) {
                attach("bot", "mount") hide_this() bolted_flange_a() {
                    if (part == "all" || part == "c2")
                        attach(BOTTOM, "mount") bolted_flange_b() attach(BOTTOM, "mount") gopro_male();
                    else
                        attach(BOTTOM, "mount") hide_this() bolted_flange_b() attach(BOTTOM, "mount") hide_this() gopro_male();
                }
            }
        }
    linear_extrude(height = 1000, center = true) fill() projection()
        show_only("crop")
            tag_this("crop") basic_plate(w=40, label="a\\"b") {
                    attach("mount", "mount", overlap=0.5, spin=90) basic_plate(w=20) {
                        attach("bot", "mount") bolted_flange_a() {
                            attach(BOTTOM, "mount") bolted_flange_b() attach(BOTTOM, "mount") gopro_male();
                        }
                    }
                }
}
`;
  assert.equal(compileToScad(smallTree(), parts), expected);
});

test("a quote in a slot or anchor name stays inside its string literal", () => {
  const tree = smallTree();
  tree.nodes[0].slotName = 'mount"); evil(); //';
  tree.nodes[1].childAnchor = 'a"b';
  const scad = compileToScad(tree, parts);
  assert.match(scad, /attach\("mount\\"\); evil\(\); \/\/", "mount", overlap=0\.5, spin=90\)/);
  assert.match(scad, /attach\(BOTTOM, "a\\"b"\)/);
  // Every attach( line has balanced, properly closed string literals: no
  // unescaped quote is left over once the escaped ones are removed.
  for (const line of scad.split("\n").filter((l) => l.includes("attach("))) {
    const quotes = line.replace(/\\./g, "").match(/"/g) ?? [];
    assert.equal(quotes.length % 2, 0, line);
  }
});

test("a line break in a cropped part's name can't end the comment", () => {
  const named = new Map(parts);
  named.set("basics/plate", { ...parts.get("basics/plate"), name: "Plate\ncube(1000);\r x" });
  const scad = compileToScad(smallTree(), named);
  assert.match(scad, /^\/\/ Crop: .*\(Plate cube\(1000\); x\) is cut away\.$/m);
  assert.doesNotMatch(scad, /^cube\(1000\);/m);
});

test("a bad parameter key or non-finite offset makes compileToScad throw", () => {
  const badKey = smallTree();
  badKey.nodes[0].params = { "w=1);evil(": 1 };
  assert.throws(() => compileToScad(badKey, parts), /valid OpenSCAD parameter name/);
  const badOverlap = smallTree();
  badOverlap.nodes[0].overlap = -Infinity;
  assert.throws(() => compileToScad(badOverlap, parts), /Cannot pass Infinity/);
});

test("an imported part's anchor names are quoted in its generated wrapper", () => {
  const imported = {
    id: "imported:7",
    kind: "imported",
    name: "x.stl",
    extents: [10, 10, 10],
    center: [0, 0, 5],
    anchors: [{ name: 'top"', point: [0, 0, 5], normal: [0, 0, 1] }],
  };
  const tree = { root: { id: "root", partId: "imported:7", params: {} }, nodes: [] };
  const scad = compileToScad(tree, new Map([["imported:7", imported]]));
  assert.match(scad, /named_anchor\("top\\"", \[0, 0, 5\], \[0, 0, 1\], 0\)/);
  assert.match(scad, /import\("imports\/7\.stl"\);/);
});

test("normalizeSpin stays in [0, 360) and never returns -0", () => {
  assert.equal(normalizeSpin(-1e-9), 0);
  assert.equal(normalizeSpin(359.9999999), 0);
  assert.ok(Object.is(normalizeSpin(-0), 0));
  assert.ok(Object.is(normalizeSpin(-360), 0));
  assert.equal(normalizeSpin(-90), 270);
  assert.equal(normalizeSpin(720.25), 0.25);
  assert.equal(normalizeSpin(90 + 1e-12), 90);
  assert.equal(normalizeSpin(NaN), 0);
  for (const spin of [-1e-7, 1e300, -1e300, 359.9999996, -359.9999996]) {
    const out = normalizeSpin(spin);
    assert.ok(out >= 0 && out < 360, `${spin} -> ${out}`);
  }
});
