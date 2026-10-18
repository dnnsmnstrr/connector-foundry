import test from "node:test";
import assert from "node:assert/strict";

import { restartWarning, updateSummary } from "../../src/lib/desktopUpdates.js";

// The page's side of the desktop updater (src/lib/desktopUpdates.js): the
// line Settings and the palette show, and what a restart would lose.

const base = {
  version: "0.4.0",
  autoCheck: true,
  state: "idle",
  latest: null,
  progress: null,
  releaseUrl: null,
  checkedAt: null,
  error: null,
  manual: null,
  justUpdated: null,
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
  assert.equal(summary({ state: "installing" }), "Installing version 0.5.0…");
  assert.equal(summary({ state: "error", error: "Couldn't reach GitHub." }), "Couldn't reach GitHub.");
  assert.equal(summary({ state: "error" }), "The update failed");
});

test("a restart warns only about what the address doesn't bring back", () => {
  assert.equal(restartWarning({ importedMeshes: 0, holes: false }), null);
  assert.match(restartWarning({ importedMeshes: 1, holes: false }), /the mesh imported onto the Bench won't/);
  assert.match(restartWarning({ importedMeshes: 2, holes: false }), /the meshes imported/);
  assert.match(
    restartWarning({ importedMeshes: 2, holes: true }),
    /the model on the Holes tab and its holes and the meshes imported onto the Bench won't\.$/,
  );
});
