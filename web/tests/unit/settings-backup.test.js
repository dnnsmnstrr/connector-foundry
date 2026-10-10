import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS_FORMAT, applySettings, exportSettings, parseSettings, settingsToJson } from "../../src/lib/settingsBackup.js";

// A Storage stand-in: insertion-ordered, with an optional byte quota.
function memoryStorage(initial = {}, quota = Infinity) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const size = [...map].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0) + k.length + v.length;
      if (size > quota) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

test("export takes only the app's keys, both separators", () => {
  const storage = memoryStorage({
    "connector-foundry.sidebarCollapsed": "1",
    "connector-foundry:benchPresets": "[]",
    "connector-foundry:overrides:__global__": '{"parameterSets":{}}',
    "other-app": "x",
  });
  const doc = exportSettings(storage);
  assert.equal(doc.format, SETTINGS_FORMAT);
  assert.deepEqual(Object.keys(doc.entries).sort(), [
    "connector-foundry.sidebarCollapsed",
    "connector-foundry:benchPresets",
    "connector-foundry:overrides:__global__",
  ]);
});

test("an export imported elsewhere reproduces it exactly, leaving other apps alone", () => {
  const source = memoryStorage({ "connector-foundry.systemOrder": '["A","B"]', "connector-foundry:benchPresets": "[1]" });
  const target = memoryStorage({ "connector-foundry.sidebarWidth": "400", "connector-foundry:benchPresets": "[2]", "other-app": "x" });
  const entries = parseSettings(settingsToJson(exportSettings(source)));
  assert.equal(applySettings(entries, target), null);
  assert.deepEqual(target.dump(), { "connector-foundry:benchPresets": "[1]", "connector-foundry.systemOrder": '["A","B"]', "other-app": "x" });
});

test("parse refuses other files and drops foreign keys and non-strings", () => {
  assert.throws(() => parseSettings("nope"), /JSON/);
  assert.throws(() => parseSettings('{"format":"connector-foundry-bench"}'), /settings file/);
  assert.throws(() => parseSettings(`{"format":"${SETTINGS_FORMAT}","version":2,"entries":{}}`), /newer version/);
  assert.throws(() => parseSettings(`{"format":"${SETTINGS_FORMAT}","version":1}`), /no settings/);
  const entries = parseSettings(JSON.stringify({
    format: SETTINGS_FORMAT, version: 1,
    entries: { "connector-foundry.a": "1", "evil": "x", "connector-foundry.b": 5 },
  }));
  assert.deepEqual(entries, { "connector-foundry.a": "1" });
});

test("a write that doesn't fit leaves storage as it was", () => {
  const before = { "connector-foundry.sidebarWidth": "400", "connector-foundry:benchPresets": "[1]" };
  const storage = memoryStorage(before, 200);
  const problem = applySettings({ "connector-foundry.systemOrder": "[]", "connector-foundry:benchPresets": "x".repeat(500) }, storage);
  assert.match(problem, /too large/);
  assert.deepEqual(storage.dump(), before);
});
