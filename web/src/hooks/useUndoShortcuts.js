import { useEffect, useRef } from "react";
import { ignoresUndoShortcut, undoShortcut } from "../lib/isEditableTarget.js";

// Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y for the mounted tab: one window
// keydown listener, which calls the latest `onUndo`/`onRedo` (read
// through a ref, so a re-render doesn't re-subscribe). Keys typed into a
// text field are left to the field's own undo, and keys behind an open
// dialog to the dialog (lib/isEditableTarget.js's ignoresUndoShortcut()).
//
// Every matched key that isn't ignored is preventDefault()ed — also when
// there is nothing to undo. In the desktop app the Edit menu's undo role
// is bound to the same keys; Chromium offers a key to the page before the
// menu's key equivalents, and a key the page didn't cancel goes on to
// webContents.undo(), which can revert typing in a field that has
// already lost focus. The tab's history is the only undo outside a text
// field.
/**
 * @param {{ onUndo: () => void, onRedo: () => void, enabled?: boolean }} options
 *   `enabled` false removes the listener (a tab that is showing something
 *   with its own undo, or nothing to act on)
 */
export function useUndoShortcuts({ onUndo, onRedo, enabled = true }) {
  const handlers = useRef({ onUndo, onRedo });
  handlers.current = { onUndo, onRedo };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = undoKeyListener(handlers);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/**
 * The keydown listener, outside React so the unit tests can drive it.
 * @param {{ current: { onUndo: () => void, onRedo: () => void } }} handlers
 * @returns {(e: KeyboardEvent) => void}
 */
export function undoKeyListener(handlers) {
  return (e) => {
    // defaultPrevented: something nearer the target already took the
    // key (a handle drag in StlViewer swallows every key).
    if (e.defaultPrevented) return;
    const action = undoShortcut(e);
    if (!action || ignoresUndoShortcut(e)) return;
    e.preventDefault();
    if (action === "undo") handlers.current.onUndo();
    else handlers.current.onRedo();
  };
}
