import test from "node:test";
import assert from "node:assert/strict";

import { captureDownload, downloadBlob } from "../../src/lib/download.js";

// downloadBlob()'s browser path, far enough to count the files it starts
// saving: an <a download> clicked. Node has URL.createObjectURL already.
function countDownloads(t) {
  const names = [];
  const globals = /** @type {any} */ (globalThis);
  const before = { document: globals.document, window: globals.window };
  globals.document = {
    body: { appendChild() {} },
    createElement: () => ({
      click() {
        names.push(this.download);
      },
      remove() {},
    }),
  };
  globals.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => Object.assign(globals, before));
  return names;
}

test("captureDownload takes the file its export hands over, even one that comes later", async () => {
  const file = await captureDownload(
    (save) => setTimeout(() => save("abc", "plate.stl", "model/stl"), 5),
    1000,
  );
  assert.equal(file.filename, "plate.stl");
  assert.equal(await file.blob.text(), "abc");
  assert.equal(file.blob.type, "model/stl");
  // A Blob goes through as it is.
  const blob = new Blob(["x"], { type: "application/json" });
  assert.equal((await captureDownload((save) => save(blob, "bench.json"), 1000)).blob, blob);
});

test("a download someone else starts while an export renders is not taken for it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const downloads = countDownloads(t);
  // The agent's export renders…
  let finish = () => {};
  const waiting = captureDownload((save) => {
    finish = () => save("solid", "plate.stl", "model/stl");
  }, 100_000);
  // …the user downloads their settings meanwhile: theirs, saved their way…
  downloadBlob("{}", "connector-foundry-2026-11-11.json", "application/json");
  assert.deepEqual(downloads, ["connector-foundry-2026-11-11.json"]);
  // …and the agent still gets the file its own export made.
  finish();
  assert.equal((await waiting).filename, "plate.stl");
  assert.equal(downloads.length, 1);
});

test("captureDownload gives up when no file comes; one that comes too late is downloaded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const downloads = countDownloads(t);
  let finish = () => {};
  const waiting = captureDownload((save) => {
    finish = () => save("solid", "late.stl");
  }, 100_000);
  t.mock.timers.tick(100_000);
  await assert.rejects(waiting, /No file came within 100 s/);
  finish();
  assert.deepEqual(downloads, ["late.stl"]);
});

test("captureDownload takes one file, and passes on what run throws", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const downloads = countDownloads(t);
  // A second file from the same export has nowhere to go but a download.
  const file = await captureDownload((save) => {
    save("a", "first.stl");
    save("b", "second.stl");
  }, 1000);
  assert.equal(file.filename, "first.stl");
  assert.deepEqual(downloads, ["second.stl"]);
  await assert.rejects(
    captureDownload(() => {
      throw new Error("Name the bench first.");
    }, 1000),
    /Name the bench first/,
  );
  // Two exports at once each get their own file.
  const [one, two] = await Promise.all([
    captureDownload((save) => save("1", "one.stl"), 1000),
    captureDownload((save) => save("2", "two.stl"), 1000),
  ]);
  assert.deepEqual([one.filename, two.filename], ["one.stl", "two.stl"]);
});
