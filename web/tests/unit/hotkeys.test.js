import test from "node:test";
import assert from "node:assert/strict";

import { RESERVED_CHORDS, chordKeys, chordOf, hotkeyProblem, parseChord } from "../../src/lib/hotkeys.js";

const keydown = (key, code, mods = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("a hotkey is Mod with Shift or Alt and one letter or digit, in any spelling", () => {
  assert.equal(parseChord("Mod+Shift+K"), "Mod+Shift+K");
  assert.equal(parseChord("shift + mod + k"), "Mod+Shift+K");
  assert.equal(parseChord("Alt+Mod+3"), "Mod+Alt+3");
  for (const bad of [
    "Mod+K", // too easily a browser's
    "Shift+K", // typing
    "Mod+Shift+Alt+K",
    "Mod+Shift+Enter",
    "Mod+Shift+F1",
    "Mod+Mod+K",
    "Ctrl+Shift+K", // Mod is the only primary modifier
    "",
    "Mod+Shift+",
    42,
    null,
  ]) {
    assert.equal(parseChord(bad), null, String(bad));
  }
  assert.deepEqual(chordKeys("Mod+Shift+K"), ["Mod", "Shift", "K"]);
});

test("a keydown's chord: Cmd on a Mac, Ctrl elsewhere", () => {
  assert.equal(chordOf(keydown("k", "KeyK", { metaKey: true, shiftKey: true }), true), "Mod+Shift+K");
  assert.equal(chordOf(keydown("K", "KeyK", { ctrlKey: true, shiftKey: true }), false), "Mod+Shift+K");
  // The other platform's modifier is not Mod.
  assert.equal(chordOf(keydown("k", "KeyK", { ctrlKey: true, shiftKey: true }), true), null);
  assert.equal(chordOf(keydown("k", "KeyK", { metaKey: true, shiftKey: true }), false), null);
  // Every modifier held comes out, so a three-modifier press matches no hotkey.
  assert.equal(
    chordOf(keydown("k", "KeyK", { metaKey: true, altKey: true, shiftKey: true }), true),
    "Mod+Alt+Shift+K",
  );
  // Not a letter or digit.
  assert.equal(chordOf(keydown("Enter", "Enter", { metaKey: true }), true), null);
});

test("Option and Shift change e.key, so the physical key is the fallback", () => {
  // Option+P types π on a Mac, Shift+1 types !.
  assert.equal(chordOf(keydown("π", "KeyP", { metaKey: true, altKey: true }), true), "Mod+Alt+P");
  assert.equal(chordOf(keydown("!", "Digit1", { ctrlKey: true, shiftKey: true }), false), "Mod+Shift+1");
  // e.key wins when it is a letter: a German layout's Z is where the US Y is.
  assert.equal(chordOf(keydown("z", "KeyY", { ctrlKey: true, shiftKey: true }), false), "Mod+Shift+Z");
});

test("a hotkey can't take what the app, the desktop app, the browser or the system has", () => {
  assert.equal(hotkeyProblem("Mod+Shift+L", { mac: true }), null);
  assert.equal(hotkeyProblem("Mod+Shift+L", { mac: false }), null);
  assert.match(hotkeyProblem("Mod+Shift+Z", { mac: true }), /Redo/);
  assert.match(hotkeyProblem("Mod+Shift+T", { mac: false }), /reopen tab/);
  // Platform-specific: macOS's screenshots, Firefox's console elsewhere.
  assert.match(hotkeyProblem("Mod+Shift+4", { mac: true }), /screenshots/);
  assert.equal(hotkeyProblem("Mod+Shift+4", { mac: false }), null);
  assert.match(hotkeyProblem("Mod+Shift+K", { mac: false }), /console/);
  assert.equal(hotkeyProblem("Mod+Shift+K", { mac: true }), null);
  assert.match(hotkeyProblem("Mod+Alt+H", { mac: true }), /Hide Others/);
  // Off the Mac, Ctrl+Alt is AltGr.
  assert.match(hotkeyProblem("Mod+Alt+L", { mac: false }), /AltGr/);
  assert.equal(hotkeyProblem("Mod+Alt+L", { mac: true }), null);
  assert.match(hotkeyProblem("Shift+K", { mac: true }), /not a hotkey/);
  // Taken by another of the user's.
  const taken = new Map([["Mod+Shift+L", "My bin"]]);
  assert.match(hotkeyProblem("mod+shift+l", { mac: true, taken }), /already runs "My bin"/);
});

test("every reserved chord is one a user could otherwise bind", () => {
  for (const { chord, owner } of RESERVED_CHORDS) {
    assert.equal(parseChord(chord), chord, chord);
    assert.ok(owner, chord);
  }
  assert.equal(
    new Set(RESERVED_CHORDS.map((r) => `${r.chord}${r.mac}${r.other}`)).size,
    RESERVED_CHORDS.length,
  );
});
