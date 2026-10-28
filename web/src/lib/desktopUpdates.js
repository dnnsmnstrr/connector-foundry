import { getBenchSession } from "./benchSession.js";
import { desktopBridge } from "./desktopBridge.js";
import { getHolesSession } from "./holesSession.js";

// The desktop app's updater status (desktop/updates.cjs), as one store for
// the whole page: Settings > Updates, the nav's notice and the palette's
// commands read it. A module rather than each component's own state, so
// that a download's progress, reported a few times a second, re-renders
// the two small components that show it and not App (the same reason as
// hooks/useRenderActivity.js). Subscribes to the main process with the
// first listener; always null in a browser.

/** @typedef {import("./desktopBridge.js").DesktopUpdateStatus} DesktopUpdateStatus */

/** @type {DesktopUpdateStatus | null} */
let status = null;
const listeners = new Set();
/** @type {(() => void) | null} */
let unsubscribe = null;

/** @param {DesktopUpdateStatus | null | undefined} next */
function receive(next) {
  if (!next || typeof next !== "object") return;
  status = next;
  for (const listener of listeners) listener();
}

/** The updater's last reported status, or null (in a browser, or before the first answer). */
export function getUpdateStatus() {
  return status;
}

/**
 * For useSyncExternalStore.
 * @param {() => void} listener
 */
export function subscribeUpdateStatus(listener) {
  listeners.add(listener);
  const updates = desktopBridge()?.updates;
  if (updates && !unsubscribe) {
    unsubscribe = updates.onStatus(receive);
    updates.status().then(receive, () => {});
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/** Checks for an update now; the store hears the outcome. */
export function checkForUpdates() {
  return desktopBridge()
    ?.updates.check()
    .then(receive, () => {});
}

/**
 * What a restart would lose, as a sentence, or null when nothing. The
 * window comes back on the same address (desktop/updates.cjs), which
 * holds the tab and the bench; meshes imported onto the bench and the
 * Holes document live only in this page. An interface update's reload
 * loses the same.
 * @param {{ importedMeshes: number, holes: boolean, reload?: boolean }} work
 */
export function restartWarning({ importedMeshes, holes, reload = false }) {
  const lost = [
    holes && "the model on the Holes tab and its holes",
    importedMeshes > 0 &&
      (importedMeshes === 1 ? "the mesh imported onto the Bench" : "the meshes imported onto the Bench"),
  ].filter(Boolean);
  return lost.length
    ? `The bench comes back after the ${reload ? "reload" : "restart"}, but ${lost.join(" and ")} won't.`
    : null;
}

/**
 * Restarts the app to install the downloaded update, or reloads the window
 * for an interface update, after asking if that would lose work.
 */
export function restartToUpdate() {
  const reload = Boolean(status?.reload);
  const warning = restartWarning({
    importedMeshes: getBenchSession().importedParts.size,
    holes: getHolesSession().doc !== null,
    reload,
  });
  const question = reload
    ? `Reload to load version ${status?.latest}?`
    : `Restart to install version ${status?.latest}?`;
  if (warning && !window.confirm(`${question} ${warning}`)) return;
  return desktopBridge()?.updates.install();
}

/**
 * Tells the updater the page started. An interface update that never says
 * so in time is dropped for the app's own interface (desktop/updates.cjs);
 * the nav's notice calls it once it mounts.
 */
export function reportStarted() {
  desktopBridge()?.updates.loaded();
}

/** @param {boolean} on */
export function setAutoCheck(on) {
  // The switch moves at once; the main process's answer follows.
  if (status) receive({ ...status, autoCheck: on });
  return desktopBridge()
    ?.updates.setAutoCheck(on)
    .then(receive, () => {});
}

/** @param {boolean} on */
export function setKeepUpdated(on) {
  if (status) receive({ ...status, keepUpdated: on });
  return desktopBridge()
    ?.updates.setKeepUpdated(on)
    .then(receive, () => {});
}

// The version whose "Update the app" notice the user has acted on; one
// notice per version, so a later release asks again.
const SHELL_NOTICE_KEY = "connector-foundry.shellNoticeSeen";

/**
 * Whether the nav asks for the app to be updated by hand: the newest
 * version's interface needs a newer app, which this copy can't install
 * itself, and the user hasn't opened that version's release page from it.
 * @param {DesktopUpdateStatus | null} s
 * @param {Storage | null} [storage]
 */
export function needsShellNotice(s, storage = safeStorage()) {
  if (!s || s.state !== "available" || !s.shellNeeded || !s.latest) return false;
  try {
    return storage?.getItem(SHELL_NOTICE_KEY) !== s.latest;
  } catch {
    return true;
  }
}

/**
 * Remembers that the notice for `version` was acted on.
 * @param {string} version
 * @param {Storage | null} [storage]
 */
export function dismissShellNotice(version, storage = safeStorage()) {
  try {
    storage?.setItem(SHELL_NOTICE_KEY, version);
  } catch {
    // It asks again next launch.
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * One line on where the updater stands, for Settings and the palette.
 * @param {DesktopUpdateStatus} s
 */
export function updateSummary(s) {
  switch (s.state) {
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "Up to date";
    case "available":
      return s.shellNeeded
        ? `Version ${s.latest} needs a new download of the app`
        : `Version ${s.latest} is available`;
    case "downloading":
      return s.progress === null
        ? `Downloading version ${s.latest}…`
        : `Downloading version ${s.latest}… ${Math.floor(s.progress * 100)}%`;
    case "ready":
      return s.reload ? `Version ${s.latest} is ready to load` : `Version ${s.latest} is ready to install`;
    case "installing":
      return `Installing version ${s.latest}…`;
    case "error":
      return s.error ?? "The update failed";
    default:
      return "Not checked yet";
  }
}
