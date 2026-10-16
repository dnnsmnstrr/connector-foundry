// Hotkeys a user gives a command (userCommands.js): parsing, matching a
// keydown, and refusing chords that are already someone's.
//
// A user hotkey is always Mod plus Shift or Alt plus one letter or digit
// ("Mod+Shift+K", "Mod+Alt+3"). Mod is Cmd on a Mac and Ctrl elsewhere —
// the rule undoShortcut() (isEditableTarget.js) and the shortcuts sheet
// (shortcuts.js's "Mod" token) use. The narrow shape is deliberate: a
// single key or Shift+key is typing, Mod alone with a letter is nearly
// always a browser or editing shortcut (copy, find, print), and a chord
// that can't be typed on every layout can't be recorded either.

import { isMacPlatform } from "./isEditableTarget.js";

const KEY = /^[A-Z0-9]$/;

/**
 * A chord written as "Mod+Shift+K" (any case, any order, spaces allowed)
 * in its normal form — Mod, then Alt or Shift, then the key — or null when
 * it isn't one a user may bind.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseChord(text) {
  if (typeof text !== "string") return null;
  const parts = text
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 3) return null;
  let mod = false;
  let second = null;
  let key = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod") {
      if (mod) return null;
      mod = true;
    } else if (lower === "shift" || lower === "alt") {
      if (second) return null;
      second = lower === "shift" ? "Shift" : "Alt";
    } else {
      if (key) return null;
      key = part.toUpperCase();
    }
  }
  if (!mod || !second || !key || !KEY.test(key)) return null;
  return `Mod+${second}+${key}`;
}

/**
 * A normal-form chord as shortcuts.js tokens, for the key hints.
 * @param {string} chord
 * @returns {string[]}
 */
export function chordKeys(chord) {
  return chord.split("+");
}

/**
 * The chord a keydown is, in the same normal form — whatever modifiers are
 * held, so Mod+Alt+Shift+K comes out as itself and matches no user chord —
 * or null without Mod or without a letter or digit.
 *
 * The key is read from e.key when that is a plain letter or digit, which
 * follows the layout (a German keyboard's Z is where the US Y is, and the
 * user means the key labelled Z). Option on a Mac and Shift on a digit
 * change e.key ("π" for Option+P, "!" for Shift+1), so for those the
 * physical key (e.code) is the fallback.
 * @param {{ key?: string, code?: string, metaKey: boolean, ctrlKey: boolean,
 *   altKey: boolean, shiftKey: boolean }} e
 * @param {boolean} [mac]
 * @returns {string | null}
 */
export function chordOf(e, mac = isMacPlatform()) {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  let key = typeof e.key === "string" && e.key.length === 1 ? e.key.toUpperCase() : "";
  if (!KEY.test(key)) {
    const code = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? "");
    key = code ? (code[1] ?? code[2]) : "";
  }
  if (!KEY.test(key)) return null;
  return ["Mod", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/**
 * Chords a user hotkey must not take, with whose they are. Best-effort: the
 * app's own (undo is Mod+Z and Mod+Shift+Z; Mod+K opens the palette), the
 * desktop app's menu (web/desktop/main.cjs, roles only — Hide Others, the
 * developer tools), and the browser and system chords a page either cannot
 * override at all (Chrome keeps Mod+Shift+N, T, W and Q) or should not
 * (bookmarks, the developer tools, a hard reload). `mac` / `other` limit
 * one to a platform.
 * @type {readonly { chord: string, owner: string, mac?: boolean, other?: boolean }[]}
 */
export const RESERVED_CHORDS = Object.freeze([
  { chord: "Mod+Shift+Z", owner: "Redo" },
  { chord: "Mod+Shift+N", owner: "the browser's new private window" },
  { chord: "Mod+Shift+T", owner: "the browser's reopen tab" },
  { chord: "Mod+Shift+W", owner: "the browser's close window" },
  { chord: "Mod+Shift+Q", owner: "quitting or logging out" },
  { chord: "Mod+Shift+B", owner: "the browser's bookmarks bar" },
  { chord: "Mod+Shift+O", owner: "the browser's bookmarks" },
  { chord: "Mod+Shift+R", owner: "the browser's hard reload" },
  { chord: "Mod+Shift+A", owner: "the browser's tab search" },
  { chord: "Mod+Shift+M", owner: "the browser's profiles" },
  { chord: "Mod+Shift+D", owner: "the browser's bookmark all tabs" },
  { chord: "Mod+Shift+P", owner: "Firefox's private window" },
  { chord: "Mod+Shift+G", owner: "find previous" },
  { chord: "Mod+Shift+V", owner: "paste as plain text" },
  { chord: "Mod+Shift+3", owner: "macOS screenshots", mac: true },
  { chord: "Mod+Shift+4", owner: "macOS screenshots", mac: true },
  { chord: "Mod+Shift+5", owner: "macOS screenshots", mac: true },
  { chord: "Mod+Shift+J", owner: "the browser's console", other: true },
  { chord: "Mod+Shift+C", owner: "the browser's inspector", other: true },
  { chord: "Mod+Shift+I", owner: "the developer tools", other: true },
  { chord: "Mod+Shift+K", owner: "Firefox's console", other: true },
  { chord: "Mod+Shift+E", owner: "Firefox's network panel", other: true },
  { chord: "Mod+Shift+S", owner: "Firefox's screenshot", other: true },
  { chord: "Mod+Shift+Y", owner: "the browser's downloads", other: true },
  { chord: "Mod+Shift+H", owner: "Firefox's history", other: true },
  { chord: "Mod+Alt+H", owner: "macOS's Hide Others", mac: true },
  { chord: "Mod+Alt+M", owner: "macOS's minimise all", mac: true },
  { chord: "Mod+Alt+W", owner: "macOS's close all", mac: true },
  { chord: "Mod+Alt+D", owner: "macOS's Dock", mac: true },
  { chord: "Mod+Alt+I", owner: "the developer tools", mac: true },
  { chord: "Mod+Alt+J", owner: "the browser's console", mac: true },
  { chord: "Mod+Alt+C", owner: "the browser's inspector", mac: true },
  { chord: "Mod+Alt+U", owner: "the browser's page source", mac: true },
  { chord: "Mod+Alt+B", owner: "the browser's bookmarks", mac: true },
  { chord: "Mod+Alt+F", owner: "the browser's search", mac: true },
  { chord: "Mod+Alt+N", owner: "the browser's new window", mac: true },
]);

/**
 * Why a chord can't be a user hotkey, or null when it can.
 * @param {string} text the chord as written
 * @param {{ mac?: boolean, taken?: ReadonlyMap<string, string> }} [options] `taken`: normal-form
 *   chords already bound, to the title of what they run
 * @returns {string | null}
 */
export function hotkeyProblem(text, { mac = isMacPlatform(), taken = new Map() } = {}) {
  const chord = parseChord(text);
  if (!chord) return `"${text}" is not a hotkey: use Mod+Shift or Mod+Alt and a letter or digit`;
  // Off the Mac, Ctrl+Alt is AltGr: it is how "@" or "{" is typed on many layouts.
  if (!mac && chord.startsWith("Mod+Alt+")) {
    return `${chord} types characters on many keyboards (AltGr): use Mod+Shift instead`;
  }
  const reserved = RESERVED_CHORDS.find((r) => r.chord === chord && !(mac ? r.other : r.mac));
  if (reserved) return `${chord} is ${reserved.owner}'s`;
  const owner = taken.get(chord);
  if (owner) return `${chord} already runs "${owner}"`;
  return null;
}
