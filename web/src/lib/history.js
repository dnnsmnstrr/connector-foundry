// An undo/redo history of immutable snapshots, the one engine behind the
// three tabs' Undo buttons and Cmd/Ctrl+Z (librarySession.js,
// benchSession.js, holesSession.js). It holds values, not commands: the
// owning store calls record() with the value *before* a change, and
// undo()/redo() hand back the value to restore, so nothing here knows
// what a bench or a Holes document is.
//
// Coalescing: a field that reports every keystroke (DecimalInput) or a
// held arrow key would otherwise make "120" three undo steps. A record()
// with the same non-null `key` as the step on top of the stack, within
// `coalesceMs` of the previous record with that key, pushes nothing —
// the step on top already holds the value from before the first
// keystroke, which is what one undo should bring back. The window
// slides (each coalesced record restarts it), so a long run of typing is
// still one step. undo(), redo() and clear() forget the key: typing,
// undoing and typing again must push a fresh step, or the second edit
// would be merged into a step that was already popped and Redo would
// bring the undone value back over it.
//
// `undefined` is the "nothing there" answer from undo()/redo(), not
// `null`: the stores legitimately hold null (no bench root picked yet,
// no Holes base chosen), and that has to be undoable too.

/**
 * @typedef {{ canUndo: boolean, canRedo: boolean, undoLabel: string | null, redoLabel: string | null }} HistoryState
 * @typedef {{ key?: string | null, label?: string | null }} RecordOptions
 */

/**
 * @template T
 * @typedef {object} History
 * @property {(previous: T, options?: RecordOptions) => void} record
 *   Call before a change, with the value it replaces. Clears the redo stack.
 * @property {(current: T) => T | undefined} undo
 *   The value to restore, or undefined when there is nothing to undo.
 * @property {(current: T) => T | undefined} redo
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 * @property {() => void} clear
 * @property {() => HistoryState} state
 *   A snapshot whose identity changes only when a field does, for
 *   useSyncExternalStore.
 * @property {(listener: () => void) => () => void} subscribe
 *   Called when state() changes; returns the unsubscribe.
 */

/**
 * @template T
 * @param {{ limit?: number, coalesceMs?: number, now?: () => number }} [options]
 *   `limit` caps the undo stack (the oldest step is dropped); `now` is
 *   injectable so the tests can step the clock.
 * @returns {History<T>}
 */
export function createHistory({ limit = 100, coalesceMs = 1000, now = Date.now } = {}) {
  /** @type {{ value: T, label: string | null }[]} */
  let past = [];
  /** @type {{ value: T, label: string | null }[]} */
  let future = [];
  // The key and time of the last record(), while the step it made (or
  // merged into) is still on top of `past`. null after undo/redo/clear.
  /** @type {{ key: string, time: number } | null} */
  let coalescing = null;
  /** @type {HistoryState} */
  let snapshot = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };
  const listeners = new Set();

  function changed() {
    const next = {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past.at(-1)?.label ?? null,
      redoLabel: future.at(-1)?.label ?? null,
    };
    if (
      next.canUndo === snapshot.canUndo &&
      next.canRedo === snapshot.canRedo &&
      next.undoLabel === snapshot.undoLabel &&
      next.redoLabel === snapshot.redoLabel
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  return {
    record(previous, { key = null, label = null } = {}) {
      const time = now();
      const merge =
        key !== null &&
        past.length > 0 &&
        coalescing !== null &&
        coalescing.key === key &&
        time - coalescing.time <= coalesceMs;
      if (merge) {
        // The step on top keeps its value from before the first edit of
        // the run; a label it lacked can still come from a later one.
        const top = past.at(-1);
        if (top.label === null && label !== null) past[past.length - 1] = { ...top, label };
      } else {
        past.push({ value: previous, label });
        if (past.length > limit) past = past.slice(past.length - limit);
      }
      coalescing = key === null ? null : { key, time };
      future = [];
      changed();
    },
    undo(current) {
      coalescing = null;
      const step = past.pop();
      if (!step) return undefined;
      future.push({ value: current, label: step.label });
      changed();
      return step.value;
    },
    redo(current) {
      coalescing = null;
      const step = future.pop();
      if (!step) return undefined;
      past.push({ value: current, label: step.label });
      changed();
      return step.value;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      coalescing = null;
      past = [];
      future = [];
      changed();
    },
    state: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
