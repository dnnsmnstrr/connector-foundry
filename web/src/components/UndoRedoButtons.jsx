import { isMacPlatform } from "../lib/isEditableTarget.js";

// Undo and Redo as two compact icon buttons — in the viewer's toolbar in
// every tab, and on the Bench's and Holes' start screens while there is
// something to undo (Start over and "Pick another model" can be taken
// back). Their accessible names stay plain "Undo"/"Redo"; the tooltip
// says what the step is ("Undo resize W (⌘Z)") and the platform's key.
// The keys themselves are hooks/useUndoShortcuts.js's.
//
// `canUndo`/`canRedo` disable the buttons (from a history hook's state),
// `onUndo`/`onRedo` act, `undoLabel`/`redoLabel` name the steps in the
// tooltips, `className` goes on the wrapper for placement.
/**
 * @param {{
 *   canUndo: boolean,
 *   canRedo: boolean,
 *   onUndo: () => void,
 *   onRedo: () => void,
 *   undoLabel?: string | null,
 *   redoLabel?: string | null,
 *   className?: string,
 * }} props
 */
export default function UndoRedoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoLabel = null,
  redoLabel = null,
  className = "",
}) {
  const mac = isMacPlatform();
  const undoKey = mac ? "⌘Z" : "Ctrl+Z";
  const redoKey = mac ? "⇧⌘Z" : "Ctrl+Y";
  return (
    <span className={`undo-redo ${className}`.trim()} role="group" aria-label="Undo and redo">
      <button
        type="button"
        className="undo-redo-button"
        aria-label="Undo"
        title={`Undo${undoLabel ? ` ${undoLabel}` : ""} (${undoKey})`}
        disabled={!canUndo}
        onClick={onUndo}
      >
        <ArrowIcon redo={false} />
      </button>
      <button
        type="button"
        className="undo-redo-button"
        aria-label="Redo"
        title={`Redo${redoLabel ? ` ${redoLabel}` : ""} (${redoKey})`}
        disabled={!canRedo}
        onClick={onRedo}
      >
        <ArrowIcon redo />
      </button>
    </span>
  );
}

// A curved arrow turning back to the left (undo), or its mirror image.
/** @param {{ redo: boolean }} props */
function ArrowIcon({ redo }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      style={redo ? { transform: "scaleX(-1)" } : undefined}
    >
      <path
        d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a3.75 3.75 0 0 1 0 7.5H7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
