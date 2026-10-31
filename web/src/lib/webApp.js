// The app as an installed web app (a PWA): the service worker's
// registration, word that a newer build has been deployed, and the
// browser's offer to install. One store for the page, as
// lib/desktopUpdates.js is for the desktop app's updater: the nav's
// notice, Settings and the palette's commands read it.
//
// Updates. The app's page is network-first in the service worker
// (src/sw.js), so every cold start loads the newest deploy. But an app
// opened from the home screen is rarely started cold: iOS and Android
// keep it suspended in the background for days, and a page that never
// navigates never asks for a new worker either (the browser checks on
// navigation, and at most once a day otherwise). So the page asks
// itself — when it comes back to the foreground, once a while has
// passed, and every hour it stays in front. A newer sw.js installs and
// takes over at once (skipWaiting and clients.claim), which the page
// hears as `controllerchange`; it then asks the new worker which build
// it is, since a page loaded from the network may already be that build
// (its old worker was still in control when it loaded), and only a
// different build is news. The page is not reloaded for the user: an app
// left open keeps what it was doing, so the nav offers "Reload to update",
// and the next cold start takes the new build anyway. The workspace
// (lib/workspace.js) is kept in localStorage, so a reload comes back to
// the same tab, bench and Holes document.
//
// Install. Chromium fires `beforeinstallprompt` when the app can be
// installed, and the event's prompt() shows the browser's own dialog: it
// is kept for the "Install the app" command, without preventDefault(), so
// the browser's own install offer still shows as well. iOS and iPadOS
// have no such event — every browser there installs through the Share
// menu's "Add to Home Screen" — and Android browsers without it
// (Firefox, Samsung Internet before the event) through their own menu;
// for those the command shows how (components/InstallSheet.jsx). Opened
// as an installed app, there is nothing to offer.

/**
 * @typedef {"prompt" | "ios" | "android"} InstallMethod
 *   the browser's own install dialog (Chromium's beforeinstallprompt),
 *   Safari's Share menu (every browser on iOS and iPadOS), or the browser's
 *   menu (an Android browser that offers no prompt)
 */

/**
 * @typedef {"unavailable" | "idle" | "checking" | "ready" | "up-to-date" | "offline"} WebUpdateState
 *   unavailable: no service worker (the dev server, the desktop app, a
 *   browser without one); ready: a newer build has taken over and a reload
 *   shows it; up-to-date / offline: what the last check asked for by hand
 *   found
 */

/**
 * @typedef {object} WebAppStatus
 * @property {boolean} standalone opened from the home screen or as an installed app
 * @property {InstallMethod | null} install how it can be installed from here; null when it can't (or is already)
 * @property {WebUpdateState} update
 * @property {boolean} justUpdated this page load is the reload "Reload to update" asked for
 */

// How long the app must have been in the background before coming back
// checks for an update. Each check is one conditional request for sw.js
// (a few KB); switching to the slicer and back every minute should not
// make one each time.
export const UPDATE_CHECK_MIN_MS = 10 * 60 * 1000;
// And while it stays in front.
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
// How long a worker gets to say which build it is before the page stops
// waiting. A worker from before it could answer never does.
export const BUILD_QUERY_TIMEOUT_MS = 3000;
const INSTALL_TIMEOUT_MS = 30_000;

// Set just before "Reload to update" reloads, read once by the next load.
const JUST_UPDATED_KEY = "foundry.webApp.justUpdated";

// The display modes an installed app opens in; a browser tab is "browser".
const INSTALLED_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

/** @type {WebAppStatus} */
let status = { standalone: false, install: null, update: "unavailable", justUpdated: false };
const listeners = new Set();
/** @type {any} the kept beforeinstallprompt event */
let installEvent = null;
/** @type {ServiceWorkerRegistration | null} */
let registration = null;
let lastCheck = 0;
/** @type {Partial<Env> | null} */
let started = null;

/** @param {Partial<WebAppStatus>} next */
function update(next) {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

/** The current status (a new object on every change, for useSyncExternalStore). */
export function getWebAppStatus() {
  return status;
}

/**
 * For useSyncExternalStore.
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeWebAppStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether the page was opened as an installed app rather than in a tab.
 * @param {{ matchMedia?: (query: string) => { matches: boolean }, navigator?: any }} win
 */
export function isStandalone(win) {
  if (win.navigator?.standalone === true) return true;
  return INSTALLED_DISPLAY_MODES.some((mode) => win.matchMedia?.(`(display-mode: ${mode})`).matches === true);
}

/**
 * Which platform's way to install applies, before any prompt arrives: iOS
 * and iPadOS (whose Safari reports itself as a Mac with a touch screen),
 * Android, or neither (a desktop browser, where the desktop app is the
 * better offer and Chromium's prompt, when it comes, is still used).
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} nav
 * @returns {"ios" | "android" | null}
 */
export function installPlatform(nav) {
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

/**
 * @typedef {object} Env
 * @property {any} win the window: matchMedia, navigator, document, location, sessionStorage, timers
 * @property {string} buildId this page's build (vite-plugin-sw.mjs's __BUILD_ID__)
 * @property {string} [scriptUrl] the worker to register; none, and nothing is registered
 * @property {string} [scope]
 * @property {() => number} [now]
 */

/**
 * Starts it all, once per page, before the first render: the install
 * event can fire before React has mounted anything. The worker is
 * registered after the page's load event, as before, so it never competes
 * with the app's own first requests.
 * @param {Env} env
 */
export function startWebApp(env) {
  if (started) return;
  started = env;
  const { win } = env;
  const standalone = isStandalone(win);
  let justUpdated = false;
  try {
    justUpdated = win.sessionStorage?.getItem(JUST_UPDATED_KEY) === "1";
    win.sessionStorage?.removeItem(JUST_UPDATED_KEY);
  } catch {
    // Storage refused (private mode, a sandboxed frame): no news, no harm.
  }
  const platform = installPlatform(win.navigator ?? {});
  update({ standalone, install: standalone ? null : platform, justUpdated });

  win.addEventListener?.("beforeinstallprompt", (event) => {
    installEvent = event;
    if (!status.standalone) update({ install: "prompt" });
  });
  win.addEventListener?.("appinstalled", () => {
    installEvent = null;
    update({ install: null });
  });

  const container = win.navigator?.serviceWorker;
  if (!env.scriptUrl || !container) return;
  const register = () => {
    container
      .register(env.scriptUrl, { scope: env.scope, updateViaCache: "none" })
      .then((/** @type {ServiceWorkerRegistration} */ reg) => {
        registration = reg;
        lastCheck = now();
        update({ update: status.update === "ready" ? "ready" : "idle" });
      })
      .catch(() => {
        // Offline on the first visit, a blocked scheme: the app runs as it
        // did without one.
      });
  };
  if (win.document?.readyState === "complete") register();
  else win.addEventListener?.("load", register, { once: true });

  // A first visit's worker claiming the page is not an update; only a
  // change from one controller to another is.
  let controlled = Boolean(container.controller);
  container.addEventListener?.("controllerchange", () => {
    const worker = container.controller;
    if (!controlled) {
      controlled = true;
      return;
    }
    if (!worker) return;
    askBuild(worker).then((build) => {
      if (build !== env.buildId) update({ update: "ready" });
    });
  });

  win.document?.addEventListener?.("visibilitychange", () => {
    if (win.document.visibilityState === "visible" && now() - lastCheck >= UPDATE_CHECK_MIN_MS) {
      checkQuietly();
    }
  });
  win.addEventListener?.("online", () => {
    if (now() - lastCheck >= UPDATE_CHECK_MIN_MS) checkQuietly();
  });
  win.setInterval?.(() => {
    if (win.document?.visibilityState !== "hidden") checkQuietly();
  }, UPDATE_CHECK_INTERVAL_MS);
}

function now() {
  return started?.now ? started.now() : Date.now();
}

/**
 * The build a worker says it is (src/sw.js's "build-id" message), or null
 * when it does not answer in time — a worker from before it could, which
 * is then taken for a different build.
 * @param {ServiceWorker} worker
 * @returns {Promise<string | null>}
 */
function askBuild(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, BUILD_QUERY_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(typeof event.data === "string" ? event.data : null);
    };
    try {
      worker.postMessage({ type: "build-id" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// A background check: its result is news only if it finds a new build,
// which `controllerchange` reports.
function checkQuietly() {
  if (!registration) return;
  lastCheck = now();
  registration.update().catch(() => {
    // Offline, or the server said no: the next check tries again.
  });
}

/**
 * Asks the server for a newer build now (the palette's "Check for
 * updates"): "ready" when one has taken over (now or before), "up-to-date",
 * "offline" when the server could not be reached, or "unavailable" with no
 * service worker to ask.
 * @returns {Promise<WebUpdateState>}
 */
export async function checkForWebUpdate() {
  if (!registration) return "unavailable";
  if (status.update === "ready") return "ready";
  lastCheck = now();
  update({ update: "checking" });
  try {
    await registration.update();
  } catch {
    update({ update: "offline" });
    return "offline";
  }
  const installing = registration.installing;
  if (installing) {
    // Nothing to precache, so it activates in moments; the timeout only
    // stops a stalled install from leaving the command waiting forever.
    await new Promise((resolve) => {
      const settled = () => installing.state === "activated" || installing.state === "redundant";
      if (settled()) {
        resolve(undefined);
        return;
      }
      const timer = setTimeout(resolve, INSTALL_TIMEOUT_MS);
      installing.addEventListener("statechange", () => {
        if (!settled()) return;
        clearTimeout(timer);
        resolve(undefined);
      });
    });
    const active = registration.active;
    const build = active ? await askBuild(active) : started?.buildId;
    if (build !== started?.buildId) {
      update({ update: "ready" });
      return "ready";
    }
  }
  // controllerchange may have said so while this waited (read through the
  // getter: the check above narrowed `status.update` for the type checker,
  // which cannot know the awaits let it change).
  const result = getWebAppStatus().update === "ready" ? "ready" : "up-to-date";
  update({ update: result });
  return result;
}

/**
 * Reloads into the new build. The workspace is already kept in
 * localStorage, so the reload comes back to the same tab, bench and Holes
 * document; the caller flushes any write still on the debounce first.
 */
export function reloadToUpdate() {
  const win = started?.win;
  if (!win) return;
  try {
    win.sessionStorage?.setItem(JUST_UPDATED_KEY, "1");
  } catch {
    // Only the "Updated" note after the reload is lost.
  }
  win.location.reload();
}

/**
 * Shows the browser's own install dialog, when it offered one. Resolves
 * to whether the app was installed; the event can be used once, so a
 * dismissed dialog leaves the platform's own way (or nothing) to offer.
 * @returns {Promise<boolean>}
 */
export async function promptInstall() {
  const event = installEvent;
  if (!event) return false;
  installEvent = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    const accepted = choice?.outcome === "accepted";
    const platform = started ? installPlatform(started.win.navigator ?? {}) : null;
    update({ install: accepted ? null : platform });
    return accepted;
  } catch {
    update({ install: started ? installPlatform(started.win.navigator ?? {}) : null });
    return false;
  }
}

/** Forgets everything, for the unit tests. */
export function resetWebAppForTests() {
  status = { standalone: false, install: null, update: "unavailable", justUpdated: false };
  installEvent = null;
  registration = null;
  lastCheck = 0;
  started = null;
  listeners.clear();
}
