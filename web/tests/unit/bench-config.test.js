import test from "node:test";
import assert from "node:assert/strict";

import {
  checkBenchConfig,
  configToJson,
  hydrateBenchConfig,
  parseBenchConfig,
  serializeBenchConfig,
} from "../../src/lib/benchConfig.js";
import { catalogue, sampleAssembly, samplePartsById } from "./bench-fixtures.js";

function sampleDoc() {
  return serializeBenchConfig(sampleAssembly(), samplePartsById());
}

// The sample document with one node's fields replaced.
function withNode(fields, i = 0) {
  const doc = sampleDoc();
  doc.nodes[i] = { ...doc.nodes[i], ...fields };
  return doc;
}

test("serialize -> JSON -> parse -> hydrate brings the same bench back", () => {
  const assembly = sampleAssembly();
  const partsById = samplePartsById();
  const doc = parseBenchConfig(configToJson(serializeBenchConfig(assembly, partsById)));
  const { assembly: back, importedParts } = hydrateBenchConfig(doc, catalogue);

  assert.equal(back.name, "Desk hook ✓");
  assert.equal(importedParts.size, 1);
  const [imported] = importedParts.values();
  assert.equal(imported.name, "cube.stl");
  assert.deepEqual(imported.anchors, partsById.get("imported:900").anchors);

  // Hydration re-issues every id; with that mapped out, the tree is the same.
  const ids = new Map([["root", "root"]]);
  assembly.nodes.forEach((n, i) => ids.set(n.id, back.nodes[i].id));
  const expected = assembly.nodes.map((n) => ({
    ...n,
    id: ids.get(n.id),
    parentId: ids.get(n.parentId),
    partId: n.partId === "imported:900" ? imported.id : n.partId,
  }));
  assert.deepEqual(back.nodes, expected);
  assert.deepEqual(back.root, assembly.root);
  assert.equal(back.cropTo, ids.get("c901"));
});

test("non-finite offsets and rotations are rejected (JSON's 1e999 is Infinity)", () => {
  const overlapText = configToJson(withNode({ overlap: 7 })).replace('"overlap": 7', '"overlap": -1e999');
  assert.throws(() => parseBenchConfig(overlapText), /non-numeric offset/);
  assert.throws(() => checkBenchConfig(withNode({ spin: Infinity })), /non-numeric rotation/);
  assert.throws(() => checkBenchConfig(withNode({ overlap: NaN })), /non-numeric offset/);
});

test("slot and anchor names must look like names", () => {
  assert.throws(() => checkBenchConfig(withNode({ slotName: 'mount"); evil(); //' })), /malformed slot/);
  assert.throws(() => checkBenchConfig(withNode({ childAnchor: "a\nb" })), /malformed anchor/);
  assert.throws(() => checkBenchConfig(withNode({ childAnchor: 3 })), /malformed anchor/);
  const doc = sampleDoc();
  doc.imports[0].anchors[0].name = 'x"y';
  assert.throws(() => checkBenchConfig(doc), /malformed slot/);
  // The catalogue's own shapes pass.
  for (const slotName of ["mount", "mount_-1_2", "mount_0.5_-0.5", "bot", "xpos_0", "slot12"]) {
    assert.doesNotThrow(() => checkBenchConfig(withNode({ slotName })), slotName);
  }
});

test("parameters must be identifiers with writable values", () => {
  assert.throws(() => checkBenchConfig(withNode({ params: { "w=1);evil(": 1 } })), /parameter named/);
  assert.throws(() => checkBenchConfig(withNode({ params: { w: { nested: 1 } } })), /unusable value for "w"/);
  assert.throws(() => checkBenchConfig(withNode({ params: { w: [1, Infinity] } })), /unusable value/);
  const doc = sampleDoc();
  doc.root.params = { "bad key": 1 };
  assert.throws(() => checkBenchConfig(doc), /The root part has a parameter named/);
  assert.doesNotThrow(() =>
    checkBenchConfig(withNode({ params: { $fn: 32, FIT_CLEARANCE: 0.2, v: [1, "a"] } })),
  );
});

test("an imported mesh's name must be text", () => {
  const doc = sampleDoc();
  doc.imports[0].name = { toString: () => "x" };
  assert.throws(() => checkBenchConfig(doc), /name that isn't text/);
});

test("duplicate ids are rejected with a message that says so", () => {
  const twice = sampleDoc();
  twice.imports.push({ ...twice.imports[0] });
  assert.throws(() => checkBenchConfig(twice), /Two imported meshes share the id "imported:900"/);

  const nodes = sampleDoc();
  nodes.nodes[1].id = nodes.nodes[0].id;
  assert.throws(() => checkBenchConfig(nodes), /Two attached parts share the id "c900"/);

  assert.throws(() => checkBenchConfig(withNode({ id: "root" })), /reserved id "root"/);
});
