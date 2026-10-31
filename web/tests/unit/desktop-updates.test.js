import test from "node:test";
import assert from "node:assert/strict";

import { dismissShellNotice, needsShellNotice, updateSummary } from "../../src/lib/desktopUpdates.js";

// The page's side of the desktop updater (src/lib/desktopUpdates.js): the
// line Settings and the palette show, and when the nav asks for the app to
// be updated by hand.

const base = {
  version: "0.4.0",
  autoCheck: true,
  keepUpdated: true,
  web: "0.4.0",
  state: "idle",
  latest: null,
  progress: null,
  releaseUrl: null,
  checkedAt: null,
  error: null,
  manual: null,
  justUpdated: null,
  reload: false,
  shellNeeded: false,
};

test("one line says where the updater stands", () => {
  const summary = (s) => updateSummary({ ...base, latest: "0.5.0", ...s });
  assert.equal(summary({ state: "idle", latest: null }), "Not checked yet");
  assert.equal(summary({ state: "checking" }), "Checking for updates…");
  assert.equal(summary({ state: "up-to-date" }), "Up to date");
  assert.equal(summary({ state: "available" }), "Version 0.5.0 is available");
  assert.equal(summary({ state: "downloading", progress: 0.426 }), "Downloading version 0.5.0… 42%");
  assert.equal(summary({ state: "downloading" }), "Downloading version 0.5.0…");
  assert.equal(summary({ state: "ready" }), "Version 0.5.0 is ready to install");
  assert.equal(summary({ state: "ready", reload: true }), "Version 0.5.0 is ready to load");
  assert.equal(
    summary({ state: "available", shellNeeded: true }),
    "Version 0.5.0 needs a new download of the app",
  );
  assert.equal(summary({ state: "installing" }), "Installing version 0.5.0…");
  assert.equal(summary({ state: "error", error: "Couldn't reach GitHub." }), "Couldn't reach GitHub.");
  assert.equal(summary({ state: "error" }), "The update failed");
});

test("the nav asks for a new app once per version, only when this copy can't install it", () => {
  /** A Storage stand-in; `broken` throws like a blocked one. */
  const storage = (broken = false) => {
    const values = new Map();
    return /** @type {Storage} */ (
      /** @type {unknown} */ ({
        getItem: (key) => {
          if (broken) throw new Error("blocked");
          return values.get(key) ?? null;
        },
        setItem: (key, value) => {
          if (broken) throw new Error("blocked");
          values.set(key, value);
        },
      })
    );
  };
  const s = { ...base, state: "available", latest: "0.5.0", shellNeeded: true };
  const store = storage();
  assert.equal(needsShellNotice(s, store), true);
  // Installable, or not a shell change: the usual update flow says it.
  assert.equal(needsShellNotice({ ...s, state: "ready" }, store), false);
  assert.equal(needsShellNotice({ ...s, shellNeeded: false }, store), false);
  assert.equal(needsShellNotice(null, store), false);
  dismissShellNotice("0.5.0", store);
  assert.equal(needsShellNotice(s, store), false);
  assert.equal(needsShellNotice({ ...s, latest: "0.6.0" }, store), true);
  // Storage that throws: it asks, and dismissing doesn't break.
  assert.equal(needsShellNotice(s, storage(true)), true);
  dismissShellNotice("0.5.0", storage(true));
});
