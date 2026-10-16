import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  clearLibraryHistory,
  getLibraryHistoryState,
  recordLibrary,
  redoLibrary,
  subscribeLibraryHistory,
  undoLibrary,
} from "../../src/lib/librarySession.js";

beforeEach(() => clearLibraryHistory());

test("a part switch and a parameter edit undo in order, and redo back", () => {
  const plate = { partId: "basics/plate", params: { w: 40 } };
  const wider = { partId: "basics/plate", params: { w: 60 } };
  const post = { partId: "basics/post", params: { dia: 10 } };
  recordLibrary(plate, { key: "param:w", label: "change w" });
  recordLibrary(wider, { label: "pick part" });
  assert.equal(getLibraryHistoryState().undoLabel, "pick part");

  assert.equal(undoLibrary(post), wider);
  assert.equal(undoLibrary(wider), plate);
  assert.equal(undoLibrary(plate), undefined);
  assert.equal(redoLibrary(plate), wider);
  assert.equal(redoLibrary(wider), post);
});

test("keystrokes in one field coalesce", () => {
  const start = { partId: "basics/plate", params: { w: 40 } };
  recordLibrary(start, { key: "param:w" });
  recordLibrary({ partId: "basics/plate", params: { w: 1 } }, { key: "param:w" });
  recordLibrary({ partId: "basics/plate", params: { w: 12 } }, { key: "param:w" });
  assert.equal(undoLibrary({ partId: "basics/plate", params: { w: 120 } }), start);
  assert.equal(getLibraryHistoryState().canUndo, false);
});

test("the history outlives any component: it is module state, read through state/subscribe", () => {
  let calls = 0;
  const off = subscribeLibraryHistory(() => calls++);
  recordLibrary({ partId: "a", params: {} });
  off();
  assert.equal(calls, 1);
  assert.deepEqual(getLibraryHistoryState(), {
    canUndo: true,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  });
});
