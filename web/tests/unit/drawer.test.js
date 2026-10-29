import test from "node:test";
import assert from "node:assert/strict";

import { drawerInset, drawerRests, drawerSnap, isDrawerLayout } from "../../src/lib/drawer.js";

test("the drawer rests closed, at half the workspace and at nearly all of it", () => {
  assert.deepEqual(drawerRests(800, 60), { closed: 60, half: 400, full: 704 });
});

test("on a short screen no open rest is lower than the closed one, or taller than the room", () => {
  // A phone in landscape with the keyboard up: half the room is less
  // than the handle.
  assert.deepEqual(drawerRests(100, 60), { closed: 60, half: 60, full: 88 });
  assert.deepEqual(drawerRests(40, 60), { closed: 40, half: 40, full: 40 });
  // Nothing measured yet (the workspace not laid out): all at zero, not NaN.
  assert.deepEqual(drawerRests(Number.NaN, 60), { closed: 0, half: 0, full: 0 });
  assert.deepEqual(drawerRests(800, Number.NaN), { closed: 0, half: 400, full: 704 });
});

test("a slow release goes to the nearest rest", () => {
  const rests = drawerRests(800, 60);
  assert.equal(drawerSnap(70, 0, rests), "closed");
  assert.equal(drawerSnap(220, 0, rests), "closed");
  assert.equal(drawerSnap(240, 0, rests), "half");
  assert.equal(drawerSnap(540, 0, rests), "half");
  assert.equal(drawerSnap(560, 0, rests), "full");
  assert.equal(drawerSnap(2000, 0, rests), "full");
  assert.equal(drawerSnap(-50, 0, rests), "closed");
});

test("a flick carries on to the next rest the way it was going", () => {
  const rests = drawerRests(800, 60);
  // Just above closed, flicked up: half, not back down.
  assert.equal(drawerSnap(100, 1.5, rests), "half");
  // Just under half, flicked down: closed.
  assert.equal(drawerSnap(380, -1.5, rests), "closed");
  // Half, flicked up hard: full.
  assert.equal(drawerSnap(420, 2, rests), "full");
  // A speed that isn't a number is no speed.
  assert.equal(drawerSnap(100, Number.NaN, rests), "closed");
});

test("what is over the view keeps clear of the sheet up to its half rest", () => {
  const rests = drawerRests(800, 60);
  assert.equal(drawerInset(60, rests), 60);
  assert.equal(drawerInset(300, rests), 300);
  assert.equal(drawerInset(704, rests), 400);
  assert.equal(drawerInset(-10, rests), 0);
});

test("outside a browser there is no drawer layout", () => {
  assert.equal(isDrawerLayout(), false);
});
