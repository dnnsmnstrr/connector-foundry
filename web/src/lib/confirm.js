// The app's own yes-or-no question, in place of window.confirm(). A native
// confirm() is not always shown: some embedded browsers answer it "no" at
// once without asking (an editor's preview pane, some in-app browsers),
// as Chrome does once "Prevent this page from creating additional
// dialogs" is ticked. Every question was a replace or a delete, so a
// silent "no" made the button look broken.
//
// askConfirm() hands the question to whatever dialog is listening
// (components/ConfirmDialog.jsx, mounted once by App.jsx) and resolves to
// its answer. Questions asked while one is up wait their turn. With no
// dialog mounted (a unit test, a page that never mounted App) it falls
// back to window.confirm(), and to "no" where there is none.

/**
 * @typedef {object} ConfirmRequest
 * @property {string} question what is asked, as the dialog's heading
 * @property {string} [detail] a line under it: what happens, what Undo does
 * @property {string} [confirmLabel] the yes button's label ("Replace", "Delete")
 * @property {(answer: boolean) => void} resolve
 */

/** @type {ConfirmRequest[]} */
const queue = [];
/** @type {((request: ConfirmRequest | null) => void) | null} */
let host = null;

/**
 * Ask the user, and resolve to true for yes.
 * @param {string} question
 * @param {{ detail?: string, confirmLabel?: string }} [options]
 * @returns {Promise<boolean>}
 */
export function askConfirm(question, { detail, confirmLabel = "OK" } = {}) {
  if (!host) {
    const text = detail ? `${question}\n\n${detail}` : question;
    try {
      return Promise.resolve(
        // The one place the native dialog is still asked, as the fallback.
        // eslint-disable-next-line no-restricted-properties
        typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(text) : false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise((resolve) => {
    queue.push({ question, detail, confirmLabel, resolve });
    if (queue.length === 1) host?.(queue[0]);
  });
}

/**
 * The dialog's side: `show` is called with the question to ask (null when
 * there is none left). Returns the function that unmounts it, which
 * answers anything still waiting "no".
 * @param {(request: ConfirmRequest | null) => void} show
 */
export function hostConfirm(show) {
  host = show;
  show(queue[0] ?? null);
  return () => {
    if (host === show) host = null;
    for (const request of queue.splice(0)) request.resolve(false);
  };
}

/**
 * The dialog's answer to the question it is showing; the next one, if
 * any, comes up.
 * @param {boolean} answer
 */
export function answerConfirm(answer) {
  const request = queue.shift();
  request?.resolve(answer);
  host?.(queue[0] ?? null);
}
