// The checks every keyboard shortcut in the app makes before acting on a
// keydown — App.jsx's shell shortcuts, Bench.jsx's and Holes.jsx's
// selection shortcuts and StlViewer's `h`. They are separate listeners on
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
