import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

let client;
let workers;
let moduleId = 0;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const request = (size) => ({ scadFile: "parts/basics/plate.scad", module: "plate", params: { size } });

beforeEach(async () => {
  workers = [];
  globalThis.Worker = class {
    messages = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    result(stl = new ArrayBuffer(12)) {
      this.onmessage({ data: { id: this.messages.at(-1).id, type: "result", stl } });
      return stl;
    }
  };
  client = await import(`../../src/lib/openscad-client.js?test=${++moduleId}`);
});

test("serializes jobs, deduplicates consumers, and caches successful results", async () => {
  const first = client.renderPart(request(1));
  const same = client.renderPart(request(1));
  const second = client.renderPart(request(2));
  await tick();
  assert.equal(workers[0].messages.length, 1);
  assert.equal(client.getRenderActivity(), 2);
  const bytes = workers[0].result();
  assert.equal(await first, bytes);
  assert.equal(await same, bytes);
  await tick();
  assert.equal(workers[0].messages.length, 2);
  workers[0].result();
  await second;
  assert.equal(await client.renderPart(request(1)), bytes);
  assert.equal(workers[0].messages.length, 2);
  assert.equal(client.getRenderActivity(), 0);
});

test("drops obsolete queued previews without cancelling an export", async () => {
  const exported = client.renderPart(request(1));
  const controller = new AbortController();
  const obsolete = client.renderPart(request(2), { signal: controller.signal });
  const rejected = assert.rejects(obsolete, { name: "AbortError" });
  await tick();
  controller.abort();
  const latest = client.renderPart(request(3));
  assert.equal(workers[0].terminated, false);
  workers[0].result();
  await exported;
  await tick();
  assert.deepEqual(workers[0].messages.map((m) => m.params.size), [1, 3]);
  workers[0].result();
  await latest;
  await rejected;
});

test("interrupts an obsolete active preview and ignores its late result", async () => {
  const controller = new AbortController();
  const preview = client.renderPart(request(1), { signal: controller.signal });
  const rejected = assert.rejects(preview, { name: "AbortError" });
  await tick();
  controller.abort();
  const latest = client.renderPart(request(2));
  await tick();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  workers[0].result();
  assert.equal(client.getCachedRender(request(1)), null);
  const bytes = workers[1].result();
  assert.equal(await latest, bytes);
  await rejected;
});

test("an export sharing a preview keeps its worker when the preview aborts", async () => {
  const controller = new AbortController();
  const preview = client.renderPart(request(1), { signal: controller.signal });
  const rejected = assert.rejects(preview, { name: "AbortError" });
  const exported = client.renderPart(request(1));
  await tick();
  controller.abort();
  assert.equal(workers[0].terminated, false);
  const bytes = workers[0].result();
  assert.equal(await exported, bytes);
  await rejected;
});

test("a worker crash fails the active job and resumes queued exports on a fresh worker", async () => {
  const first = client.renderPart(request(1));
  const rejected = assert.rejects(first, /worker failed: crash/);
  const exported = client.renderPart(request(2));
  await tick();
  workers[0].onerror({ message: "crash" });
  await tick();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].messages[0].params.size, 2);
  workers[1].result();
  await exported;
  await rejected;
});

test("a timeout terminates only the active job and allows retry", async (t) => {
  const deadlines = [];
  t.mock.method(globalThis, "setTimeout", (fn, ms) => { deadlines.push({ fn, ms }); return 0; });
  const first = client.renderPart(request(1));
  const rejected = assert.rejects(first, /timed out/);
  const next = client.renderPart(request(2));
  await tick();
  assert.equal(deadlines[0].ms, 120_000);
  deadlines[0].fn();
  await tick();
  assert.equal(workers[0].terminated, true);
  workers[1].result();
  await next;
  await rejected;
  const retry = client.renderPart(request(1));
  await tick();
  workers[1].result();
  await retry;
});

test("explicit cancellation clears active and queued work and activity", async () => {
  const counts = [];
  const unsubscribe = client.subscribeRenderActivity(() => counts.push(client.getRenderActivity()));
  const first = assert.rejects(client.renderPart(request(1)), { name: "AbortError" });
  const second = assert.rejects(client.renderPart(request(2)), { name: "AbortError" });
  await tick();
  client.cancelRenders();
  await Promise.all([first, second]);
  assert.equal(workers[0].terminated, true);
  assert.equal(client.getRenderActivity(), 0);
  assert.equal(counts.at(-1), 0);
  unsubscribe();
});

test("a rejected postMessage does not strand queued jobs", async () => {
  const first = client.renderPart(request(1));
  await tick();
  workers[0].result();
  // The first message has already succeeded; exercise the next post.
  await first;
  workers[0].postMessage = () => { throw new Error("clone failed"); };
  const bad = assert.rejects(client.renderPart(request(2)), /clone failed/);
  const good = client.renderPart(request(3));
  await tick();
  assert.equal(workers[0].terminated, true);
  workers[1].result();
  await good;
  await bad;
});

test("parameter ordering shares cache, but printer settings invalidate it", async () => {
  const a = { ...request(1), params: { x: 1, y: 2 } };
  const b = { ...a, params: { y: 2, x: 1 } };
  assert.equal(client.renderRequestKey(a), client.renderRequestKey(b));
  const result = client.renderPart(a);
  await tick();
  const bytes = workers[0].result();
  await result;
  assert.equal(client.getCachedRender(b), bytes);
  assert.equal(client.getCachedRender({ ...b, globalOverrides: { FIT_CLEARANCE: 0.5 } }), null);
});
