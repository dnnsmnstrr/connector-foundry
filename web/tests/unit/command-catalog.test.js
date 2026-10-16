import test from "node:test";
import assert from "node:assert/strict";

import { BUILTIN_COMMANDS, SECTION_ORDER, builtin, partCommand } from "../../src/lib/commandCatalog.js";
import { SHORTCUT_SECTIONS, isKnownToken } from "../../src/lib/shortcuts.js";

test("every built-in command has a title and a section the palette orders", () => {
  for (const [id, meta] of Object.entries(BUILTIN_COMMANDS)) {
    assert.ok(meta.title, id);
    assert.ok(SECTION_ORDER.includes(meta.section), `${id}: section "${meta.section}"`);
  }
  assert.equal(new Set(SECTION_ORDER).size, SECTION_ORDER.length);
});

test("every key hint is a chord the shortcuts sheet lists", () => {
  // The palette shows these next to a command; the sheet is what the
  // listeners actually do (shortcuts.js). A hint that isn't on the sheet
  // is a key that does something else, or nothing.
  const sheet = new Set(
    SHORTCUT_SECTIONS.flatMap((s) => s.rows.flatMap((r) => [...r.keys, ...(r.macKeys ?? [])])).map((chord) =>
      chord.join("+"),
    ),
  );
  for (const [id, meta] of Object.entries(BUILTIN_COMMANDS)) {
    for (const chord of meta.keys ?? []) {
      for (const token of chord) assert.ok(isKnownToken(token), `${id}: unknown token "${token}"`);
      assert.ok(sheet.has(chord.join("+")), `${id}: ${chord.join("+")} is not on the shortcuts sheet`);
    }
  }
});

test("builtin() binds behaviour to the catalogue's metadata", () => {
  const ran = [];
  const settings = builtin("app.settings", { run: () => ran.push("settings"), keywords: ["gear"] });
  assert.equal(settings.title, "Open Settings");
  assert.equal(settings.section, "Settings");
  assert.deepEqual(settings.keys, [["S"]]);
  assert.ok(settings.keywords.includes("preferences") && settings.keywords.includes("gear"));
  assert.equal(settings.actions[0].title, "Open");
  settings.actions[0].run();
  assert.deepEqual(ran, ["settings"]);
  // The catalogue's arrays are copies: a binding can't change the table.
  settings.keys[0].push("X");
  assert.deepEqual(BUILTIN_COMMANDS["app.settings"].keys, [["S"]]);

  assert.equal(builtin("app.cancelRenders", { when: false }), null);
  // A binding left undefined keeps the catalogue's value.
  assert.equal(builtin("app.settings", { title: undefined }).title, "Open Settings");
  const renamed = builtin("app.github", { id: "app.github:2", title: "Somewhere else" });
  assert.equal(renamed.id, "app.github:2");
  assert.equal(renamed.title, "Somewhere else");
});

test("a part row reads as the part lists do: name, then its confidence", () => {
  const part = { id: "basics/plate", name: "Flat plate", system: "Basics", confidence: "exact" };
  const row = partCommand(part, { id: "part:basics/plate", actions: [], searchOnly: true });
  assert.equal(row.title, "Flat plate");
  assert.equal(row.badge, "exact");
  assert.equal(row.subtitle, "Basics");
  assert.ok(row.keywords.includes("basics/plate"));
  assert.equal(row.searchOnly, true);
  // An imported mesh has no system.
  const mesh = partCommand(
    { id: "import:1", name: "bracket.stl", confidence: "imported" },
    { id: "m", actions: [] },
  );
  assert.equal(mesh.subtitle, "Imported");
});
