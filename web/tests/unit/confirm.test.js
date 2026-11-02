import test from "node:test";
import assert from "node:assert/strict";

import { answerConfirm, askConfirm, hostConfirm } from "../../src/lib/confirm.js";

test("with a dialog mounted, a question waits for its answer; a second waits its turn", async () => {
  /** @type {any[]} */
  const shown = [];
  const unmount = hostConfirm((request) => shown.push(request && request.question));
  assert.deepEqual(shown, [null]);

  const first = askConfirm("Replace the bench?", { detail: "Undo brings it back.", confirmLabel: "Replace" });
  const second = askConfirm("Delete the preset?");
  // Only the first is up; the second is not shown over it.
  assert.deepEqual(shown, [null, "Replace the bench?"]);

  answerConfirm(true);
  assert.equal(await first, true);
  assert.deepEqual(shown.at(-1), "Delete the preset?");
  answerConfirm(false);
  assert.equal(await second, false);
  assert.equal(shown.at(-1), null);

  // Unmounting answers anything still waiting "no".
  const left = askConfirm("Make a new token?");
  unmount();
  assert.equal(await left, false);
});

test("with no dialog mounted, the browser's own confirm() asks, and no confirm() is a no", async () => {
  const saved = globalThis.window;
  try {
    /** @type {string[]} */
    const asked = [];
    globalThis.window = /** @type {any} */ ({
      confirm: (/** @type {string} */ text) => {
        asked.push(text);
        return true;
      },
    });
    assert.equal(await askConfirm("Replace it?", { detail: "Undo brings it back." }), true);
    assert.deepEqual(asked, ["Replace it?\n\nUndo brings it back."]);
    globalThis.window = /** @type {any} */ ({
      confirm: () => {
        throw new Error("blocked");
      },
    });
    assert.equal(await askConfirm("Replace it?"), false);
    globalThis.window = /** @type {any} */ (undefined);
    assert.equal(await askConfirm("Replace it?"), false);
  } finally {
    globalThis.window = saved;
  }
});
