import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  encodeTree,
  readUrlState,
  restoreBenchFromUrl,
  saveSessionImports,
  writeUrlState,
} from "../../src/lib/benchUrlState.js";
import { catalogue, sampleAssembly, samplePartsById } from "./bench-fixtures.js";

// Just enough of a browser window: a location whose hash replaceState
// rewrites, and a sessionStorage.
function fakeWindow() {
  const store = new Map();
  const location = { pathname: "/app/", search: "", hash: "" };
  return {
    location,
    history: {
      state: null,
      replaceState(_state, _title, url) {
        const at = url.indexOf("#");
        location.hash = at < 0 ? "" : url.slice(at);
      },
    },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
}

beforeEach(() => {
  globalThis.window = fakeWindow();
});

test("a bench written to the URL comes back, non-ASCII name included", () => {
  const assembly = sampleAssembly();
  const partsById = samplePartsById();
  writeUrlState({ mode: "bench", assembly });
  saveSessionImports(assembly, partsById);
  assert.equal(readUrlState().mode, "bench");
  // URL-safe base64: nothing that needs escaping in a hash.
  assert.match(readUrlState().bench, /^[A-Za-z0-9_-]+$/);

  const { assembly: back, importedParts } = restoreBenchFromUrl(catalogue);
  assert.equal(back.name, "Desk hook ✓");
  assert.equal(importedParts.size, 1);
  assert.deepEqual(back.root, assembly.root);
  assert.deepEqual(
    back.nodes.map((n) => [n.slotName, n.joint, n.childAnchor, n.overlap, n.spin, n.shift, n.params]),
    assembly.nodes.map((n) => [n.slotName, n.joint, n.childAnchor, n.overlap, n.spin, n.shift, n.params]),
  );
  assert.equal(back.cropTo, back.nodes[1].id);
});

test("no bench in the URL restores nothing", () => {
  assert.equal(restoreBenchFromUrl(catalogue), null);
});

test("a truncated or garbled payload is a readable error, not a crash", () => {
  const full = encodeTree(sampleAssembly());
  for (const bench of [full.slice(0, full.length - 7), "%%%", "bm90IGpzb24", encodeTreeOf("[1, 2]")]) {
    globalThis.window.location.hash = `#mode=bench&bench=${bench}`;
    assert.throws(() => restoreBenchFromUrl(catalogue), /couldn't be read/, bench);
  }
});

test("a link naming a mesh this tab never saw says where to get it", () => {
  writeUrlState({ mode: "bench", assembly: sampleAssembly() });
  assert.throws(() => restoreBenchFromUrl(catalogue), /only kept in the tab it was uploaded in/);
});

test("a stale, broken mesh left in the tab doesn't break a link that doesn't use it", () => {
  globalThis.window.sessionStorage.setItem(
    "connector-foundry:benchImports",
    JSON.stringify([{ id: "imported:1", name: "old.stl", anchors: [], stl: "not base64!" }]),
  );
  const assembly = { root: { id: "root", partId: "basics/plate", params: { w: 40 } }, nodes: [] };
  writeUrlState({ mode: "bench", assembly });
  const { assembly: back, importedParts } = restoreBenchFromUrl(catalogue);
  assert.deepEqual(back.root, assembly.root);
  assert.equal(importedParts.size, 0);
});

function encodeTreeOf(json) {
  return Buffer.from(json).toString("base64url");
}
