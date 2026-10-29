import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILD_QUERY_TIMEOUT_MS,
  UPDATE_CHECK_MIN_MS,
  checkForWebUpdate,
  getWebAppStatus,
  installPlatform,
  isStandalone,
  promptInstall,
  reloadToUpdate,
  resetWebAppForTests,
  startWebApp,
  subscribeWebAppStatus,
} from "../../src/lib/webApp.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15";

/** A service worker that says it is `build` when asked, or never answers. */
function fakeWorker(build) {
  return {
    state: "activated",
    messages: [],
    postMessage(data, ports) {
      this.messages.push(data);
      if (build !== null && data?.type === "build-id") ports[0].postMessage(build);
    },
  };
}

/**
 * A window with just what lib/webApp.js touches: events, display-mode
 * queries, a navigator with a service worker container whose registration
 * counts update() calls, the document's visibility, session storage, and
 * reload().
 */
function fakeWindow({
  userAgent = ANDROID,
  platform = "Linux",
  touch = 5,
  standalone = false,
  controller = null,
} = {}) {
  const events = new EventTarget();
  const document = Object.assign(new EventTarget(), { readyState: "complete", visibilityState: "visible" });
  const registration = {
    updates: 0,
    installing: null,
    active: controller,
    /** @type {() => Promise<void>} */
    update() {
      this.updates++;
      return Promise.resolve();
    },
  };
  const container = Object.assign(new EventTarget(), {
    controller,
    registered: null,
    async register(url, options) {
      this.registered = { url, options };
      return registration;
    },
  });
  const storage = new Map();
  const intervals = [];
  const win = {
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    matchMedia: (query) => ({ matches: standalone && query === "(display-mode: standalone)" }),
    navigator: { userAgent, platform, maxTouchPoints: touch, serviceWorker: container },
    document,
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    location: {
      reloads: 0,
      reload() {
        this.reloads++;
      },
    },
    setInterval: (fn) => intervals.push(fn),
  };
  return { win, document, container, registration, storage, intervals };
}

// The registration resolves after a microtask or two.
const settle = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/** Swaps the controller, as a newer worker's clients.claim() does. */
function takeOver(container, worker) {
  container.controller = worker;
  container.dispatchEvent(new Event("controllerchange"));
}

test.beforeEach(() => resetWebAppForTests());

test("an installed app is told from a tab by its display mode, or iOS's navigator.standalone", () => {
  assert.equal(isStandalone(fakeWindow().win), false);
  assert.equal(isStandalone(fakeWindow({ standalone: true }).win), true);
  assert.equal(
    isStandalone({ navigator: { standalone: true }, matchMedia: () => ({ matches: false }) }),
    true,
  );
});

test("iOS and iPadOS (a Mac with a touch screen) install from Share; Android from its menu", () => {
  assert.equal(installPlatform({ userAgent: IPHONE }), "ios");
  assert.equal(installPlatform({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 }), "ios");
  assert.equal(installPlatform({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }), null);
  assert.equal(installPlatform({ userAgent: ANDROID }), "android");
  assert.equal(installPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), null);
});

test("the install offer: the platform's steps, the browser's prompt once it comes, nothing once installed", async () => {
  const { win } = fakeWindow({ userAgent: ANDROID });
  startWebApp({ win, buildId: "a" });
  assert.equal(getWebAppStatus().install, "android");

  let prompted = 0;
  const offer = Object.assign(new Event("beforeinstallprompt"), {
    prompt: async () => prompted++,
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  win.dispatchEvent(offer);
  assert.equal(getWebAppStatus().install, "prompt");
  // Not prevented: the browser's own offer still shows as well.
  assert.equal(offer.defaultPrevented, false);
  assert.equal(await promptInstall(), true);
  assert.equal(prompted, 1);
  assert.equal(getWebAppStatus().install, null);
  // Used once: a second call has nothing to show.
  assert.equal(await promptInstall(), false);
});

test("a dismissed prompt falls back to the platform's own way", async () => {
  const { win } = fakeWindow({ userAgent: ANDROID });
  startWebApp({ win, buildId: "a" });
  win.dispatchEvent(
    Object.assign(new Event("beforeinstallprompt"), {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    }),
  );
  assert.equal(await promptInstall(), false);
  assert.equal(getWebAppStatus().install, "android");
});

test("opened from the home screen there is nothing to install", () => {
  const { win } = fakeWindow({ userAgent: IPHONE, standalone: true });
  startWebApp({ win, buildId: "a" });
  assert.deepEqual(getWebAppStatus(), {
    standalone: true,
    install: null,
    update: "unavailable",
    justUpdated: false,
  });
  win.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: async () => {} }));
  assert.equal(getWebAppStatus().install, null);
});

test("the worker is registered at the base, bypassing the HTTP cache for sw.js", async () => {
  const { win, container } = fakeWindow();
  startWebApp({ win, buildId: "a", scriptUrl: "/base/sw.js", scope: "/base/" });
  await settle();
  assert.deepEqual(container.registered, {
    url: "/base/sw.js",
    options: { scope: "/base/", updateViaCache: "none" },
  });
  assert.equal(getWebAppStatus().update, "idle");
});

test("without a worker to register (dev server, desktop) there are no updates to speak of", async () => {
  const { win, container } = fakeWindow();
  startWebApp({ win, buildId: "dev" });
  await settle();
  assert.equal(container.registered, null);
  assert.equal(getWebAppStatus().update, "unavailable");
  assert.equal(await checkForWebUpdate(), "unavailable");
});

test("a first visit's worker taking control is not an update", async () => {
  const { win, container } = fakeWindow({ controller: null });
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/" });
  await settle();
  takeOver(container, fakeWorker("a"));
  await settle();
  assert.equal(getWebAppStatus().update, "idle");
});

test("a worker of another build taking over makes the update ready; one of this build does not", async () => {
  const { win, container } = fakeWindow({ controller: fakeWorker("a") });
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/" });
  await settle();
  const notified = [];
  const unsubscribe = subscribeWebAppStatus(() => notified.push(getWebAppStatus().update));

  // The page loaded from the network as build b while a's worker was in
  // control: b's worker taking over is old news to it.
  resetWebAppForTests();
  const b = fakeWindow({ controller: fakeWorker("a") });
  startWebApp({ win: b.win, buildId: "b", scriptUrl: "/sw.js", scope: "/" });
  await settle();
  const sameBuild = fakeWorker("b");
  takeOver(b.container, sameBuild);
  await settle();
  assert.deepEqual(sameBuild.messages, [{ type: "build-id" }]);
  assert.equal(getWebAppStatus().update, "idle");

  // A page of build a, and build c deployed since.
  resetWebAppForTests();
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/" });
  await settle();
  subscribeWebAppStatus(() => notified.push(getWebAppStatus().update));
  takeOver(container, fakeWorker("c"));
  await settle();
  assert.equal(getWebAppStatus().update, "ready");
  assert.ok(notified.includes("ready"));
  unsubscribe();
});

test("a worker that never says its build (one from before it could) counts as another build", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { win, container } = fakeWindow({ controller: fakeWorker("a") });
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/" });
  await settle();
  takeOver(container, fakeWorker(null));
  await settle();
  assert.equal(getWebAppStatus().update, "idle");
  t.mock.timers.tick(BUILD_QUERY_TIMEOUT_MS);
  await settle();
  assert.equal(getWebAppStatus().update, "ready");
});

test("coming back to the foreground checks for a new worker, at most once in a while", async () => {
  let clock = 1_000_000;
  const { win, document, registration, intervals } = fakeWindow({ controller: fakeWorker("a") });
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/", now: () => clock });
  await settle();
  const show = () => document.dispatchEvent(new Event("visibilitychange"));

  // Back from the slicer a minute later: too soon.
  clock += 60_000;
  show();
  assert.equal(registration.updates, 0);
  // Back after the night.
  clock += UPDATE_CHECK_MIN_MS;
  show();
  assert.equal(registration.updates, 1);
  // Hidden: the visibility event of going away asks nothing.
  clock += UPDATE_CHECK_MIN_MS;
  document.visibilityState = "hidden";
  show();
  assert.equal(registration.updates, 1);
  // The hourly check runs only while the app is in front.
  assert.equal(intervals.length, 1);
  intervals[0]();
  assert.equal(registration.updates, 1);
  document.visibilityState = "visible";
  intervals[0]();
  assert.equal(registration.updates, 2);
});

test("a background check that fails offline is not an error", async () => {
  let clock = 0;
  const { win, document, registration } = fakeWindow({ controller: fakeWorker("a") });
  registration.update = () => Promise.reject(new TypeError("Failed to fetch"));
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/", now: () => clock });
  await settle();
  clock += UPDATE_CHECK_MIN_MS;
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(getWebAppStatus().update, "idle");
});

test("Check for updates: up to date, offline, or a new build installed and ready", async () => {
  const { win, registration } = fakeWindow({ controller: fakeWorker("a") });
  startWebApp({ win, buildId: "a", scriptUrl: "/sw.js", scope: "/" });
  await settle();
  assert.equal(await checkForWebUpdate(), "up-to-date");
  assert.equal(getWebAppStatus().update, "up-to-date");

  registration.update = () => Promise.reject(new TypeError("Failed to fetch"));
  assert.equal(await checkForWebUpdate(), "offline");

  // The server has build b: it installs, activates, and says so.
  const b = Object.assign(new EventTarget(), fakeWorker("b"), { state: "installing" });
  registration.update = async () => {
    registration.installing = b;
    setImmediate(() => {
      b.state = "activated";
      registration.active = b;
      b.dispatchEvent(new Event("statechange"));
    });
  };
  assert.equal(await checkForWebUpdate(), "ready");
  assert.equal(getWebAppStatus().update, "ready");
  // Ready stays ready: nothing more to ask the server.
  assert.equal(await checkForWebUpdate(), "ready");
});

test("Reload to update reloads, and the next load says it updated, once", () => {
  const first = fakeWindow();
  startWebApp({ win: first.win, buildId: "a" });
  assert.equal(getWebAppStatus().justUpdated, false);
  reloadToUpdate();
  assert.equal(first.win.location.reloads, 1);

  // The reloaded page: the same tab's session storage.
  resetWebAppForTests();
  const second = fakeWindow();
  for (const [key, value] of first.storage) second.storage.set(key, value);
  startWebApp({ win: second.win, buildId: "b" });
  assert.equal(getWebAppStatus().justUpdated, true);
  assert.equal(second.storage.size, 0);
});

test("storage that throws (private mode) costs only the note", () => {
  const { win } = fakeWindow();
  win.sessionStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {},
  };
  startWebApp({ win, buildId: "a" });
  assert.equal(getWebAppStatus().justUpdated, false);
  assert.doesNotThrow(() => reloadToUpdate());
  assert.equal(win.location.reloads, 1);
});
