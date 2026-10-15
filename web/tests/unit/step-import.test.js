import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

let stepImport;
let workers;
let moduleId = 0;

beforeEach(async () => {
  workers = [];
  globalThis.Worker = class {
    messages = [];
    terminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    reply(data) {
      this.onmessage({ data: { id: this.messages.at(-1).id, ...data } });
    }
  };
  stepImport = await import(`../../src/lib/stepImport.js?test=${++moduleId}`);
});

test("resolves with the worker's bodies", async () => {
  const result = stepImport.tessellateStep(new ArrayBuffer(4));
  workers[0].reply({ type: "result", bodies: ["body"] });
  assert.deepEqual(await result, ["body"]);
});

test("a post that throws rejects, and the next import still works on the same worker", async () => {
  const result = stepImport.tessellateStep(new ArrayBuffer(4));
  workers[0].reply({ type: "result", bodies: [] });
  await result;
  const post = workers[0].postMessage;
  workers[0].postMessage = () => {
    throw new Error("buffer is detached");
  };
  await assert.rejects(stepImport.tessellateStep(new ArrayBuffer(4)), /detached/);
  workers[0].postMessage = post;
  const next = stepImport.tessellateStep(new ArrayBuffer(4));
  workers[0].reply({ type: "result", bodies: ["next"] });
  assert.deepEqual(await next, ["next"]);
  // Nothing was left behind for a later crash to reject twice.
  workers[0].onerror({ message: "crash" });
  assert.equal(workers.length, 1);
});

test("aborting the signal rejects with AbortError and drops the busy worker", async () => {
  const controller = new AbortController();
  const result = stepImport.tessellateStep(new ArrayBuffer(4), { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(workers[0].terminated, true);
  // A late reply from the dropped worker is ignored; the next import
  // gets a fresh one.
  const next = stepImport.tessellateStep(new ArrayBuffer(4));
  assert.equal(workers.length, 2);
  workers[1].reply({ type: "result", bodies: ["fresh"] });
  assert.deepEqual(await next, ["fresh"]);
});

test("an already-aborted signal never reaches the worker", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(stepImport.tessellateStep(new ArrayBuffer(4), { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(workers.length, 0);
});

test("a settled import's signal aborting later changes nothing", async () => {
  const controller = new AbortController();
  const result = stepImport.tessellateStep(new ArrayBuffer(4), { signal: controller.signal });
  workers[0].reply({ type: "result", bodies: [] });
  await result;
  controller.abort();
  assert.equal(workers[0].terminated, false);
});
