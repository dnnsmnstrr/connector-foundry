import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useBenchHistory } from "../../src/hooks/useBenchHistory.js";
import { useGridSnap } from "../../src/hooks/useGridSnap.js";
import { useHolesHistory } from "../../src/hooks/useHolesHistory.js";
import { useLibraryHistory } from "../../src/hooks/useLibraryHistory.js";
import { clearBenchHistory, replaceBenchSession } from "../../src/lib/benchSession.js";
import { setHolesDoc } from "../../src/lib/holesSession.js";
import { clearLibraryHistory, recordLibrary } from "../../src/lib/librarySession.js";

// What a hook returns on a render, through a one-off component. The server
// renderer reads useSyncExternalStore's server snapshot, which each hook
// passes as the store's own getter — so this is the store's live value.
function read(useHook) {
  function Probe() {
    return createElement("pre", null, JSON.stringify(useHook()));
  }
  const html = renderToStaticMarkup(createElement(Probe));
  return JSON.parse(html.slice("<pre>".length, -"</pre>".length).replaceAll("&quot;", '"'));
}

test("the history hooks read their store's state", () => {
  clearLibraryHistory();
  assert.deepEqual(read(useLibraryHistory), {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  });
  recordLibrary({ partId: "basics/plate", params: {} }, { label: "resize W" });
  assert.equal(read(useLibraryHistory).undoLabel, "resize W");

  replaceBenchSession({ assembly: null }, { record: false });
  clearBenchHistory();
  replaceBenchSession({ assembly: { root: { id: "root", partId: "basics/plate", params: {} }, nodes: [] } });
  assert.equal(read(useBenchHistory).canUndo, true);

  setHolesDoc({ source: { kind: "catalogue", partId: "basics/plate", params: {} }, holes: [] });
  assert.equal(read(useHolesHistory).canUndo, true);
});

test("the grid hook reads the grid preference (no storage in Node: the default)", () => {
  assert.equal(read(useGridSnap), 0.5);
});
