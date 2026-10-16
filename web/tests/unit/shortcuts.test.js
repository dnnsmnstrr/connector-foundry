import test from "node:test";
import assert from "node:assert/strict";

import {
  SHORTCUT_SECTIONS,
  chordTokens,
  isKnownToken,
  platformText,
  shortcutSections,
} from "../../src/lib/shortcuts.js";

// What a chord reads as: kbd tokens bare, pointer tokens in brackets.
const shown = (tokens) => tokens.map((t) => (t.kbd ? t.text : `[${t.text}]`)).join(" + ");

test("the sheet has its eight sections, each with rows", () => {
  assert.deepEqual(
    SHORTCUT_SECTIONS.map((s) => s.title),
    ["Anywhere", "Command palette", "Library", "Bench", "Holes", "3D view", "Handles", "Mouse and touch"],
  );
  for (const section of SHORTCUT_SECTIONS) assert.ok(section.rows.length > 0, section.title);
});

test("every token in the table is one the sheet knows how to show", () => {
  for (const section of SHORTCUT_SECTIONS) {
    for (const row of section.rows) {
      assert.ok(row.keys.length > 0 && row.action, `${section.title}: ${row.action}`);
      for (const chord of [...row.keys, ...(row.macKeys ?? [])]) {
        assert.ok(chord.length > 0, `${section.title}: ${row.action}`);
        for (const token of chord) assert.ok(isKnownToken(token), `${section.title}: unknown "${token}"`);
      }
    }
  }
  assert.equal(isKnownToken("Shfit"), false);
  assert.equal(isKnownToken("constructor"), false);
  assert.equal(isKnownToken("?"), true);
});

test("a Mac is told about Cmd and Option, everyone else about Ctrl and Alt", () => {
  assert.equal(shown(chordTokens(["Mod", "Z"], true)), "⌘ Cmd + Z");
  assert.equal(shown(chordTokens(["Mod", "Z"], false)), "Ctrl + Z");
  // Each platform's own modifier order, whatever order the table wrote.
  assert.equal(shown(chordTokens(["Mod", "Shift", "Z"], true)), "⇧ Shift + ⌘ Cmd + Z");
  assert.equal(shown(chordTokens(["Mod", "Shift", "Z"], false)), "Ctrl + Shift + Z");
  assert.equal(shown(chordTokens(["Shift", "Alt", "Ctrl", "X"], true)), "⌃ Control + ⌥ Option + ⇧ Shift + X");
  assert.equal(shown(chordTokens(["Alt", "Drag"], false)), "Alt + [Drag]");
  assert.equal(shown(chordTokens(["Shift", "Left-drag"], true)), "⇧ Shift + [Left-drag]");
  assert.equal(shown(chordTokens(["Arrows"], false)), "← → ↑ ↓");
  // The palette's compact hints: glyphs alone on a Mac.
  assert.equal(shown(chordTokens(["Mod", "Shift", "K"], true, true)), "⇧ + ⌘ + K");
  assert.equal(shown(chordTokens(["Mod", "Enter"], false, true)), "Ctrl + ↵");

  assert.equal(platformText("{Alt}: from the centre", true), "Option: from the centre");
  assert.equal(platformText("{Alt}: from the centre", false), "Alt: from the centre");
  assert.equal(platformText("{Mod}+{Shift} {Ctrl}", true), "Cmd+Shift Control");
  assert.equal(platformText("no keys here", false), "no keys here");
});

test("redo is Shift+Cmd+Z on a Mac, and Ctrl+Y as well elsewhere", () => {
  const redo = (mac) =>
    shortcutSections(mac)
      .find((s) => s.title === "Anywhere")
      .rows.find((r) => r.action === "Redo")
      .chords.map(shown);
  assert.deepEqual(redo(true), ["⇧ Shift + ⌘ Cmd + Z"]);
  assert.deepEqual(redo(false), ["Ctrl + Shift + Z", "Ctrl + Y"]);
});

test("every key on the resolved sheet has a label on either platform", () => {
  // A modifier missing from one platform's label table would show as an
  // empty key cap (labels[token] is undefined) rather than fail anywhere.
  for (const mac of [true, false]) {
    for (const section of shortcutSections(mac)) {
      for (const row of section.rows) {
        assert.ok(row.chords.length > 0, `${section.title}: ${row.action}`);
        for (const token of row.chords.flat()) {
          assert.equal(typeof token.text, "string", `${section.title}: ${row.action}`);
          assert.ok(token.text.length > 0, `${section.title}: ${row.action}`);
        }
      }
    }
  }
  // A placeholder for a key the platform tables don't name is left as
  // written rather than turned into "undefined".
  assert.equal(platformText("{Meta}", true), "{Meta}");
});

test("the resolved sheet has no placeholder left on either platform", () => {
  for (const mac of [true, false]) {
    for (const section of shortcutSections(mac)) {
      for (const text of [section.note ?? "", ...section.rows.map((r) => r.action)]) {
        assert.doesNotMatch(text, /\{\w+\}/, `${section.title}: ${text}`);
      }
    }
  }
  const handles = shortcutSections(true).find((s) => s.title === "Handles");
  assert.match(handles.note, /Option: from the centre/);
});

test("the keys the listeners take are all on the sheet", () => {
  // The keys App.jsx, Bench.jsx, Holes.jsx, StlViewer.jsx and the undo
  // hooks act on: a key missing here is one nobody can find out about.
  const keys = new Set(SHORTCUT_SECTIONS.flatMap((s) => s.rows.flatMap((r) => r.keys.flat())));
  for (const key of [
    "K",
    "1",
    "2",
    "3",
    "/",
    "[",
    "S",
    "?",
    "Esc",
    "H",
    "F",
    "M",
    "Delete",
    "Arrows",
    "Z",
    "Y",
  ]) {
    assert.ok(keys.has(key), key);
  }
});
