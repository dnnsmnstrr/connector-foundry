import test from "node:test";
import assert from "node:assert/strict";

import { enumerateSlots, fitGridCounts } from "../../src/lib/slots.js";

const gridfinity = { id: "gridfinity/base", slots: { pitch: 42 }, defaults: {} };
const bitbeam = {
  id: "bitbeam/plate",
  slots: { pitch: 8, count_params: ["nx", "ny"] },
  defaults: { nx: 3, ny: 2 },
};

const gridSize = (slots) => [new Set(slots.map((s) => s.i)).size, new Set(slots.map((s) => s.j)).size];

test("a free grid's counts are the nearest odd number of pitches, exact multiples included", () => {
  // 1 pitch -> 1, 2 -> 3 (rounds up to odd), 3 -> 3, 4 -> 5.
  for (const [pitches, expected] of [
    [1, 1],
    [2, 3],
    [3, 3],
    [4, 5],
  ]) {
    const slots = enumerateSlots(gridfinity, {}, [42 * pitches, 42, 7]);
    assert.deepEqual(gridSize(slots), [expected, 1], `${pitches} pitches`);
  }
  // Under one pitch is still one slot, never zero.
  assert.equal(enumerateSlots(gridfinity, {}, [10, 10, 7]).length, 1);
});

test("a free grid is centered and sits on the top face", () => {
  const slots = enumerateSlots(gridfinity, {}, [126, 42, 7]);
  // `+ 0` folds the -0 a centered index can produce into 0.
  assert.deepEqual(
    slots.map((s) => [s.name, s.x + 0, s.y + 0, s.z]),
    [
      ["mount_-1_0", -42, 0, 3.5],
      ["mount_0_0", 0, 0, 3.5],
      ["mount_1_0", 42, 0, 3.5],
    ],
  );
});

test("a feature-locked grid takes its counts from count_params over the defaults, not the mesh", () => {
  const slots = enumerateSlots(bitbeam, { nx: 4 }, [999, 999, 4]);
  assert.deepEqual(gridSize(slots), [4, 2]);
  // An even count puts the slots on half-pitch offsets either side of 0.
  assert.deepEqual([...new Set(slots.map((s) => s.x))], [-12, -4, 4, 12]);
  assert.deepEqual([...new Set(slots.map((s) => s.y))], [-4, 4]);
});

test("slots.center adds a middle mount_0_0 to an even grid from 2 x 2 up, and nowhere else", () => {
  const soldr = {
    id: "soldr/base",
    slots: { pitch: 30.5, count_params: ["gx", "gy"], center: true },
    defaults: { gx: 2, gy: 1 },
  };
  const middle = (params) => enumerateSlots(soldr, params, [0, 0, 3]).filter((s) => s.name === "mount_0_0");
  assert.deepEqual(
    middle({ gx: 2, gy: 2 }).map((s) => [s.x, s.y, s.z]),
    [[0, 0, 1.5]],
  );
  assert.equal(middle({ gx: 2, gy: 3 }).length, 1);
  // An odd grid has its own middle slot: still exactly one, not two.
  assert.equal(middle({ gx: 3, gy: 3 }).length, 1);
  // A row of two has its middle on the seam: no slot there.
  assert.equal(middle({ gx: 2, gy: 1 }).length, 0);
  // Without the flag, an even grid keeps its middle free.
  assert.equal(
    enumerateSlots(bitbeam, { nx: 2, ny: 2 }, [0, 0, 4]).filter((s) => s.name === "mount_0_0").length,
    0,
  );
});

test("fitGridCounts: the largest count that fits, with slack for float noise", () => {
  assert.deepEqual(fitGridCounts(bitbeam, [41.5, 25]), { nx: 5, ny: 3 });
  // Exactly five pitches less a little mesh noise is still five.
  assert.deepEqual(fitGridCounts(bitbeam, [40 - 0.005, 16]), { nx: 5, ny: 2 });
  assert.deepEqual(fitGridCounts(bitbeam, [40 - 0.05, 16]), { nx: 4, ny: 2 });
  assert.deepEqual(fitGridCounts(bitbeam, [3, 0]), { nx: 1, ny: 1 });
});

test("fitGridCounts: a measurement that isn't a number fits one, not NaN", () => {
  assert.deepEqual(fitGridCounts(bitbeam, [NaN, -Infinity]), { nx: 1, ny: 1 });
  assert.deepEqual(fitGridCounts(bitbeam, [undefined, 16]), { nx: 1, ny: 2 });
});

test("fitGridCounts: nothing to fit without a count_params grid or a measurement", () => {
  assert.equal(fitGridCounts(gridfinity, [100, 100]), null);
  assert.equal(fitGridCounts({ id: "basics/plate", defaults: {} }, [100, 100]), null);
  assert.equal(fitGridCounts(bitbeam, null), null);
});
