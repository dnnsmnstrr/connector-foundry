// The app's service worker: a runtime cache for the app at <base>app/ and
// everything it loads.
//
// Registered by main.jsx in production builds over https and on
// localhost — never under the desktop app's foundry: scheme, which loads
// the build from disk — and emitted by scripts/vite-plugin-sw.mjs as
// <base>sw.js with BUILD_ID filled in. A classic script with no imports:
// Firefox ran module service workers late, and nothing here needs one.
//
// Its scope is the site's base, not <base>app/: the render worker and the
// STEP worker are scripts under <base>assets/, and a dedicated worker is
// controlled by the registration whose scope covers the worker's own URL,
// not its page's — with an app/ scope the engine, the worker chunk and the
// .scad bundle they fetch were never seen by it. GitHub Pages cannot send
// Service-Worker-Allowed, so the file sits at the base to get that scope.
// The landing page and the guides are in scope too; their navigations
// pass through untouched, and their hashed assets and thumbnails take the
// same routes as the app's.
//
// Why it exists: GitHub Pages serves every file with `cache-control:
// max-age=600` and an mtime-based ETag, so ten minutes after any deploy a
// returning phone revalidated all ~6 MB of the app (the OpenSCAD worker
// chunk, the .wasm, scad-bundle.json) even when the bytes did not change
// — and there were 50 deploys in the last 30 days. The HTTP cache cannot
// know which files are immutable; this worker does:
//
// - A navigation to <base>app/ (the app's page) is NETWORK-FIRST. It is
//   the one unhashed entry point and names the chunks of a build, so it
//   must come from the network for a deploy to show up at the next load.
//   The cached copy is the offline fallback: the app shell opens with no
//   network at all. catalogue.json and global-defaults.json (11 KB
//   together, unversioned) go the same way: always current online, the
//   last copy offline.
// - `assets/` (content-hashed names) and any same-origin URL with a `v=`
//   query (the .scad bundle, whose URL lib/publicAsset.js versions with a
//   hash of its content) are IMMUTABLE: a cached copy is right until the
//   URL changes, so a hit is final and never revalidated.
// - Thumbnails, icons, the manifest and gate.js are unhashed and rarely
//   change: STALE-WHILE-REVALIDATE serves the cache and refreshes it
//   behind the response.
// - Everything else (another page's navigation, an unversioned bundle
//   request from an old build, api.github.com, any other origin, anything
//   but a GET) passes through untouched, as does a request that asked for
//   `cache: "no-store"`.
//
// Nothing is precached: a first visit downloads exactly what it needs and
// the cache fills as the app is used — a precache would cost every
// visitor the 10 MB engine before they chose a part.
//
// Two generations of cache, never more. Each build's cache is named after
// it (`cf-<BUILD_ID>`); activating a build's worker deletes every `cf-*`
// cache but its own and the one before it, and a miss in its own is
// looked up in that previous one and copied across. So what a deploy left
// unchanged — the engine, most chunks, the bundle when the sources did
// not change — is never downloaded again, an old tab's chunks stay
// loadable for a deploy (not a lazy chunk it never fetched: nobody had
// it), and the storage used stays at about two builds' worth instead of
// growing with every deploy. The previous cache is found per request, not
// remembered: the browser stops and restarts a service worker at will.
//
// Kill switch: deploy a <base>sw.js whose install calls skipWaiting() and
// whose activate deletes every `cf-*` cache, calls
// self.registration.unregister(), then reloads the open tabs
// (clients.matchAll({ type: "window" }), client.navigate(client.url)).
// Keep it deployed for a while: a browser only learns of it on its next
// visit.

const BUILD_ID = "__BUILD_ID__";
const CACHE = `cf-${BUILD_ID}`;

// The site's base (Vite's `base`: "/" locally, "/connector-foundry/" on
// GitHub Pages) as an absolute URL: the registration's scope, so the one
// file serves both.
function base() {
  return self.registration.scope;
}

/**
 * What the worker does with a request: "network" (network-first),
 * "immutable" (cache-first), "revalidate" (stale-while-revalidate), or
 * null to leave it to the browser.
 * @param {Request} request
 */
function route(request) {
  if (request.method !== "GET" || request.cache === "no-store") return null;
  const site = base();
  const url = new URL(request.url);
  if (url.origin !== new URL(site).origin) return null;
  const path = url.origin + url.pathname;
  if (request.mode === "navigate") return path.startsWith(`${site}app/`) ? "network" : null;
  if (url.href.startsWith(`${site}assets/`) || url.searchParams.has("v")) return "immutable";
  if (path === `${site}catalogue.json` || path === `${site}global-defaults.json`) return "network";
  if (
    path.startsWith(`${site}thumbnails/`) ||
    path.startsWith(`${site}icons/`) ||
    path === `${site}app/manifest.webmanifest` ||
    path === `${site}gate.js`
  )
    return "revalidate";
  return null;
}

// Every lookup ignores Vary. Here a URL is the whole identity of what it
// names (a content-hashed chunk, a versioned bundle), and a server that
// varies on Origin — Vite's preview does — would otherwise miss a module
// script cached from a request carrying one, the way <script type=module
// crossorigin> does, whenever the next request is made without.
const MATCH = { ignoreVary: true };

// The previous build's cache: the newest `cf-*` cache other than this
// build's (caches.keys() lists them in the order they were made). Null on
// a first visit.
async function previousCache() {
  const names = (await caches.keys()).filter((name) => name.startsWith("cf-") && name !== CACHE);
  return names.length ? caches.open(names[names.length - 1]) : null;
}

// A request's cached response: this build's copy, else the previous
// build's, which is copied into this build's cache so the next generation
// still has it.
async function lookup(cache, request, options = MATCH) {
  const own = await cache.match(request, options);
  if (own) return own;
  const previous = await previousCache();
  const carried = previous && (await previous.match(request, options));
  if (!carried) return undefined;
  await cache.put(request, carried.clone()).catch(() => {});
  return carried;
}

// Only a complete success is worth keeping: an error page would be served
// forever under the immutable rule, and an opaque response hides its
// status (and is charged to the quota at a padded size).
function cacheable(response) {
  return response.status === 200 && response.type !== "opaque";
}

// Storing is best effort — a full quota must not fail the response. The
// clone is taken here, before the page starts reading the body.
function store(cache, request, response) {
  if (!cacheable(response)) return Promise.resolve();
  return cache.put(request, response.clone()).catch(() => {});
}

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(event.request);
    event.waitUntil(store(cache, event.request, response));
    return response;
  } catch (error) {
    // Offline: the last copy, whatever query it was asked for with (the
    // app's state travels in the hash, which never reaches the worker) —
    // the previous build's too, which holds the page that brought this
    // worker in.
    const cached = await lookup(cache, event.request, { ...MATCH, ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await lookup(cache, event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  event.waitUntil(store(cache, event.request, response));
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await lookup(cache, event.request);
  const refresh = fetch(event.request).then((response) => {
    event.waitUntil(store(cache, event.request, response));
    return response;
  });
  if (!cached) return refresh;
  // A failed refresh is nothing to report: the cached copy was served.
  event.waitUntil(refresh.catch(() => {}));
  return cached;
}

self.addEventListener("fetch", (event) => {
  const kind = route(event.request);
  if (kind === "network") event.respondWith(networkFirst(event));
  else if (kind === "immutable") event.respondWith(cacheFirst(event));
  else if (kind === "revalidate") event.respondWith(staleWhileRevalidate(event));
});

self.addEventListener("install", () => {
  // No precache, so nothing to wait for: replace the previous build's
  // worker at once rather than after its last tab closes.
  self.skipWaiting();
});

async function activate() {
  await self.clients.claim();
  await caches.open(CACHE);
  // Keep this build's cache and the one before it; nothing is copied —
  // lookup() carries over what is asked for again.
  const others = (await caches.keys()).filter((name) => name.startsWith("cf-") && name !== CACHE);
  for (const name of others.slice(0, -1)) await caches.delete(name);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});
