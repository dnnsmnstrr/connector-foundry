import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

import { STORED_IMPORTS_KEY } from "../../src/lib/benchUrlState.js";
import { meshSource } from "../../src/lib/holesRender.js";
import { addHole, createHolesDoc } from "../../src/lib/screwHoles.js";
import {
  flushWorkspace,
  isWorkspaceKey,
  restoreWorkspaceBench,
  restoreWorkspaceHoles,
  restoreWorkspaceView,
  saveWorkspaceImports,
  scheduleWorkspaceBench,
  scheduleWorkspaceHoles,
  scheduleWorkspaceView,
} from "../../src/lib/workspace.js";
import { catalogue, cubeStl, sampleAssembly, samplePartsById } from "./bench-fixtures.js";

// The workspace (src/lib/workspace.js): the tab, Library selection, Bench
// and Holes document kept in localStorage, checked on the way back in.

const VIEW_KEY = "connector-foundry:workspace:view";
const BENCH_KEY = "connector-foundry:workspace:bench";
const HOLES_KEY = "connector-foundry:workspace:holes";
const FORMAT = "connector-foundry/workspace";

/** A Storage stand-in over a Map, as the window's localStorage. */
function memoryWindow(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
}

/** The same, but every write is over quota. */
function fullWindow(initial = {}) {
  const window = memoryWindow(initial);
  window.localStorage.setItem = () => {
    throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
  };
  return window;
}

function captureWarnings(fn) {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = realWarn;
  }
  return warnings;
}

beforeEach(() => {
  // Anything left from the previous test's debounce belongs to its window.
  flushWorkspace();
  globalThis.window = memoryWindow();
});

afterEach(() => {
  flushWorkspace();
});

test("workspace keys are the ones settings backups leave out", () => {
  assert.equal(isWorkspaceKey("connector-foundry:workspace:bench"), true);
  assert.equal(isWorkspaceKey("connector-foundry:workspace:imports"), true);
  assert.equal(isWorkspaceKey("connector-foundry:benchPresets"), false);
  assert.equal(isWorkspaceKey("connector-foundry.sidebarWidth"), false);
  assert.equal(isWorkspaceKey(null), false);
});

test("the tab and Library selection come back, with the part's defaults filled in", () => {
  const plate = { ...catalogue.get("basics/plate"), defaults: { w: 20, h: 10 } };
  const byId = new Map([...catalogue, [plate.id, plate]]);
  scheduleWorkspaceView({ mode: "holes", library: { part: plate, params: { w: 40 } } });
  // Debounced: nothing is written until the flush.
  assert.equal(globalThis.window.localStorage.getItem(VIEW_KEY), null);
  assert.equal(flushWorkspace(), true);

  const view = restoreWorkspaceView(byId);
  assert.equal(view.mode, "holes");
  assert.equal(view.library.part.id, "basics/plate");
  assert.deepEqual(view.library.params, { w: 40, h: 10 });
});

test("a stored tab or part that no longer exists is dropped, the rest kept", () => {
  globalThis.window.localStorage.setItem(
    VIEW_KEY,
    JSON.stringify({
      format: FORMAT,
      version: 1,
      mode: "origami",
      library: { partId: "gone/part", params: { w: 40 } },
    }),
  );
  assert.equal(restoreWorkspaceView(catalogue), null);

  globalThis.window.localStorage.setItem(
    VIEW_KEY,
    JSON.stringify({
      format: FORMAT,
      version: 1,
      mode: "bench",
      library: { partId: "gone/part", params: { w: 40 } },
    }),
  );
  assert.deepEqual(restoreWorkspaceView(catalogue), { mode: "bench", library: null });

  // A part whose saved parameters aren't usable is no selection at all.
  const badParams = JSON.stringify({
    format: FORMAT,
    version: 1,
    mode: "library",
    library: { partId: "basics/plate", params: { w: 0 } },
  }).replace('"w":0', '"w":1e999');
  globalThis.window.localStorage.setItem(VIEW_KEY, badParams);
  const view = restoreWorkspaceView(catalogue);
  assert.equal(view.mode, "library");
  assert.equal(view.library, null);
});

test("a bench and its imported mesh come back", () => {
  const assembly = sampleAssembly();
  const partsById = samplePartsById();
  saveWorkspaceImports(assembly, partsById);
  scheduleWorkspaceBench(assembly);
  assert.equal(flushWorkspace(), true);

  const { assembly: back, importedParts } = restoreWorkspaceBench(catalogue);
  assert.equal(back.name, "Desk hook ✓");
  assert.deepEqual(back.root.params, assembly.root.params);
  assert.equal(back.cropTo, back.nodes[1].id);
  assert.equal(importedParts.size, 1);
  const [imported] = importedParts.values();
  assert.equal(imported.kind, "imported");
  assert.equal(imported.name, "cube.stl");
  assert.ok(imported.stlBytes.byteLength > 0);
});

test("no bench is stored as no bench", () => {
  scheduleWorkspaceBench(sampleAssembly());
  flushWorkspace();
  assert.ok(globalThis.window.localStorage.getItem(BENCH_KEY));
  scheduleWorkspaceBench(null);
  assert.equal(flushWorkspace(), true);
  assert.equal(globalThis.window.localStorage.getItem(BENCH_KEY), null);
  assert.equal(restoreWorkspaceBench(catalogue), null);
});

test("a bench whose imported mesh isn't stored says so, as a link would", () => {
  scheduleWorkspaceBench(sampleAssembly());
  flushWorkspace();
  assert.throws(() => restoreWorkspaceBench(catalogue), /isn't stored in this browser/);
});

test("garbled or old workspace entries are ignored, not thrown into the boot", () => {
  globalThis.window.localStorage.setItem(VIEW_KEY, "not json");
  assert.equal(restoreWorkspaceView(catalogue), null);
  globalThis.window.localStorage.setItem(
    BENCH_KEY,
    JSON.stringify({ format: "connector-foundry/workspace", version: 99, tree: {} }),
  );
  assert.equal(restoreWorkspaceBench(catalogue), null);
  globalThis.window.localStorage.setItem(BENCH_KEY, JSON.stringify({ format: FORMAT, version: 1, tree: [] }));
  assert.equal(restoreWorkspaceBench(catalogue), null);
});

test("the Holes document comes back with its holes and next-hole settings", () => {
  const doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } }, "plate.stl");
  const holed = addHole(doc, {
    point: [1, 2, 10],
    normal: [0, 0, 2],
    spec: { kind: "screw" },
    presetId: "m3-cap",
  }).doc;
  scheduleWorkspaceHoles(holed);
  assert.equal(flushWorkspace(), true);

  const back = restoreWorkspaceHoles(catalogue);
  assert.ok(back);
  assert.deepEqual(back.source, holed.source);
  assert.equal(back.name, "plate.stl");
  assert.equal(back.holes.length, 1);
  assert.equal(back.holes[0].id, holed.holes[0].id);
  assert.deepEqual(back.holes[0].point, [1, 2, 10]);
  // The normal is stored unit-length, whatever the surface probe gave.
  assert.deepEqual(back.holes[0].normal, [0, 0, 1]);
  assert.equal(back.holes[0].spec.kind, "screw");
  assert.equal(back.nextPresetId, holed.nextPresetId);
});

test("a mesh base comes back through the validate gate, flipped side included", () => {
  const geometry = new STLLoader().parse(cubeStl());
  for (const flip of [false, true]) {
    const source = meshSource("cube.stl", geometry, flip);
    const doc = addHole(createHolesDoc(source), {
      point: [0, 0, 10],
      normal: [0, 0, 1],
      spec: { kind: "screw" },
    }).doc;
    scheduleWorkspaceHoles(doc);
    assert.equal(flushWorkspace(), true);

    const back = restoreWorkspaceHoles(catalogue);
    assert.equal(back.source.kind, "mesh");
    assert.equal(back.source.name, "cube.stl");
    assert.equal(back.source.flip, flip);
    assert.deepEqual(back.source.extents, [10, 10, 10]);
    assert.equal(back.holes.length, 1);
  }
});

test("a damaged stored Holes document is dropped once, with a warning", () => {
  globalThis.window.localStorage.setItem(
    HOLES_KEY,
    JSON.stringify({
      format: FORMAT,
      version: 1,
      source: { kind: "mesh", name: "bad.stl", flip: false, stl: "not base64!" },
      holes: [],
      name: null,
      nextSpec: {},
      nextPresetId: null,
    }),
  );
  const warnings = captureWarnings(() => {
    assert.equal(restoreWorkspaceHoles(catalogue), null);
  });
  assert.equal(globalThis.window.localStorage.getItem(HOLES_KEY), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /couldn't restore the Holes tab/);
});

test("a Holes base whose catalogue part is gone is dropped rather than half-restored", () => {
  const doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } });
  scheduleWorkspaceHoles(doc);
  flushWorkspace();
  captureWarnings(() => {
    assert.equal(restoreWorkspaceHoles(new Map()), null);
  });
  assert.equal(globalThis.window.localStorage.getItem(HOLES_KEY), null);
});

test("a full storage reports the failure and drops the stale entry", () => {
  const win = fullWindow({
    [BENCH_KEY]: JSON.stringify({ format: FORMAT, version: 1, tree: { root: { partId: "basics/plate" } } }),
  });
  globalThis.window = win;
  scheduleWorkspaceBench(sampleAssembly());
  const warnings = captureWarnings(() => {
    assert.equal(flushWorkspace(), false);
  });
  // Better no saved bench than last launch's, which would look current.
  assert.equal(win.localStorage.getItem(BENCH_KEY), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /couldn't save it for next time/);
});

test("clearing the Holes tab clears its stored document too", () => {
  const doc = createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } });
  scheduleWorkspaceHoles(doc);
  flushWorkspace();
  assert.ok(globalThis.window.localStorage.getItem(HOLES_KEY));
  scheduleWorkspaceHoles(null);
  assert.equal(flushWorkspace(), true);
  assert.equal(globalThis.window.localStorage.getItem(HOLES_KEY), null);
  assert.equal(restoreWorkspaceHoles(catalogue), null);
});

test("the imported meshes live under the workspace prefix, not a tab's session", () => {
  const assembly = sampleAssembly();
  saveWorkspaceImports(assembly, samplePartsById());
  assert.equal(isWorkspaceKey(STORED_IMPORTS_KEY), true);
  assert.ok(globalThis.window.localStorage.getItem(STORED_IMPORTS_KEY));
});
