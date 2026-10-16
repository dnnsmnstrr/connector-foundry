import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  ignoresHotkey,
  ignoresUndoShortcut,
  isMacPlatform,
  isTextEntry,
  paletteShortcut,
  pickerUndoKey,
  undoShortcut,
} from "../../src/lib/isEditableTarget.js";
import { undoKeyListener } from "../../src/hooks/useUndoShortcuts.js";

// Just enough of a document for isBehindOpenDialog(): whether a modal
// <dialog> is open, and what it contains.
let openDialog = null;
beforeEach(() => {
  openDialog = null;
  globalThis.document = /** @type {any} */ ({
    querySelector: (selector) => (selector === "dialog[open]" ? openDialog : null),
  });
});
afterEach(() => {
  delete globalThis.document;
});

const input = (type) => ({ tagName: "INPUT", type });
// A keydown as the listener sees it, recording preventDefault().
function key(k, mods = {}, target = { tagName: "BODY" }) {
  return {
    key: k,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...mods,
  };
}

test("text entry is text-like inputs, textareas and contentEditable — not checkboxes or selects", () => {
  for (const type of ["text", "search", "number", "email", "url", "tel", "password", "TEXT", undefined, ""]) {
    assert.equal(isTextEntry(input(type)), true, `input type=${type}`);
  }
  for (const type of ["checkbox", "radio", "range", "button", "file", "color"]) {
    assert.equal(isTextEntry(input(type)), false, `input type=${type}`);
  }
  assert.equal(isTextEntry({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntry({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTextEntry({ tagName: "SELECT" }), false);
  assert.equal(isTextEntry({ tagName: "BUTTON" }), false);
  assert.equal(isTextEntry(null), false);
});

test("Cmd+Z undoes on a Mac, Shift redoes; Ctrl+Z there is not ours", () => {
  assert.equal(undoShortcut(key("z", { metaKey: true }), true), "undo");
  assert.equal(undoShortcut(key("Z", { metaKey: true, shiftKey: true }), true), "redo");
  assert.equal(undoShortcut(key("z", { metaKey: true, shiftKey: true }), true), "redo");
  assert.equal(undoShortcut(key("z", { ctrlKey: true }), true), null);
  assert.equal(undoShortcut(key("y", { metaKey: true }), true), null);
});

test("Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y elsewhere", () => {
  assert.equal(undoShortcut(key("z", { ctrlKey: true }), false), "undo");
  assert.equal(undoShortcut(key("Z", { ctrlKey: true, shiftKey: true }), false), "redo");
  assert.equal(undoShortcut(key("y", { ctrlKey: true }), false), "redo");
  assert.equal(undoShortcut(key("Y", { ctrlKey: true }), false), "redo");
  assert.equal(undoShortcut(key("z", { metaKey: true }), false), null);
});

test("Alt, a bare key, or another letter is not undo", () => {
  assert.equal(undoShortcut(key("z", { ctrlKey: true, altKey: true }), false), null);
  assert.equal(undoShortcut(key("z", { metaKey: true, altKey: true }), true), null);
  assert.equal(undoShortcut(key("z"), false), null);
  assert.equal(undoShortcut(key("x", { ctrlKey: true }), false), null);
  assert.equal(undoShortcut(key("Unidentified", { ctrlKey: true }), false), null);
});

test("the key, not the physical position, decides (QWERTZ swaps Y and Z)", () => {
  // On a German layout the key labelled Z sits where KeyY is; e.key is "z".
  assert.equal(undoShortcut({ ...key("z", { ctrlKey: true }), code: "KeyY" }, false), "undo");
});

test("the Mac is told apart by navigator.platform", (t) => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (real) Object.defineProperty(globalThis, "navigator", real);
    else delete globalThis.navigator;
  });
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel" }, configurable: true });
  assert.equal(isMacPlatform(), true);
  Object.defineProperty(globalThis, "navigator", { value: { platform: "Win32" }, configurable: true });
  assert.equal(isMacPlatform(), false);
});

test("undo keys in a text field or behind a dialog belong to them", () => {
  assert.equal(ignoresUndoShortcut(key("z", {}, input("text"))), true);
  assert.equal(ignoresUndoShortcut(key("z", {}, input("checkbox"))), false);
  assert.equal(ignoresUndoShortcut(key("z", {}, { tagName: "SELECT" })), false);
  const canvas = { tagName: "CANVAS" };
  openDialog = { contains: (el) => el === canvas };
  assert.equal(ignoresUndoShortcut(key("z")), true, "behind Settings");
  assert.equal(ignoresUndoShortcut(key("z"), canvas), false, "a viewer inside the dialog");
});

test("a number field whose text the app set has no undo of its own: the tab's takes the key", () => {
  // DecimalInput after an arrow step: the browser has no typing to undo.
  const stepped = { ...input("text"), dataset: { nativeUndo: "false" } };
  assert.equal(ignoresUndoShortcut(key("z", {}, stepped)), false);
  // Typed into: its own undo.
  assert.equal(ignoresUndoShortcut(key("z", {}, { ...input("text"), dataset: {} })), true);
  // Behind a dialog it is still the dialog's.
  openDialog = { contains: () => false };
  assert.equal(ignoresUndoShortcut(key("z", {}, stepped)), true);
});

test("a part picker's search takes the tab's undo keys until something is typed into it", () => {
  const search = input("text");
  const mac = isMacPlatform();
  const mod = mac ? { metaKey: true } : { ctrlKey: true };
  assert.equal(pickerUndoKey(key("z", mod, search), false, mac), "undo");
  assert.equal(pickerUndoKey(key("z", { ...mod, shiftKey: true }, search), false, mac), "redo");
  // Typed into: the field's own undo has something to take back.
  assert.equal(pickerUndoKey(key("z", mod, search), true, mac), null);
  // A key already taken, a key that isn't undo, a target that isn't text.
  assert.equal(pickerUndoKey({ ...key("z", mod, search), defaultPrevented: true }, false, mac), null);
  assert.equal(pickerUndoKey(key("s", mod, search), false, mac), null);
  assert.equal(pickerUndoKey(key("z", mod, { tagName: "SELECT" }), false, mac), null);
});

test("the hook's listener cancels every undo key it takes, even with nothing to undo", () => {
  const calls = [];
  const listener = undoKeyListener({
    current: { onUndo: () => calls.push("undo"), onRedo: () => calls.push("redo") },
  });
  const mac = isMacPlatform();
  const mod = mac ? { metaKey: true } : { ctrlKey: true };

  const undo = key("z", mod);
  listener(undo);
  assert.equal(undo.defaultPrevented, true);
  const redo = key("z", { ...mod, shiftKey: true });
  listener(redo);
  assert.deepEqual(calls, ["undo", "redo"]);

  // A text field keeps its own undo: not cancelled, not handled.
  const typing = key("z", mod, input("text"));
  listener(typing);
  assert.equal(typing.defaultPrevented, false);
  // Something nearer the target already took it.
  const taken = { ...key("z", mod), defaultPrevented: true };
  listener(taken);
  // Not an undo key at all.
  const other = key("s", mod);
  listener(other);
  assert.equal(other.defaultPrevented, false);
  assert.deepEqual(calls, ["undo", "redo"]);
});

test("Mod+K is the palette: Cmd on a Mac, Ctrl elsewhere, nothing else held", () => {
  assert.equal(paletteShortcut(key("k", { metaKey: true }), true), true);
  assert.equal(paletteShortcut(key("K", { ctrlKey: true }), false), true);
  // The other platform's modifier.
  assert.equal(paletteShortcut(key("k", { ctrlKey: true }), true), false);
  assert.equal(paletteShortcut(key("k", { metaKey: true }), false), false);
  // Shift or Alt makes it another chord (a user hotkey may be Mod+Shift+K).
  assert.equal(paletteShortcut(key("k", { metaKey: true, shiftKey: true }), true), false);
  assert.equal(paletteShortcut(key("k", { ctrlKey: true, altKey: true }), false), false);
  assert.equal(paletteShortcut(key("k"), true), false);
  // A layout whose K key types something else with the modifier held.
  assert.equal(paletteShortcut({ ...key("л", { ctrlKey: true }), code: "KeyK" }, false), true);
});

test("a user hotkey leaves repeats, taken keys, open dialogs and AltGr alone", () => {
  const mod = { metaKey: true, shiftKey: true };
  assert.equal(ignoresHotkey(key("l", mod)), false);
  assert.equal(ignoresHotkey(key("l", { ...mod, repeat: true })), true);
  assert.equal(ignoresHotkey(key("l", { ...mod, defaultPrevented: true })), true);
  assert.equal(
    ignoresHotkey(key("q", { ctrlKey: true, altKey: true, getModifierState: (k) => k === "AltGraph" })),
    true,
  );
  openDialog = { contains: () => false };
  assert.equal(ignoresHotkey(key("l", mod)), true);
});
