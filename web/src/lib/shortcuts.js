// The keyboard-shortcuts sheet (components/ShortcutsModal.jsx, opened with
// "?", from Settings or from the palette) as one table, so the sheet is written in one
// place and a unit test can check it, rather than spread over JSX. It
// describes what the listeners do — App.jsx's shell keys, Bench.jsx's and
// Holes.jsx's selection keys, StlViewer's view keys and resize handles, the
// undo hooks, the command palette's keys — so a change to one of those is a
// change to a row here too. The palette shows the same keys as hints on its
// commands (commandCatalog.js), and a unit test holds those to this table.
//
// A row's `keys` are its alternatives, each a chord of tokens pressed
// together. "Mod" is Cmd on a Mac and Ctrl elsewhere — the modifier the undo
// shortcut reads, decided by the same isMacPlatform() (isEditableTarget.js),
// so the sheet can't name a key the listener ignores; `macKeys` replaces
// `keys` on a Mac where the two differ (Ctrl+Y redoes only elsewhere — on a
// Mac it is not an undo key at all).
// A chord's modifiers are put in the platform's own order when shown (⌃⌥⇧⌘
// on a Mac, Ctrl+Alt+Shift elsewhere), so the table can write them in any.
// Tokens in POINTER_TOKENS are things done with the pointer ("Left-drag",
// the viewer's "View ▾" menu) and show as plain text; every other token is
// a key and shows as a <kbd>. `{Mod}`, `{Alt}`, `{Ctrl}` and `{Shift}` in an
// action or a note become the platform's name for that key.

import { isMacPlatform } from "./isEditableTarget.js";

/**
 * @typedef {{ keys: string[][], macKeys?: string[][], action: string }} ShortcutRow
 * @typedef {{ title: string, rows: ShortcutRow[], note?: string }} ShortcutSection
 * @typedef {{ text: string, kbd: boolean, key: string }} ShortcutToken `key` is the table's own
 *   token ("Mod", "Alt"), which a search finds as well as what is shown
 * @typedef {{ chords: ShortcutToken[][], action: string }} ResolvedShortcutRow
 * @typedef {{ title: string, rows: ResolvedShortcutRow[], note: string | null }} ResolvedShortcutSection
 */

/** @type {ShortcutSection[]} */
export const SHORTCUT_SECTIONS = [
  {
    title: "Anywhere",
    rows: [
      { keys: [["Mod", "K"]], action: "Open the command palette, or close it" },
      { keys: [["1"], ["2"], ["3"]], action: "Switch to the Library, the Bench or Holes" },
      { keys: [["/"]], action: "Search the Library's parts" },
      { keys: [["["]], action: "Show or hide the sidebar" },
      { keys: [["S"]], action: "Open Settings" },
      { keys: [["?"]], action: "Show this list" },
      { keys: [["Esc"]], action: "Close a dialog or a menu" },
      {
        keys: [["Mod", "Z"]],
        action: "Undo — each tab keeps its own history; in a text field, it undoes the typing",
      },
      {
        keys: [
          ["Mod", "Shift", "Z"],
          ["Ctrl", "Y"],
        ],
        macKeys: [["Mod", "Shift", "Z"]],
        action: "Redo",
      },
      { keys: [["Up/Down"]], action: "Step a number field (Shift: ten steps)" },
    ],
  },
  {
    title: "Command palette",
    rows: [
      {
        keys: [["Up/Down"]],
        macKeys: [["Up/Down"], ["Ctrl", "N"], ["Ctrl", "P"]],
        action: "Move through the list",
      },
      { keys: [["Enter"]], action: "Run the highlighted command" },
      {
        keys: [["Mod", "Enter"]],
        action: "Run its second action — Open in Bench for a part, Copy link for a link",
      },
      { keys: [["Alt", "Enter"]], action: "Run its third action — Add holes, for a part" },
      { keys: [["→"]], action: "Show all of its actions (with the cursor at the end of the search)" },
      { keys: [["Esc"]], action: "Clear the search, then go back a list, then close" },
      { keys: [["Backspace"]], action: "Go back a list (with the search empty)" },
    ],
    note:
      'Type part of a name, or the first letters of its words: "oib" finds Open in Bench. What you ' +
      "ran lately comes first. On a command's actions, Enter runs the highlighted one and " +
      "{Mod}+Enter and {Alt}+Enter the second and third, whichever is highlighted. The Bench's and " +
      "Holes' part pickers are the same list.",
  },
  {
    title: "Library",
    rows: [
      {
        keys: [["Mod", "Z"]],
        action: "Undo a resize or another parameter change, or a switch to another part",
      },
    ],
    note:
      "The square handles on the part resize it: width and depth grow on both sides, so it stays " +
      "centred, and height grows upward. Rest the pointer on one to read its size.",
  },
  {
    title: "Bench",
    rows: [
      { keys: [["Click"]], action: "Select a part, the base part too; a marker attaches a part there" },
      { keys: [["Esc"]], action: "Cancel a move, or drop the selection" },
      {
        keys: [["Delete"], ["Backspace"]],
        action: "Remove the selected part and everything on it (never the base part)",
      },
      { keys: [["M"]], action: "Move the selected part: then click the slot it goes to" },
      { keys: [["Arrows"]], action: "Step the selected part to the next open slot that way" },
      { keys: [["Mod", "Z"]], action: "Undo — a removed part, Start over and a loaded config too" },
    ],
    note:
      "Handles resize the base part (click it, or Select root); a size that would take a slot from " +
      "an attached part steps past it. An attached part is resized in the sidebar.",
  },
  {
    title: "Holes",
    rows: [
      { keys: [["Click"]], action: "Drill a hole in a face — it snaps to the face's points and lines" },
      { keys: [["Shift", "Click"]], action: "On a face: place exactly there. On holes: select several" },
      { keys: [["Alt"]], action: "Hold to measure the spot's distances to the face's edges and centre" },
      { keys: [["M"]], action: "Turn Measure on or off: the same distances without holding Alt" },
      { keys: [["Drag"]], action: "The selected hole's round centre handle moves it (Shift: off the grid)" },
      {
        keys: [["Drag"]],
        action: "A cutout's square handles resize it, keeping the opposite edge ({Alt}: from the centre)",
      },
      { keys: [["Arrows"]], action: "Nudge the selected holes one grid step along their face (Shift: ten)" },
      { keys: [["Delete"], ["Backspace"]], action: "Delete the selected holes" },
      { keys: [["Esc"]], action: "Drop the selection" },
      { keys: [["Mod", "Z"]], action: "Undo — Pick another model too" },
    ],
  },
  {
    title: "3D view",
    rows: [
      { keys: [["H"]], action: "Show or hide the helpers: grid, markers, labels and handles" },
      {
        keys: [["F"]],
        action: "Fit the view to the model, as the Fit button does (in the Bench: to the selected part)",
      },
      { keys: [["View ▾"]], action: "Look from the Home, Top, Front or Right view" },
    ],
  },
  {
    title: "Handles",
    rows: [
      { keys: [["Drag"]], action: "Resize: an outline shows the new size, and the part renders on release" },
      {
        keys: [["Click"], ["Enter"]],
        action: "Type an exact size in mm (an edge or top handle; a corner only drags)",
      },
      { keys: [["Esc"]], action: "Cancel a drag, or close the size box without changing anything" },
      { keys: [["Tab"]], action: "Reach the handles from the keyboard" },
      {
        keys: [["Arrows"]],
        action: "Grow (→ ↑) or shrink (← ↓) a focused handle's size (Shift: ten steps of a length)",
      },
      { keys: [["Alt", "Drag"]], action: "Holes: resize from the centre" },
      { keys: [["Grid ▾"]], action: "The step drags snap to, and lengths and hole nudges move by" },
    ],
    note:
      "Library and Bench parts grow on both sides in width and depth, so they stay centred, and " +
      "upward in height; a hole keeps its opposite edge where it is ({Alt}: from the centre).",
  },
  {
    title: "Mouse and touch",
    rows: [
      { keys: [["Left-drag"]], action: "Orbit (trackpad: click and drag)" },
      { keys: [["Right-drag"], ["Shift", "Left-drag"]], action: "Pan (trackpad: Shift and drag)" },
      { keys: [["Wheel"]], action: "Zoom toward the pointer (trackpad: pinch, or scroll with two fingers)" },
      { keys: [["Middle-drag"]], action: "Zoom" },
      { keys: [["One finger"]], action: "Touch: orbit" },
      { keys: [["Two fingers"]], action: "Touch: pinch to zoom, drag to pan" },
      {
        keys: [["Tap"]],
        action: "Touch: pick a slot marker or a hole, drill a hole, open a handle's size box",
      },
      {
        keys: [["Long press"]],
        action: "Touch: on a hole in the Holes list, add it to the selection (as Shift-click does)",
      },
    ],
  },
];

// Things done with the pointer rather than pressed: shown as plain text.
const POINTER_TOKENS = new Set([
  "Click",
  "Drag",
  "Left-drag",
  "Right-drag",
  "Middle-drag",
  "Wheel",
  "One finger",
  "Two fingers",
  "Tap",
  "Long press",
  "View ▾",
  "Grid ▾",
]);

// Keys whose cap reads differently from the token. The modifiers carry the
// Mac's glyph and its name both, as the Holes tab's "⌥ Option" hint does:
// the glyph is what is printed on the key, the name what a screen reader
// says and what someone coming from another platform recognises.
const MAC_KEY_LABELS = { Mod: "⌘ Cmd", Ctrl: "⌃ Control", Alt: "⌥ Option", Shift: "⇧ Shift" };
const OTHER_KEY_LABELS = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
// The command palette's key hints sit in a row's margin: the Mac's glyphs
// alone there, as in its menus. Elsewhere the names are already short.
const MAC_COMPACT_LABELS = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const COMPACT_KEY_LABELS = { Enter: "↵", Esc: "Esc", Backspace: "⌫", Delete: "Del" };
const KEY_LABELS = {
  Esc: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Delete: "Delete",
  Backspace: "Backspace",
  Arrows: "← → ↑ ↓",
  "Up/Down": "↑ ↓",
};

// The same keys in running text ("{Alt}: from the centre").
const MAC_KEY_NAMES = { Mod: "Cmd", Ctrl: "Control", Alt: "Option", Shift: "Shift" };
const OTHER_KEY_NAMES = OTHER_KEY_LABELS;

// Where each modifier goes in a chord: Apple's menus order them ⌃⌥⇧⌘,
// Windows and Linux write Ctrl+Alt+Shift (Mod is Ctrl there).
const MAC_MODIFIER_ORDER = { Ctrl: 0, Alt: 1, Shift: 2, Mod: 3 };
const OTHER_MODIFIER_ORDER = { Mod: 0, Ctrl: 0, Alt: 1, Shift: 2 };

// Whether a token is one this module knows how to show — a modifier, a
// named key, a pointer action, or a single character typed as itself. A
// typo in the table would otherwise show as a key nobody has; the unit test
// checks every token against this rather than the dialog throwing, since
// the dialog sits outside the modes' error boundary.
/** @param {string} token */
export function isKnownToken(token) {
  return (
    Object.hasOwn(OTHER_KEY_LABELS, token) ||
    Object.hasOwn(KEY_LABELS, token) ||
    POINTER_TOKENS.has(token) ||
    [...token].length === 1
  );
}

/**
 * A chord's tokens as shown on this platform, modifiers first in its order.
 * `compact`: the palette's hints — glyphs only on a Mac, ↵ for Enter.
 * @param {readonly string[]} chord
 * @param {boolean} mac
 * @param {boolean} [compact]
 * @returns {ShortcutToken[]}
 */
export function chordTokens(chord, mac, compact = false) {
  const order = mac ? MAC_MODIFIER_ORDER : OTHER_MODIFIER_ORDER;
  const labels = compact && mac ? MAC_COMPACT_LABELS : mac ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
  // Own keys only: `"constructor" in order` is true for any object.
  const isModifier = (t) => Object.hasOwn(order, t);
  const modifiers = chord.filter(isModifier).sort((a, b) => order[a] - order[b]);
  const rest = chord.filter((t) => !isModifier(t));
  return [...modifiers, ...rest].map((token) => {
    if (POINTER_TOKENS.has(token)) return { text: token, kbd: false, key: token };
    if (isModifier(token)) return { text: labels[token], kbd: true, key: token };
    if (compact && Object.hasOwn(COMPACT_KEY_LABELS, token)) {
      return { text: COMPACT_KEY_LABELS[token], kbd: true, key: token };
    }
    return { text: Object.hasOwn(KEY_LABELS, token) ? KEY_LABELS[token] : token, kbd: true, key: token };
  });
}

/**
 * A chord as one short string, for a button's key hint: "⌘K" on a Mac,
 * "Ctrl+K" elsewhere.
 * @param {readonly string[]} chord
 * @param {boolean} [mac]
 */
export function chordText(chord, mac = isMacPlatform()) {
  const tokens = chordTokens(chord, mac, true).map((t) => t.text);
  return tokens.join(mac ? "" : "+");
}

/**
 * `{Alt}` and the other modifier placeholders in a row's text, named for
 * this platform.
 * @param {string} text
 * @param {boolean} mac
 */
export function platformText(text, mac) {
  const names = mac ? MAC_KEY_NAMES : OTHER_KEY_NAMES;
  return text.replace(/\{(Mod|Ctrl|Alt|Shift)\}/g, (_, key) => names[key]);
}

/**
 * The whole table, resolved for one platform — what the dialog renders.
 * @param {boolean} [mac]
 * @returns {ResolvedShortcutSection[]}
 */
export function shortcutSections(mac = isMacPlatform()) {
  return SHORTCUT_SECTIONS.map((section) => ({
    title: section.title,
    note: section.note ? platformText(section.note, mac) : null,
    rows: section.rows.map((row) => ({
      chords: ((mac && row.macKeys) || row.keys).map((chord) => chordTokens(chord, mac)),
      action: platformText(row.action, mac),
    })),
  }));
}

/**
 * The sheet narrowed to a search: a row stays when every word typed is in
 * its section's title, its text or its keys — as shown, or by the table's
 * own name, so "alt" finds ⌥ Option on a Mac and "mod" either Cmd or Ctrl.
 * A section stays with the rows that do; its note stays when the note has
 * every word too (a section can be found by its note alone). Nothing typed
 * is the whole sheet.
 * @param {ResolvedShortcutSection[]} sections
 * @param {string} query
 * @returns {ResolvedShortcutSection[]}
 */
export function filterShortcutSections(sections, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  const has = (text) => words.every((word) => text.includes(word));
  return sections.flatMap((section) => {
    const title = section.title.toLowerCase();
    const rows = section.rows.filter((row) => {
      const keys = row.chords.flat().map((t) => `${t.text} ${t.key}`);
      return has([title, row.action, ...keys].join(" ").toLowerCase());
    });
    const note = section.note && has(`${title} ${section.note}`.toLowerCase()) ? section.note : null;
    return rows.length || note ? [{ ...section, rows, note }] : [];
  });
}
