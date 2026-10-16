import test from "node:test";
import assert from "node:assert/strict";

import {
  SIDEBAR_WIDTH_DEFAULT,
  clampSidebarWidth,
  getSidebarWidth,
  setSidebarWidth,
  subscribeSidebarWidth,
} from "../../src/lib/uiPrefs.js";

test("the sidebar width is held between its limits and whole pixels", () => {
  assert.equal(clampSidebarWidth(100), 220);
  assert.equal(clampSidebarWidth(5000), 640);
  assert.equal(clampSidebarWidth(333.6), 334);
  assert.equal(clampSidebarWidth("abc"), SIDEBAR_WIDTH_DEFAULT);
});

test("setting the width notifies, clamped, and only on a change (no storage in Node is fine)", () => {
  assert.equal(getSidebarWidth(), SIDEBAR_WIDTH_DEFAULT);
  let calls = 0;
  const off = subscribeSidebarWidth(() => calls++);
  setSidebarWidth(9999, { persist: false });
  assert.equal(getSidebarWidth(), 640);
  setSidebarWidth(640);
  assert.equal(calls, 1);
  setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  off();
  assert.equal(calls, 2);
});

// --- Grid -------------------------------------------------------------------
// The grid is read from storage once and cached, so each case loads its
// own copy of the module (the query string makes it a separate one) over
// a storage it controls.
let fresh = 0;
async function gridPrefs(storage) {
  globalThis.localStorage = storage;
  return import(`../../src/lib/uiPrefs.js?grid=${fresh++}`);
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const GRID_KEY = "connector-foundry.gridSnap";

test("the grid defaults to 0.5 mm and offers TinkerCAD's values, Off first", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const prefs = await gridPrefs(memoryStorage());
  assert.deepEqual([...prefs.GRID_SNAP_OPTIONS], [0, 0.1, 0.25, 0.5, 1, 2, 5]);
  assert.equal(prefs.GRID_SNAP_DEFAULT, 0.5);
  assert.equal(prefs.getGridSnap(), 0.5);
});

test("a stored grid is read back; anything that isn't an option reads as the default", async (t) => {
  t.after(() => delete globalThis.localStorage);
  assert.equal((await gridPrefs(memoryStorage({ [GRID_KEY]: "2" }))).getGridSnap(), 2);
  assert.equal((await gridPrefs(memoryStorage({ [GRID_KEY]: "0" }))).getGridSnap(), 0);
  for (const bad of ["3", "abc", "", " ", "-1", "Infinity"]) {
    assert.equal((await gridPrefs(memoryStorage({ [GRID_KEY]: bad }))).getGridSnap(), 0.5, bad);
  }
});

test("setting the grid stores it only when not the default, and notifies on a change", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const storage = memoryStorage();
  const prefs = await gridPrefs(storage);
  let calls = 0;
  const off = prefs.subscribeGridSnap(() => calls++);
  prefs.setGridSnap(1);
  assert.equal(storage.map.get(GRID_KEY), "1");
  assert.equal(prefs.getGridSnap(), 1);
  prefs.setGridSnap(1);
  assert.equal(calls, 1);
  prefs.setGridSnap(7); // not an option: ignored
  prefs.setGridSnap(Number.NaN);
  assert.equal(prefs.getGridSnap(), 1);
  prefs.setGridSnap(0.5);
  assert.equal(storage.map.has(GRID_KEY), false);
  assert.equal(calls, 2);
  off();
});

test("blocked storage reads as the default and still takes a new value for the session", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const blocked = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const prefs = await gridPrefs(blocked);
  assert.equal(prefs.getGridSnap(), 0.5);
  prefs.setGridSnap(2);
  assert.equal(prefs.getGridSnap(), 2);
});

// --- Command palette recents ----------------------------------------------------
const RECENTS_KEY = "connector-foundry.commandRecents";

test("recent commands are read back newest first, and a bad stored value reads as none", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const stored = JSON.stringify(["app.settings", "part:basics/plate"]);
  const prefs = await gridPrefs(memoryStorage({ [RECENTS_KEY]: stored }));
  assert.deepEqual([...prefs.getCommandRecents()], ["app.settings", "part:basics/plate"]);
  for (const bad of ["not json", "{}", '"app.settings"', "null", "42"]) {
    const empty = await gridPrefs(memoryStorage({ [RECENTS_KEY]: bad }));
    assert.deepEqual([...empty.getCommandRecents()], [], bad);
  }
});

test("only short, printable ids are kept, once each, at most thirty", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const stored = [
    "a",
    7,
    null,
    "",
    "x".repeat(201),
    "line\nbreak",
    "a",
    "b",
    ...Array.from({ length: 40 }, (_, i) => `c${i}`),
  ];
  const prefs = await gridPrefs(memoryStorage({ [RECENTS_KEY]: JSON.stringify(stored) }));
  const recents = prefs.getCommandRecents();
  assert.equal(recents.length, prefs.COMMAND_RECENTS_MAX);
  assert.deepEqual(recents.slice(0, 3), ["a", "b", "c0"]);
});

test("running a command moves it to the front and stores the list", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const storage = memoryStorage({ [RECENTS_KEY]: JSON.stringify(["a", "b", "c"]) });
  const prefs = await gridPrefs(storage);
  prefs.recordCommandRecent("c");
  prefs.recordCommandRecent("d");
  assert.deepEqual([...prefs.getCommandRecents()], ["d", "c", "a", "b"]);
  assert.deepEqual(JSON.parse(storage.map.get(RECENTS_KEY)), ["d", "c", "a", "b"]);
  prefs.recordCommandRecent("bad\u0000id");
  assert.equal(prefs.getCommandRecents()[0], "d");
});

test("recents still work for the session when storage throws", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const broken = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {},
  };
  const prefs = await gridPrefs(broken);
  assert.deepEqual([...prefs.getCommandRecents()], []);
  prefs.recordCommandRecent("app.settings");
  assert.deepEqual([...prefs.getCommandRecents()], ["app.settings"]);
});
