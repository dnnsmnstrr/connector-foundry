import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { addChild, createAssembly, setAssemblyName, updateNodeParams } from "../../src/lib/assembly.js";
import {
  clearBenchHistory,
  getBenchHistoryState,
  getBenchSession,
  redoBench,
  replaceBenchSession,
  setBenchAssembly,
  setBenchImportedParts,
  subscribeBenchHistory,
  subscribeBenchSession,
  undoBench,
} from "../../src/lib/benchSession.js";

// The store is module state: every test starts from an empty bench with
// no history, the way App.jsx's URL restore leaves it.
beforeEach(() => {
  replaceBenchSession({ assembly: null, importedParts: new Map() }, { record: false });
  clearBenchHistory();
});

const plate = () => createAssembly("basics/plate", { w: 40, d: 40, t: 3 });
const nextTask = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

test("picking a root is undoable back to the start screen", () => {
  setBenchAssembly(plate(), { label: "pick part" });
  assert.deepEqual(getBenchHistoryState(), {
    canUndo: true,
    canRedo: false,
    undoLabel: "pick part",
    redoLabel: null,
  });
  assert.equal(undoBench(), true);
  assert.equal(getBenchSession().assembly, null);
  assert.equal(redoBench(), true);
  assert.equal(getBenchSession().assembly.root.partId, "basics/plate");
  assert.equal(redoBench(), false);
});

test("updaters still work, and an edit that changes nothing records nothing", () => {
  setBenchAssembly(plate());
  clearBenchHistory();
  setBenchAssembly((a) => a);
  setBenchAssembly((a) => updateNodeParams(a, "root", { ...a.root.params }));
  assert.equal(getBenchHistoryState().canUndo, false);
  setBenchAssembly((a) => updateNodeParams(a, "root", { ...a.root.params, w: 50 }));
  assert.equal(getBenchHistoryState().canUndo, true);
});

test("keystrokes in one field coalesce by key into one step", () => {
  setBenchAssembly(plate());
  for (const name of ["B", "Be", "Ben", "Benc", "Bench"]) {
    setBenchAssembly((a) => setAssemblyName(a, name), { key: "name", label: "rename" });
  }
  undoBench();
  assert.equal(getBenchSession().assembly.name ?? null, null);
  undoBench();
  assert.equal(getBenchSession().assembly, null);
});

test("an import and the node that uses it are one undo step", async () => {
  setBenchAssembly(plate());
  const before = getBenchSession();
  const imported = { id: "imported:1", kind: "imported", name: "cube.stl" };
  // Bench.jsx's confirmChildImport(): registerImport(), then attachPending().
  setBenchImportedParts((m) => new Map(m).set(imported.id, imported));
  setBenchAssembly(
    (a) =>
      addChild(a, { parentId: "root", partId: imported.id, params: {}, slotName: "mount", joint: "fused" }),
    { label: "add part" },
  );
  assert.equal(getBenchHistoryState().undoLabel, "add part", "the node's label names the one step");
  assert.equal(getBenchSession().importedParts.size, 1);
  assert.equal(getBenchSession().assembly.nodes.length, 1);

  undoBench();
  assert.equal(getBenchSession().assembly, before.assembly);
  assert.equal(getBenchSession().importedParts, before.importedParts, "the mesh goes with its node");

  redoBench();
  assert.equal(getBenchSession().importedParts.size, 1);
  assert.equal(getBenchSession().assembly.nodes.length, 1);

  // The fold ends with the task: a later edit is its own step again.
  await nextTask();
  setBenchAssembly((a) => setAssemblyName(a, "Later"));
  undoBench();
  assert.equal(getBenchSession().assembly.nodes.length, 1);
});

test("two imports in one task stay two steps; a replacement never joins an import's step", () => {
  setBenchAssembly(plate());
  const first = { id: "imported:a", kind: "imported", name: "a.stl" };
  const second = { id: "imported:b", kind: "imported", name: "b.stl" };
  const attach = (id) => (a) =>
    addChild(a, { parentId: "root", partId: id, params: {}, slotName: "mount", joint: "fused" });
  setBenchImportedParts((m) => new Map(m).set(first.id, first));
  setBenchAssembly(attach(first.id));
  setBenchImportedParts((m) => new Map(m).set(second.id, second));
  setBenchAssembly(attach(second.id));
  undoBench();
  assert.deepEqual([...getBenchSession().importedParts.keys()], [first.id]);
  assert.equal(getBenchSession().assembly.nodes.length, 1);

  // An import and then Start over in the same task: undo brings back the
  // bench with the import, not the bench from before it.
  redoBench();
  const third = { id: "imported:c", kind: "imported", name: "c.stl" };
  setBenchImportedParts((m) => new Map(m).set(third.id, third));
  replaceBenchSession({ assembly: null, importedParts: new Map() });
  undoBench();
  assert.equal(getBenchSession().importedParts.has(third.id), true);
});

test("Start over is undoable, meshes and all", () => {
  const imported = { id: "imported:2", kind: "imported", name: "part.stl" };
  const importedParts = new Map([[imported.id, imported]]);
  replaceBenchSession({ assembly: plate(), importedParts });
  const bench = getBenchSession();
  replaceBenchSession({ assembly: null, importedParts: new Map() }, { label: "start over" });
  assert.equal(getBenchSession().assembly, null);
  assert.equal(getBenchHistoryState().undoLabel, "start over");
  undoBench();
  assert.equal(getBenchSession().assembly, bench.assembly);
  assert.equal(getBenchSession().importedParts, importedParts);
});

test("a replacement that changes nothing, or record: false, adds no step", () => {
  replaceBenchSession({ assembly: null, importedParts: new Map() });
  assert.equal(getBenchHistoryState().canUndo, false);
  replaceBenchSession({ assembly: plate(), importedParts: new Map() }, { record: false });
  assert.equal(getBenchHistoryState().canUndo, false);
});

test("the URL restore's notice survives until the next edit, and undo clears it", () => {
  setBenchAssembly(plate());
  replaceBenchSession(
    { assembly: null, importedParts: new Map(), notice: "That link's bench couldn't be restored." },
    { record: false },
  );
  assert.ok(getBenchSession().notice);
  undoBench();
  assert.equal(getBenchSession().notice, null);
});

test("clearBenchHistory forgets every step, and notifies", () => {
  setBenchAssembly(plate());
  let calls = 0;
  const off = subscribeBenchHistory(() => calls++);
  clearBenchHistory();
  off();
  assert.equal(calls, 1);
  assert.equal(undoBench(), false);
});

test("undo and redo notify session subscribers once each", () => {
  setBenchAssembly(plate());
  let calls = 0;
  const off = subscribeBenchSession(() => calls++);
  undoBench();
  redoBench();
  undoBench();
  undoBench(); // nothing left: no notification
  off();
  assert.equal(calls, 3);
});
