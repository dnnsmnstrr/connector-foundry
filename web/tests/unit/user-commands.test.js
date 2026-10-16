import test from "node:test";
import assert from "node:assert/strict";

import { checkUserCommands, hotkeyRows, USER_COMMANDS_MAX } from "../../src/lib/userCommands.js";

const doc = (commands = [], bindings) => ({ version: 1, commands, ...(bindings ? { bindings } : {}) });
const bin = {
  id: "my-bin",
  title: "My 2x3 bin",
  alias: "bin",
  hotkey: "mod+shift+l",
  action: { kind: "open-part", partId: "gridfinity/bin", params: { gridx: 2, gridy: 3 }, target: "library" },
};
const check = (raw) => checkUserCommands(raw, { mac: true });

test("a valid document is kept, from its JSON text too, with the hotkey written out", () => {
  for (const raw of [doc([bin]), JSON.stringify(doc([bin]))]) {
    const set = check(raw);
    assert.deepEqual(set.problems, []);
    assert.equal(set.commands.length, 1);
    const [command] = set.commands;
    assert.equal(command.id, "my-bin");
    assert.equal(command.alias, "bin");
    assert.equal(command.hotkey, "Mod+Shift+L");
    assert.deepEqual(command.action.params, { gridx: 2, gridy: 3 });
  }
});

test("nothing stored is no commands; something unreadable says so", () => {
  assert.deepEqual(check(null), { commands: [], bindings: new Map(), problems: [] });
  assert.equal(check("{not json").problems.length, 1);
  assert.equal(check({ version: 2, commands: [bin] }).commands.length, 0);
  assert.equal(check([bin]).problems.length, 1);
});

test("a bad entry is left out with a reason, and the good ones around it stay", () => {
  const set = check(
    doc([
      bin,
      { ...bin, id: "my-bin", alias: undefined, hotkey: undefined }, // id used twice
      { ...bin, id: "Bad Id" },
      { ...bin, id: "no-title", title: "  " },
      { ...bin, id: "long-title", title: "x".repeat(81) },
      { ...bin, id: "no-kind", action: { kind: "format-disk" } },
      "not an object",
      { id: "ok", title: "Holes", action: { kind: "view", mode: "holes" } },
    ]),
  );
  assert.deepEqual(
    set.commands.map((c) => c.id),
    ["my-bin", "ok"],
  );
  assert.equal(set.problems.length, 6);
});

test("links are http or https, nothing else", () => {
  const link = (url) => check(doc([{ id: "l", title: "Link", action: { kind: "link", url } }]));
  assert.equal(link("https://example.com/docs").commands.length, 1);
  assert.equal(link("http://localhost:8080").commands.length, 1);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "not a url", 42]) {
    const set = link(url);
    assert.equal(set.commands.length, 0, String(url));
    assert.equal(set.problems.length, 1, String(url));
  }
});

test("a part's parameters must be ones the code generator can write", () => {
  const part = (params, target) =>
    check(
      doc([
        { id: "p", title: "Part", action: { kind: "open-part", partId: "basics/plate", params, target } },
      ]),
    ).commands.length;
  assert.equal(part({ w: 40, label: "A", on: true, list: [1, 2] }), 1);
  assert.equal(part(undefined, "holes"), 1);
  assert.equal(part({ w: Infinity }), 0);
  assert.equal(part({ "w); evil(": 1 }), 0);
  assert.equal(part({ w: { nested: 1 } }), 0);
  assert.equal(part({ w: 1 }, "elsewhere"), 0);
});

test("a hole type must be one the app has; a command may not run another of the user's", () => {
  const hole = (presetId) =>
    check(doc([{ id: "h", title: "Hole", action: { kind: "hole-preset", presetId } }])).commands.length;
  assert.equal(hole("m3-cap"), 1);
  assert.equal(hole("m99-made-up"), 0);
  const run = (id) =>
    check(doc([{ id: "c", title: "Run", action: { kind: "command", id } }])).commands.length;
  assert.equal(run("app.settings"), 1);
  assert.equal(run("user:c"), 0);
});

test("aliases are short, lowercase and used once, across commands and bindings", () => {
  const set = check(
    doc(
      [
        bin,
        { ...bin, id: "two", hotkey: undefined }, // alias "bin" again
        { ...bin, id: "three", alias: "Has Space", hotkey: undefined },
      ],
      { "app.settings": { alias: "BIN" }, "app.github": { alias: "gh" } },
    ),
  );
  // The duplicate and malformed aliases are dropped, not their commands.
  assert.deepEqual(
    set.commands.map((c) => [c.id, c.alias]),
    [
      ["my-bin", "bin"],
      ["two", undefined],
      ["three", undefined],
    ],
  );
  assert.equal(set.bindings.get("app.github").alias, "gh");
  assert.equal(set.bindings.has("app.settings"), false);
  assert.equal(set.problems.length, 3);
});

test("hotkeys: only the allowed shape, nothing reserved, nothing twice", () => {
  const set = check(
    doc(
      [
        bin, // Mod+Shift+L
        { ...bin, id: "again", alias: undefined }, // Mod+Shift+L again
        { ...bin, id: "redo", alias: undefined, hotkey: "Mod+Shift+Z" },
        { ...bin, id: "plain", alias: undefined, hotkey: "K" },
      ],
      { "view.fit": { hotkey: "Mod+Alt+F" }, "app.settings": { hotkey: "Mod+Alt+S" } },
    ),
  );
  assert.deepEqual(
    set.commands.map((c) => c.hotkey),
    ["Mod+Shift+L", undefined, undefined, undefined],
  );
  // Mod+Alt+F is the browser's search on a Mac; Mod+Alt+S is free.
  assert.equal(set.bindings.has("view.fit"), false);
  assert.equal(set.bindings.get("app.settings").hotkey, "Mod+Alt+S");
  assert.equal(set.problems.length, 4);
  // Off the Mac, Ctrl+Alt is AltGr.
  const other = checkUserCommands(doc([], { "app.settings": { hotkey: "Mod+Alt+S" } }), { mac: false });
  assert.equal(other.bindings.size, 0);
});

test("bindings name built-in commands only", () => {
  const set = check(doc([], { "no.such": { alias: "x" }, "app.settings": "prefs" }));
  assert.equal(set.bindings.size, 0);
  assert.equal(set.problems.length, 2);
});

test("at most a hundred commands are kept", () => {
  const many = Array.from({ length: USER_COMMANDS_MAX + 5 }, (_, i) => ({
    id: `c${i}`,
    title: `Command ${i}`,
    action: { kind: "view", mode: "bench" },
  }));
  const set = check(doc(many));
  assert.equal(set.commands.length, USER_COMMANDS_MAX);
  assert.equal(set.problems.length, 1);
});

test("the shortcuts sheet's rows: each hotkey with what it runs", () => {
  const set = check(doc([bin], { "app.settings": { hotkey: "Mod+Alt+S" } }));
  assert.deepEqual(hotkeyRows(set), [
    { title: "My 2x3 bin", keys: ["Mod", "Shift", "L"] },
    { title: "Open Settings", keys: ["Mod", "Alt", "S"] },
  ]);
});

// --- The store --------------------------------------------------------------------
let fresh = 0;
async function store(storage) {
  globalThis.localStorage = storage;
  return import(`../../src/lib/userCommands.js?store=${fresh++}`);
}

test("the store reads what is saved, re-reads after a save, and tells its listeners", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const map = new Map();
  const lib = await store({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  });
  assert.equal(lib.getUserCommands().commands.length, 0);
  let calls = 0;
  lib.subscribeUserCommands(() => calls++);
  assert.equal(
    lib.setUserCommands(doc([{ id: "a", title: "A", action: { kind: "view", mode: "holes" } }])),
    null,
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    lib.getUserCommands().commands.map((c) => c.id),
    ["a"],
  );
  lib.setUserCommands(null);
  assert.equal(map.has(lib.USER_COMMANDS_KEY), false);
  assert.equal(lib.getUserCommands().commands.length, 0);
});

test("storage that throws reads as no commands", async (t) => {
  t.after(() => delete globalThis.localStorage);
  const lib = await store({
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {},
  });
  assert.equal(lib.getUserCommands().commands.length, 0);
  assert.match(lib.setUserCommands(doc()), /isn't letting/);
});
