import test from "node:test";
import assert from "node:assert/strict";

import {
  getOverrides,
  resolveAttachedParams,
  resolveParams,
  updateOverrides,
} from "../../src/lib/userOverrides.js";

// No localStorage in Node: saved overrides read as none, which is the
// case these tests want anyway.
const connector = {
  id: "opengrid/openconnect",
  defaults: { variant: "full", body: "directional" },
  attached_defaults: { body: "none" },
};

test("a part on its own takes its defaults; attached, the catalogue's attached_defaults go over them", () => {
  assert.deepEqual(resolveParams(connector, {}), { variant: "full", body: "directional" });
  assert.deepEqual(resolveAttachedParams(connector, {}), { variant: "full", body: "none" });
  // An instance value still beats both.
  assert.deepEqual(resolveAttachedParams(connector, { body: "symmetric" }), {
    variant: "full",
    body: "symmetric",
  });
  // A part without attached_defaults attaches as it is.
  assert.deepEqual(resolveAttachedParams({ id: "basics/plate", defaults: { w: 40 } }, {}), { w: 40 });
});

test("a stored value that isn't a parameter set reads as no overrides", () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    const key = "connector-foundry:overrides:basics/plate";
    // What a settings import can leave behind: the right envelope with a
    // string, an array, or null where the parameter set goes, or not even
    // an envelope.
    for (const stored of ["ab", ["a", "b"], null, 5]) {
      store.set(key, JSON.stringify({ parameterSets: { "user-default": stored }, fileFormatVersion: "1" }));
      assert.deepEqual(getOverrides("basics/plate"), {}, JSON.stringify(stored));
    }
    store.set(key, JSON.stringify("ab"));
    assert.deepEqual(getOverrides("basics/plate"), {});
    store.set(key, "null");
    assert.deepEqual(getOverrides("basics/plate"), {});
    // ...and merging onto one starts clean instead of from {0: "a", 1: "b"}.
    store.set(key, JSON.stringify({ parameterSets: { "user-default": "ab" } }));
    assert.deepEqual(updateOverrides("basics/plate", { w: 40 }), { w: 40 });
    assert.deepEqual(getOverrides("basics/plate"), { w: 40 });
  } finally {
    delete globalThis.window;
  }
});
