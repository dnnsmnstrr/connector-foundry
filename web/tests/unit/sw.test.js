import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// The service worker (src/sw.js) run in a vm context with a fake global
// scope: the events, the cache storage and the network are the test's,
// so each routing rule can be checked by dispatching a fetch event and
// looking at what was fetched and what was stored. The source is loaded
// as written, token and all, so the cache is named after the placeholder.
const SOURCE = fs.readFileSync(new URL("../../src/sw.js", import.meta.url), "utf8");
const CACHE = "cf-__BUILD_ID__";
const LOCAL = "http://127.0.0.1:4194/";
const PAGES = "https://dnnsmnstrr.github.io/connector-foundry/";

/** A Cache: URL → Response, with the one match option the worker uses. */
class FakeCache {
  #entries = new Map();
  async match(request, { ignoreSearch = false } = {}) {
    const wanted = new URL(request.url);
    if (ignoreSearch) wanted.search = "";
    for (const [key, response] of this.#entries) {
      const candidate = new URL(key);
      if (ignoreSearch) candidate.search = "";
      // A fresh body each time, as the real one hands out.
      if (candidate.href === wanted.href) return response.clone();
    }
    return undefined;
  }
  async put(request, response) {
    this.#entries.set(request.url, response);
  }
  async keys() {
    return [...this.#entries.keys()].map((url) => new Request(url));
  }
  urls() {
    return [...this.#entries.keys()];
  }
}

class FakeCacheStorage {
  stores = new Map();
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name) {
    return this.stores.delete(name);
  }
}

/**
 * The worker, evaluated against a scope. `fetched` lists every network
 * request it made; `network` is what the network answers (swap it to
 * simulate a deploy or going offline).
 */
function load(scope = LOCAL) {
  const listeners = {};
  const worker = {
    listeners,
    fetched: [],
    skipWaiting: 0,
    claimed: 0,
    caches: new FakeCacheStorage(),
    network: async (request) => new Response(`body of ${request.url}`, { status: 200 }),
    async cached(name = CACHE) {
      return (await this.caches.open(name)).urls();
    },
  };
  const self = {
    registration: { scope },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: () => {
      worker.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        worker.claimed += 1;
      },
    },
  };
  const fetch = (request) => {
    worker.fetched.push(request.url);
    return worker.network(request);
  };
  const context = vm.createContext({ self, caches: worker.caches, fetch, URL, Request, Response });
  vm.runInContext(SOURCE, context, { filename: "sw.js" });
  return worker;
}

/**
 * A fetch event as the browser dispatches it. `answer` is the promise the
 * worker passed to respondWith, or null when it left the request to the
 * browser; `settled()` waits for the work it queued with waitUntil
 * (storing, refreshing), including work queued while waiting.
 */
function dispatch(worker, request) {
  let answer = null;
  const pending = [];
  worker.listeners.fetch({
    request,
    respondWith(response) {
      answer = Promise.resolve(response);
    },
    waitUntil(promise) {
      pending.push(Promise.resolve(promise).catch(() => {}));
    },
  });
  return {
    answer,
    async settled() {
      for (let i = 0; i < pending.length; i++) await pending[i];
    },
  };
}

/** The body the worker served for a request it handled, once its follow-up work is done. */
async function served(worker, request) {
  const { answer, settled } = dispatch(worker, request);
  assert.ok(answer, `${request.url} is handled`);
  const response = await answer;
  await settled();
  return response;
}

function passedThrough(worker, request) {
  const before = worker.fetched.length;
  assert.equal(dispatch(worker, request).answer, null, `${request.url} is left to the browser`);
  assert.equal(worker.fetched.length, before);
}

// Node refuses `mode: "navigate"` in RequestInit, as the spec says it
// must; a browser sets it on the request of a navigation.
function navigation(url) {
  return Object.defineProperty(new Request(url), "mode", { value: "navigate" });
}

test("hashed assets are fetched once and then served from the cache", async () => {
  const worker = load();
  const url = `${LOCAL}assets/index-abc123.js`;
  assert.equal(await (await served(worker, new Request(url))).text(), `body of ${url}`);
  assert.deepEqual(worker.fetched, [url]);
  assert.deepEqual(await worker.cached(), [url]);

  worker.network = async () => new Response("a different file", { status: 200 });
  assert.equal(await (await served(worker, new Request(url))).text(), `body of ${url}`);
  assert.deepEqual(worker.fetched, [url], "a hit is final");
});

test("a same-origin URL with a v= query is immutable too; one without it passes through", async () => {
  const worker = load();
  const versioned = `${LOCAL}scad-bundle.json?v=abc123`;
  await served(worker, new Request(versioned));
  await served(worker, new Request(versioned));
  assert.deepEqual(worker.fetched, [versioned]);
  assert.deepEqual(await worker.cached(), [versioned]);

  // An old build's unversioned request, and a query that only looks like one.
  passedThrough(worker, new Request(`${LOCAL}scad-bundle.json`));
  passedThrough(worker, new Request(`${LOCAL}app/other.json?variant=1`));
});

test("the catalogue and the global defaults are always fetched, and kept for offline", async () => {
  const worker = load();
  for (const name of ["catalogue.json", "global-defaults.json"]) {
    const url = `${LOCAL}${name}`;
    worker.network = async () => new Response(`${name} v1`, { status: 200 });
    assert.equal(await (await served(worker, new Request(url))).text(), `${name} v1`);
    // A deploy: the next request gets the new copy, never the cached one.
    worker.network = async () => new Response(`${name} v2`, { status: 200 });
    assert.equal(await (await served(worker, new Request(url))).text(), `${name} v2`);
    worker.network = async () => {
      throw new TypeError("Failed to fetch");
    };
    assert.equal(await (await served(worker, new Request(url))).text(), `${name} v2`);
  }
});

test("navigations go to the network, and to the cache only when the network fails", async () => {
  const worker = load();
  const url = `${LOCAL}app/`;
  worker.network = async () => new Response("<html>v1</html>", { status: 200 });
  assert.equal(await (await served(worker, navigation(url))).text(), "<html>v1</html>");
  assert.deepEqual(await worker.cached(), [url]);

  // A deploy: the next load gets the new page, not the cached one.
  worker.network = async () => new Response("<html>v2</html>", { status: 200 });
  assert.equal(await (await served(worker, navigation(url))).text(), "<html>v2</html>");
  assert.deepEqual(worker.fetched, [url, url]);

  // Offline: the last page seen, whatever query the link carried.
  worker.network = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await (await served(worker, navigation(`${url}?from=link`))).text(), "<html>v2</html>");
  // Nothing cached for the page: the failure reaches the browser as it would without a worker.
  await assert.rejects(dispatch(worker, navigation(`${LOCAL}app/elsewhere/`)).answer, TypeError);
});

test("thumbnails, icons, the manifest and gate.js are served stale and refreshed behind", async () => {
  const worker = load();
  const url = `${LOCAL}thumbnails/basics-plate.png`;
  worker.network = async () => new Response("v1", { status: 200 });
  assert.equal(await (await served(worker, new Request(url))).text(), "v1", "nothing cached: the network's");

  worker.network = async () => new Response("v2", { status: 200 });
  assert.equal(await (await served(worker, new Request(url))).text(), "v1", "the cached copy, at once");
  assert.deepEqual(worker.fetched, [url, url], "and a refresh behind it");
  assert.equal(await (await served(worker, new Request(url))).text(), "v2");

  for (const path of ["icons/icon-192.png", "app/manifest.webmanifest", "gate.js"]) {
    assert.ok(dispatch(worker, new Request(LOCAL + path)).answer, `${path} is handled`);
  }
  passedThrough(worker, new Request(`${LOCAL}app/other.js`));
});

test("responses other than a complete 200 are not kept", async () => {
  const worker = load();
  const missing = `${LOCAL}assets/gone-123.js`;
  worker.network = async () => new Response("not here", { status: 404 });
  assert.equal((await served(worker, new Request(missing))).status, 404);
  await served(worker, new Request(missing));
  assert.deepEqual(worker.fetched, [missing, missing]);

  const opaque = `${LOCAL}assets/opaque-123.js`;
  worker.network = async () =>
    Object.defineProperty(new Response("?", { status: 200 }), "type", { value: "opaque" });
  await served(worker, new Request(opaque));
  assert.deepEqual(await worker.cached(), []);
});

test("other methods, no-store requests and other origins are left to the browser", async () => {
  const worker = load();
  passedThrough(worker, new Request(`${LOCAL}assets/index-abc123.js`, { method: "POST", body: "x" }));
  passedThrough(worker, new Request(`${LOCAL}assets/index-abc123.js`, { cache: "no-store" }));
  passedThrough(worker, new Request("https://api.github.com/repos/x/y/releases?v=1"));
  passedThrough(worker, new Request("https://cdn.example/assets/index-abc123.js"));
});

test("the base comes from the registration's scope, so the Pages deployment works unchanged", async () => {
  const worker = load(PAGES);
  const asset = `${PAGES}assets/index-abc123.js`;
  await served(worker, new Request(asset));
  assert.deepEqual(await worker.cached(), [asset]);
  assert.ok(dispatch(worker, new Request(`${PAGES}thumbnails/x.png`)).answer);
  assert.ok(dispatch(worker, new Request(`${PAGES}app/manifest.webmanifest`)).answer);
  assert.ok(dispatch(worker, navigation(`${PAGES}app/`)).answer);
  // Same origin, but another site on it.
  passedThrough(worker, new Request("https://dnnsmnstrr.github.io/assets/index-abc123.js"));
  passedThrough(worker, new Request("https://dnnsmnstrr.github.io/other/thumbnails/x.png"));
});

test("install takes over at once; activate claims the pages and keeps two generations of cache", async () => {
  const worker = load();
  await worker.caches.open("cf-older");
  const previous = await worker.caches.open("cf-old");
  await worker.caches.open("other-library");
  const chunk = `${LOCAL}assets/chunk-old123.js`;
  const bundle = `${LOCAL}scad-bundle.json?v=abc123`;
  await previous.put(new Request(chunk), new Response("chunk", { status: 200 }));
  await previous.put(new Request(bundle), new Response("bundle", { status: 200 }));
  await previous.put(new Request(`${LOCAL}app/`), new Response("shell", { status: 200 }));

  worker.listeners.install({ waitUntil() {} });
  assert.equal(worker.skipWaiting, 1);

  const pending = [];
  worker.listeners.activate({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
  assert.equal(worker.claimed, 1);
  // This build's and the one before it; anything older goes, and caches
  // that are not this app's are left alone.
  assert.deepEqual((await worker.caches.keys()).sort(), [CACHE, "cf-old", "other-library"]);
  assert.deepEqual(await worker.cached(), [], "nothing is copied at activation");

  // What a deploy left unchanged comes from the previous build's cache —
  // the bundle whose sources did not change, an old chunk — with no
  // download, and is carried into this build's cache for the next one.
  for (const [url, body] of [
    [bundle, "bundle"],
    [chunk, "chunk"],
  ]) {
    assert.equal(await (await served(worker, new Request(url))).text(), body);
  }
  assert.deepEqual(worker.fetched, []);
  assert.deepEqual((await worker.cached()).sort(), [chunk, bundle].sort());

  // Offline, the page the previous worker stored is the fallback.
  worker.network = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await (await served(worker, navigation(`${LOCAL}app/`))).text(), "shell");
});

test("navigations outside the app, the landing page and the guides, are left to the browser", () => {
  const worker = load();
  for (const url of [LOCAL, `${LOCAL}docs/`, `${LOCAL}docs/bench/`]) {
    assert.equal(dispatch(worker, navigation(url)).answer, null, url);
  }
});
