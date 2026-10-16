import test from "node:test";
import assert from "node:assert/strict";

import { createHistory } from "../../src/lib/history.js";

// A history on a clock the test moves by hand.
function clocked(options = {}) {
  const clock = { t: 0 };
  const history = createHistory({ now: () => clock.t, ...options });
  return { history, clock };
}

test("undo hands back the value before the change, redo the one after", () => {
  const { history } = clocked();
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo("a"), undefined);
  history.record("a");
  assert.equal(history.canUndo(), true);
  assert.equal(history.undo("b"), "a");
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
  assert.equal(history.redo("a"), "b");
  assert.equal(history.redo("b"), undefined);
});

test("null is a value like any other; undefined means there is nothing", () => {
  const { history } = clocked();
  history.record(null);
  assert.equal(history.undo("doc"), null);
  assert.equal(history.undo(null), undefined);
});

test("a new record clears the redo stack", () => {
  const { history, clock } = clocked();
  history.record(1);
  clock.t += 5000;
  history.record(2);
  assert.equal(history.undo(3), 2);
  history.record(2);
  assert.equal(history.canRedo(), false);
});

test("records with the same key within the window coalesce into one step", () => {
  const { history, clock } = clocked();
  // Typing "120" into a field that reports every keystroke.
  history.record("", { key: "param:w" });
  clock.t += 300;
  history.record("1", { key: "param:w" });
  clock.t += 300;
  history.record("12", { key: "param:w" });
  assert.equal(history.undo("120"), "");
  assert.equal(history.canUndo(), false);
});

test("the coalescing window slides with each record", () => {
  const { history, clock } = clocked({ coalesceMs: 1000 });
  history.record(0, { key: "nudge" });
  for (let i = 1; i <= 5; i++) {
    clock.t += 800;
    history.record(i, { key: "nudge" });
  }
  assert.equal(history.undo(6), 0);
  assert.equal(history.canUndo(), false);
});

test("a pause, another key, or no key at all starts a new step", () => {
  const { history, clock } = clocked({ coalesceMs: 1000 });
  history.record("a", { key: "name" });
  clock.t += 1500;
  history.record("b", { key: "name" });
  history.record("c", { key: "other" });
  history.record("d");
  history.record("e");
  assert.deepEqual(
    ["f", "e", "d", "c", "b"].map((current) => history.undo(current)),
    ["e", "d", "c", "b", "a"],
  );
});

test("type, undo, type again: the second edit is a fresh step, not merged into the undone one", () => {
  const { history, clock } = clocked();
  history.record("v0", { key: "param:w" });
  clock.t += 100;
  assert.equal(history.undo("v1"), "v0");
  clock.t += 100;
  history.record("v0", { key: "param:w" });
  assert.equal(history.canUndo(), true, "the new edit is undoable");
  assert.equal(history.canRedo(), false, "and the undone value can't come back over it");
  assert.equal(history.undo("v2"), "v0");
});

test("type, undo, redo, type: redo forgets the key too", () => {
  const { history, clock } = clocked();
  history.record("v0", { key: "param:w" });
  assert.equal(history.undo("v1"), "v0");
  assert.equal(history.redo("v0"), "v1");
  clock.t += 100;
  history.record("v1", { key: "param:w" });
  // Two steps now: v1 -> v2, and v0 -> v1 before it.
  assert.equal(history.undo("v2"), "v1");
  assert.equal(history.undo("v1"), "v0");
});

test("the limit drops the oldest step", () => {
  const { history } = clocked({ limit: 3 });
  for (const v of [1, 2, 3, 4, 5]) history.record(v);
  assert.deepEqual(
    [6, 5, 4].map((current) => history.undo(current)),
    [5, 4, 3],
  );
  assert.equal(history.undo(3), undefined);
});

test("clear empties both stacks and forgets the key", () => {
  const { history } = clocked();
  history.record(1, { key: "k" });
  history.record(2);
  history.undo(3);
  history.clear();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
  history.record(1, { key: "k" });
  history.record(2, { key: "k" });
  assert.equal(history.undo(3), 1);
});

test("state() is cached until a field changes, and carries the labels", () => {
  const { history, clock } = clocked();
  const empty = history.state();
  assert.deepEqual(empty, { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  history.clear();
  assert.equal(history.state(), empty, "nothing changed, same object");

  history.record(1, { key: "handle:x+", label: "resize W" });
  const one = history.state();
  assert.deepEqual(one, { canUndo: true, canRedo: false, undoLabel: "resize W", redoLabel: null });
  clock.t += 10;
  history.record(2, { key: "handle:x+", label: "resize W" });
  assert.equal(history.state(), one, "a coalesced record changes nothing visible");

  history.undo(3);
  assert.deepEqual(history.state(), {
    canUndo: false,
    canRedo: true,
    undoLabel: null,
    redoLabel: "resize W",
  });
});

test("a coalesced run keeps its first label, or takes the first one it gets", () => {
  const { history } = clocked();
  history.record(1, { key: "k" });
  history.record(2, { key: "k", label: "rename" });
  history.record(3, { key: "k", label: "something else" });
  assert.equal(history.state().undoLabel, "rename");
});

test("subscribers hear about state changes only", () => {
  const { history, clock } = clocked();
  let calls = 0;
  const off = history.subscribe(() => calls++);
  history.record(1, { key: "k" });
  assert.equal(calls, 1);
  clock.t += 10;
  history.record(2, { key: "k" });
  assert.equal(calls, 1, "coalesced: state unchanged");
  history.undo(3);
  assert.equal(calls, 2);
  off();
  history.redo(1);
  assert.equal(calls, 2);
});
