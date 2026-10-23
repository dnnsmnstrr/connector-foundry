import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

let client;
let workers;
let moduleId = 0;
const tick = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
const request = (size) => ({ scadFile: "parts/basics/plate.scad", module: "plate", params: { size } });

beforeEach(async () => {
  workers = [];
  globalThis.Worker = class {
    // Render requests only, so the assertions on `messages` keep meaning
    // renders; warm-ups (which carry no id and get no answer) go to `warms`.
    messages = [];
    warms = [];
    terminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage(message) {
      if (message?.type === "warm") this.warms.push(message);
      else this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
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
  assert.deepEqual(
    workers[0].messages.map((m) => m.params.size),
    [1, 3],
  );
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
  // The next render was requested before the stop's warm-up ran, so it
  // takes the fresh worker with nothing queued ahead of it.
  assert.equal(workers[1].warms.length, 0);
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
  t.mock.method(globalThis, "setTimeout", (fn, ms) => {
    deadlines.push({ fn, ms });
    return 0;
  });
  const first = client.renderPart(request(1));
  const rejected = assert.rejects(first, /timed out/);
  const next = client.renderPart(request(2));
  await tick();
  assert.equal(deadlines[0].ms, 120_000);
  deadlines[0].fn();
  await tick();
  assert.equal(workers[0].terminated, true);
  // The queued render takes the fresh worker, with no warm-up ahead of it.
  assert.equal(workers.length, 2);
  assert.equal(workers[1].warms.length, 0);
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
  // The user asked for the work to stop: no worker is warmed in its place.
  await tick();
  assert.equal(workers.length, 1);
  unsubscribe();
});

test("a rejected postMessage does not strand queued jobs", async () => {
  const first = client.renderPart(request(1));
  await tick();
  workers[0].result();
  // The first message has already succeeded; exercise the next post.
  await first;
  workers[0].postMessage = () => {
    throw new Error("clone failed");
  };
  const bad = assert.rejects(client.renderPart(request(2)), /clone failed/);
  const good = client.renderPart(request(3));
  await tick();
  assert.equal(workers[0].terminated, true);
  workers[1].result();
  await good;
  await bad;
});

test("a warm-up is not a job and leaves render activity alone", async () => {
  const counts = [];
  const unsubscribe = client.subscribeRenderActivity(() => counts.push(client.getRenderActivity()));
  client.warmRenderer();
  client.warmRenderer();
  await tick();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].warms.length, 1);
  assert.equal(workers[0].messages.length, 0);
  assert.equal(client.getRenderActivity(), 0);
  assert.deepEqual(counts, []);
  // The first render goes to the warmed worker, queued behind the warm-up
  // in the worker's own FIFO.
  const first = client.renderPart(request(1));
  await tick();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].messages[0].params.size, 1);
  const bytes = workers[0].result();
  assert.equal(await first, bytes);
  assert.equal(workers[0].warms.length, 1);
  assert.deepEqual(counts, [1, 0]);
  unsubscribe();
});

test("warmRenderer does nothing while a render is pending", async () => {
  const first = client.renderPart(request(1));
  client.warmRenderer();
  await tick();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].warms.length, 0);
  assert.equal(workers[0].messages.length, 1);
  workers[0].result();
  await first;
});

test("an abort that stops the active render with nothing queued warms a fresh worker for the next one", async () => {
  const controller = new AbortController();
  const preview = client.renderPart(request(1), { signal: controller.signal });
  const rejected = assert.rejects(preview, { name: "AbortError" });
  await tick();
  controller.abort();
  await rejected;
  await tick();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  assert.equal(workers[1].warms.length, 1);
  assert.equal(workers[1].messages.length, 0);
  assert.equal(client.getRenderActivity(), 0);
  // The debounced next render lands on the warmed worker.
  const latest = client.renderPart(request(2));
  await tick();
  assert.equal(workers.length, 2);
  assert.equal(workers[1].messages[0].params.size, 2);
  const bytes = workers[1].result();
  assert.equal(await latest, bytes);
});

test("no warm-up goes ahead of a job queued when the active one aborts", async () => {
  const controller = new AbortController();
  const preview = client.renderPart(request(1), { signal: controller.signal });
  const rejected = assert.rejects(preview, { name: "AbortError" });
  const exported = client.renderPart(request(2));
  await tick();
  controller.abort();
  await tick();
  assert.equal(workers.length, 2);
  assert.equal(workers[1].warms.length, 0);
  assert.equal(workers[1].messages[0].params.size, 2);
  const bytes = workers[1].result();
  assert.equal(await exported, bytes);
  await rejected;
});

test("one abort that drops the active render and the one queued behind it warms one worker", async () => {
  // One signal for both, as the Bench's extents effect uses: its cleanup
  // aborts the active render first, while the queued one is still pending.
  const controller = new AbortController();
  const rejected = Promise.all([
    assert.rejects(client.renderPart(request(1), { signal: controller.signal }), { name: "AbortError" }),
    assert.rejects(client.renderPart(request(2), { signal: controller.signal }), { name: "AbortError" }),
  ]);
  await tick();
  controller.abort();
  await rejected;
  await tick();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  assert.equal(workers[1].warms.length, 1);
  assert.equal(workers[1].messages.length, 0);
  assert.equal(client.getRenderActivity(), 0);
});

test("a crash is not followed by a warm-up, and a warm-only worker that fails is dropped", async () => {
  const first = client.renderPart(request(1));
  const rejected = assert.rejects(first, /worker failed: crash/);
  await tick();
  workers[0].onerror({ message: "crash" });
  await rejected;
  await tick();
  // A worker that cannot load would otherwise respawn in a loop.
  assert.equal(workers.length, 1);

  client.warmRenderer();
  assert.equal(workers.length, 2);
  workers[1].onerror({ message: "script error" });
  await tick();
  assert.equal(workers[1].terminated, true);
  assert.equal(workers.length, 2);
  assert.equal(client.getRenderActivity(), 0);
  // The next real render creates a worker as it always has.
  const next = client.renderPart(request(2));
  await tick();
  assert.equal(workers.length, 3);
  assert.equal(workers[2].warms.length, 0);
  assert.equal(workers[2].messages[0].params.size, 2);
  const bytes = workers[2].result();
  assert.equal(await next, bytes);
});

test("a warm-up sets no timer, and a timeout with nothing queued warms a fresh worker", async (t) => {
  const deadlines = [];
  t.mock.method(globalThis, "setTimeout", (fn, ms) => {
    deadlines.push({ fn, ms });
    return 0;
  });
  client.warmRenderer();
  assert.equal(deadlines.length, 0);
  const first = client.renderPart(request(1));
  const rejected = assert.rejects(first, /timed out/);
  await tick();
  assert.equal(deadlines.length, 1);
  assert.equal(deadlines[0].ms, 120_000);
  deadlines[0].fn();
  await rejected;
  await tick();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  assert.equal(workers[1].warms.length, 1);
  assert.equal(deadlines.length, 1);
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

test("an assembly's imported mesh bytes are part of its cache key", async () => {
  // Same name, same holes, so the generated source is identical; only
  // the mounted mesh differs.
  const assembly = (bytes) => ({
    scadSource: 'import("imports/bracket.stl");',
    part: "all",
    importedFiles: new Map([["imports/bracket.stl", bytes]]),
  });
  const oldMesh = assembly(new Uint8Array([1, 2, 3, 4]));
  const result = client.renderPart(oldMesh);
  await tick();
  const bytes = workers[0].result();
  await result;
  assert.equal(client.getCachedRender(oldMesh), bytes);
  assert.equal(client.getCachedRender(assembly(new Uint8Array([1, 2, 3, 5]))), null);
  // The same bytes decoded again into a fresh buffer still hit.
  assert.equal(client.getCachedRender(assembly(new Uint8Array([1, 2, 3, 4]))), bytes);
  assert.equal(client.getCachedRender(assembly(new Uint8Array([1, 2, 3, 4]).buffer)), bytes);
});

test("bytesDigest tells apart buffers of equal length and honours a view's window", () => {
  const backing = new Uint8Array([9, 1, 2, 3, 9]);
  assert.equal(client.bytesDigest(backing.subarray(1, 4)), client.bytesDigest(new Uint8Array([1, 2, 3])));
  assert.notEqual(
    client.bytesDigest(new Uint8Array([1, 2, 3])),
    client.bytesDigest(new Uint8Array([3, 2, 1])),
  );
  assert.notEqual(client.bytesDigest(new Uint8Array(0)), client.bytesDigest(new Uint8Array(1)));
});

test("a cached result outlives a long pause: the cache is bounded by bytes, not time", async () => {
  const first = client.renderPart(request(1));
  await tick();
  const bytes = workers[0].result();
  assert.equal(await first, bytes);
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 60 * 1000;
  try {
    assert.equal(client.getCachedRender(request(1)), bytes);
    assert.equal(await client.renderPart(request(1)), bytes);
    assert.equal(workers[0].messages.length, 1);
  } finally {
    Date.now = realNow;
  }
});
