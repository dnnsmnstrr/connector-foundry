// The checks every keyboard shortcut in the app makes before acting on a
// keydown — App.jsx's shell shortcuts, Bench.jsx's and Holes.jsx's
// selection shortcuts, StlViewer's `h` and every tab's Cmd/Ctrl+Z
// (hooks/useUndoShortcuts.js). They are separate listeners on
// purpose (see web/README.md's "Shell" section) but must agree on when a
// key is not theirs to take.

// Whether a keydown's target is something the user is typing into — a
// text field, a select, anything contentEditable — so a single-key
// shortcut ("s" for Settings, Delete for the selected bench part) must
// leave the key to it.
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Cmd/Ctrl/Alt held: the key is a browser or OS shortcut (Cmd+M
// minimises the window, Alt+arrow is history navigation), not "M" or
// an arrow for us. Shift is not on the list — it is how "H" or "?" is typed.
export function hasCommandModifier(e) {
  return e.metaKey || e.ctrlKey || e.altKey;
}

// Whether a modal <dialog> is open that `owner` is not inside. Everything
// behind a showModal() dialog is inert to the pointer, but window keydown
// listeners still fire — so without this, Backspace with Settings open
// deletes the selected bench part behind it. `owner` is the element the
// shortcut belongs to (StlViewer's canvas, which may itself sit inside the
// STL import dialog); leave it out for a shortcut that belongs to the page
// behind every dialog.
export function isBehindOpenDialog(owner = null) {
  const dialog = document.querySelector("dialog[open]");
  return !!dialog && !(owner && dialog.contains(owner));
}

// All three at once: the usual guard for a single-key shortcut.
export function ignoresShortcut(e, owner = null) {
  return hasCommandModifier(e) || isEditableTarget(e.target) || isBehindOpenDialog(owner);
}

// --- Undo and redo ----------------------------------------------------------
// Cmd/Ctrl+Z is a command-modifier shortcut, so ignoresShortcut() would
// always refuse it; it gets its own, narrower guard. A text field keeps
// the key for its own native undo, but a checkbox or a select does not:
// after ticking a boolean parameter (focus stays on the box) Cmd+Z should
// undo the tick, and the browser has no native undo there to defer to.

const TEXT_INPUT_TYPES = new Set(["text", "search", "number", "email", "url", "tel", "password"]);

// Whether `el` is somewhere the user types text: a text-like <input> (no
// type counts — the browser treats it as text), a <textarea>, anything
// contentEditable. Not checkboxes, radios, selects or buttons.
export function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  return TEXT_INPUT_TYPES.has(String(el.type || "text").toLowerCase());
}

// The Mac decides between Cmd and Ctrl. navigator.platform is deprecated
// but is what main.jsx already reads, and TypeScript's DOM library has no
// navigator.userAgentData to type-check the replacement against.
export function isMacPlatform() {
  return typeof navigator !== "undefined" && /^Mac|^iP(hone|ad|od)/.test(navigator.platform ?? "");
}

// "undo" | "redo" | null for a keydown: Cmd+Z (Mac) or Ctrl+Z (elsewhere)
// is undo, with Shift redo; Ctrl+Y is redo off the Mac too. Matches
// e.key, lowercased, never e.code: on a German keyboard Z and Y swap
// places, and the key labelled Z is the one the user means. (Chrome on
// macOS reports "z" for Cmd+Shift+Z, Windows "Z" for Ctrl+Shift+Z.) Alt
// held, or the other platform's modifier, is someone else's shortcut.
// `mac` is a parameter so the tests can cover both platforms.
export function undoShortcut(e, mac = isMacPlatform()) {
  if (e.altKey || typeof e.key !== "string") return null;
  const primary = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!primary) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !mac && !e.shiftKey) return "redo";
  return null;
}

// Whether an undo/redo key belongs to someone else: a text field's own
// undo, or a dialog the shortcut's `owner` is not inside (as
// isBehindOpenDialog()). A field marked data-native-undo="false" has no
// undo of its own to give the key to: DecimalInput marks itself so while
// its text is the app's (an arrow, wheel or spinner step, a value from
// outside) rather than typed — writing the value clears the browser's
// undo for the field, so Cmd/Ctrl+Z there would do nothing at all while
// the tab's history holds the step.
export function ignoresUndoShortcut(e, owner = null) {
  const field = e.target;
  const nativeUndo = isTextEntry(field) && field.dataset?.nativeUndo !== "false";
  return nativeUndo || isBehindOpenDialog(owner);
}

// The Bench's and Holes' part pickers (CommandPalette's `undo`) open with
// their search box focused — after Start over or "Pick another model",
// and after an undone first pick — and a text field keeps Cmd/Ctrl+Z for
// its own undo. Until something is typed into the box it has none, so the
// keys are the tab's: Start over, then Cmd/Ctrl+Z at once, brings the work
// back. Once typed into (`typed`), the box keeps its keys. "undo" | "redo"
// | null, as undoShortcut().
/**
 * @param {{ key?: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean,
 *   target: any, defaultPrevented: boolean }} e
 * @param {boolean} typed
 * @param {boolean} [mac]
 */
export function pickerUndoKey(e, typed, mac = isMacPlatform()) {
  if (typed || e.defaultPrevented || !isTextEntry(e.target)) return null;
  return undoShortcut(e, mac);
}

// --- The command palette and user hotkeys -----------------------------------
// Mod+K (Cmd on a Mac, Ctrl elsewhere — undoShortcut()'s rule) opens and
// closes the command palette; hooks/useCommands.js's usePaletteShortcut()
// listens for it, and the palette itself closes on it. Matched on e.key,
// falling back to the physical key for a layout whose K key types
// something else with the modifier held. Shift or Alt held is another
// chord (a user hotkey can be Mod+Shift+K).
/**
 * @param {{ key?: string, code?: string, metaKey: boolean, ctrlKey: boolean,
 *   altKey: boolean, shiftKey: boolean }} e
 * @param {boolean} [mac]
 */
export function paletteShortcut(e, mac = isMacPlatform()) {
  if (e.altKey || e.shiftKey) return false;
  const primary = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!primary) return false;
  return (typeof e.key === "string" && e.key.toLowerCase() === "k") || e.code === "KeyK";
}

// Whether a user's hotkey (userCommands.js) must leave a keydown alone: a
// held key repeating, a keydown someone already took (a handle drag
// swallows every key), any dialog open — a hotkey that ran a command from
// under Settings or a part picker would act on the page behind it — and
// AltGr, which is how "@" or "€" is typed on many layouts and arrives as
// Ctrl+Alt (hotkeys.js refuses Mod+Alt off the Mac for the same reason;
// this catches the key on its way in too).
/**
 * @param {{ repeat?: boolean, defaultPrevented: boolean,
 *   getModifierState?: (key: string) => boolean }} e
 */
export function ignoresHotkey(e) {
  if (e.repeat || e.defaultPrevented) return true;
  if (typeof document !== "undefined" && document.querySelector("dialog[open]")) return true;
  return e.getModifierState?.("AltGraph") === true;
}
