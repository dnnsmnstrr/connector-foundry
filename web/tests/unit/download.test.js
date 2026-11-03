import test from "node:test";
import assert from "node:assert/strict";

import { captureDownload, downloadBlob } from "../../src/lib/download.js";

test("captureDownload takes the next file downloadBlob gets, even one that comes later", async () => {
  const file = await captureDownload(
    () => setTimeout(() => downloadBlob("abc", "plate.stl", "model/stl"), 5),
    1000,
  );
  assert.equal(file.filename, "plate.stl");
  assert.equal(await file.blob.text(), "abc");
  assert.equal(file.blob.type, "model/stl");
});

test("captureDownload gives up when no file comes, and lets the next one through", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const waiting = captureDownload(() => {}, 100_000);
  t.mock.timers.tick(100_000);
  await assert.rejects(waiting, /No file came within 100 s/);
  // Nothing is still waiting: a second capture starts.
  const next = captureDownload(() => downloadBlob("x", "a.scad"), 1000);
  assert.equal((await next).filename, "a.scad");
});

test("captureDownload takes one export at a time, and passes on what run throws", async () => {
  const first = captureDownload(() => {}, 1000);
  await assert.rejects(
    captureDownload(() => {}, 1000),
    /Another export is still running/,
  );
  downloadBlob("x", "first.stl");
  assert.equal((await first).filename, "first.stl");
  await assert.rejects(
    captureDownload(() => {
      throw new Error("Name the bench first.");
    }, 1000),
    /Name the bench first/,
  );
  // The throw left nothing waiting.
  assert.equal((await captureDownload(() => downloadBlob("y", "b.stl"), 1000)).filename, "b.stl");
});
