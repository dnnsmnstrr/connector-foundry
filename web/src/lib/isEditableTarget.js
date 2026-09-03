// Whether a keydown's target is something the user is typing into — a
// text field, a select, anything contentEditable — so a single-key
// shortcut ("s" for Settings, Delete for the selected bench part) must
// leave the key to it. Shared by App.jsx's shell shortcuts and Bench.jsx's
// selection shortcuts, which are two listeners on purpose (see
// web/README.md's "Shell" section) but must agree on this.
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
