import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { addHole, createHolesDoc, flipHoles, patchHoles, setDocName } from "../../src/lib/screwHoles.js";
import {
  clearHolesHistory,
  getHolesHistoryState,
  getHolesSession,
  redoHoles,
  setHolesDoc,
  subscribeHolesHistory,
  undoHoles,
} from "../../src/lib/holesSession.js";

beforeEach(() => {
  setHolesDoc(null);
  clearHolesHistory();
});

const catalogueDoc = () => createHolesDoc({ kind: "catalogue", partId: "basics/plate", params: { w: 40 } });
const drill = (doc) => addHole(doc, { point: [0, 0, 3], normal: [0, 0, 1] }).doc;

test("every change is a step, a new document and the start screen included", () => {
  setHolesDoc(catalogueDoc(), { label: "start" });
  setHolesDoc(drill, { label: "add hole" });
  const drilled = getHolesSession().doc;
  setHolesDoc(null, { label: "pick another model" });

  assert.equal(getHolesHistoryState().undoLabel, "pick another model");
  undoHoles();
  assert.equal(getHolesSession().doc, drilled, "Pick another model is undoable");
  undoHoles();
  assert.equal(getHolesSession().doc.holes.length, 0);
  undoHoles();
  assert.equal(getHolesSession().doc, null);
  assert.equal(undoHoles(), false);
  assert.equal(redoHoles(), true);
  assert.equal(getHolesSession().doc.holes.length, 0);
});

test("a base-parameter edit is an ordinary step, coalesced by key — not a new document", () => {
  setHolesDoc(drill(catalogueDoc()));
  clearHolesHistory();
  for (const w of [5, 50, 55]) {
    setHolesDoc((d) => ({ ...d, source: { ...d.source, params: { w } } }), { key: "base:w" });
  }
  assert.equal(getHolesSession().doc.source.params.w, 55);
  undoHoles();
  assert.equal(getHolesSession().doc.source.params.w, 40);
  assert.equal(getHolesSession().doc.holes.length, 1, "the holes are still there");
  assert.equal(getHolesHistoryState().canUndo, false);
});

test("an equal document records nothing, even as a new object with a new source", () => {
  setHolesDoc(drill(catalogueDoc()));
  clearHolesHistory();
  setHolesDoc((d) => ({ ...d, source: { ...d.source, params: { ...d.source.params } } }));
  setHolesDoc((d) => setDocName(d, d.name));
  setHolesDoc((d) => patchHoles(d, [], { diameter: 5 }));
  setHolesDoc((d) => ({ ...d, holes: d.holes.map((h) => ({ ...h })) }));
  assert.equal(getHolesHistoryState().canUndo, false);
  setHolesDoc((d) => setDocName(d, "Bracket"), { key: "name" });
  assert.equal(getHolesHistoryState().canUndo, true);
});

test("a mesh source is compared by identity, never by its bytes", () => {
  const stlBytes = new Uint8Array(84);
  const geometry = {};
  const source = { kind: "mesh", name: "part.stl", geometry, flip: false, stlBytes, extents: [1, 1, 1] };
  setHolesDoc(createHolesDoc(source));
  clearHolesHistory();
  setHolesDoc((d) => ({ ...d, source: { ...d.source } }));
  assert.equal(getHolesHistoryState().canUndo, false);
  // Turning the mesh over (Holes.jsx's setFlip) is a step.
  setHolesDoc((d) => ({
    ...flipHoles(d, 1),
    source: { ...d.source, flip: true, stlBytes: new Uint8Array(84) },
  }));
  assert.equal(getHolesHistoryState().canUndo, true);
  undoHoles();
  assert.equal(getHolesSession().doc.source.stlBytes, stlBytes);
});

test("history subscribers hear about changes", () => {
  let calls = 0;
  const off = subscribeHolesHistory(() => calls++);
  setHolesDoc(catalogueDoc());
  undoHoles();
  off();
  assert.equal(calls, 2);
});
