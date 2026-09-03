// Lightweight, session-crossing UI preferences — not part of the
// catalogue/override system (userOverrides.js), just small display
// state a user would expect to stick around, like whether the sidebar
// is collapsed. Backed by localStorage, best-effort like every other
// browser-storage read/write in this app (see userOverrides.js's
// header) — wrapped in try/catch so a private window or blocked
// storage degrades to "not collapsed" rather than breaking the app.
const SIDEBAR_COLLAPSED_KEY = "connector-foundry.sidebarCollapsed";
// Off by default: switching to the Bench shows its own part picker. On:
// the switch behaves like Library's "Open in Bench" button — the part
// selected there (with its current parameters) becomes the root.
const BENCH_FOLLOWS_LIBRARY_KEY = "connector-foundry.benchFollowsLibrary";
// The order of the system headings in every part list (Library sidebar,
// both Bench pickers) — a JSON array of `system` strings. Absent means
// catalogue order. Systems missing from a saved array (renamed, or added
// after it was saved) are appended in catalogue order by
// catalogueUtils.js's resolveSystemOrder(), so nothing ever disappears.
const SYSTEM_ORDER_KEY = "connector-foundry.systemOrder";

function getFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setFlag(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // best-effort — see header comment
  }
}

export function getSidebarCollapsed() {
  return getFlag(SIDEBAR_COLLAPSED_KEY);
}

export function setSidebarCollapsed(collapsed) {
  setFlag(SIDEBAR_COLLAPSED_KEY, collapsed);
}

export function getBenchFollowsLibrary() {
  return getFlag(BENCH_FOLLOWS_LIBRARY_KEY);
}

export function setBenchFollowsLibrary(on) {
  setFlag(BENCH_FOLLOWS_LIBRARY_KEY, on);
}

// The saved order is cached so getSystemOrder() returns the same array
// until the next set — useSyncExternalStore needs a stable snapshot, or
// it would re-render forever on a freshly parsed array each call.
let systemOrderCache;
const systemOrderListeners = new Set();

function readSystemOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYSTEM_ORDER_KEY));
    return Array.isArray(parsed) && parsed.every((s) => typeof s === "string") ? parsed : null;
  } catch {
    return null;
  }
}

// string[] | null — null means "catalogue order".
export function getSystemOrder() {
  if (systemOrderCache === undefined) systemOrderCache = readSystemOrder();
  return systemOrderCache;
}

// Pass null to go back to catalogue order.
export function setSystemOrder(order) {
  try {
    if (order) localStorage.setItem(SYSTEM_ORDER_KEY, JSON.stringify(order));
    else localStorage.removeItem(SYSTEM_ORDER_KEY);
  } catch {
    // best-effort — see header comment; the in-memory value still updates
  }
  systemOrderCache = order ? [...order] : null;
  for (const listener of systemOrderListeners) listener();
}

// For useSyncExternalStore (hooks/useSystemOrder.js): fires after every
// setSystemOrder(), so a part list behind the open Settings dialog
// reorders as the user moves a heading. Returns the unsubscribe.
export function subscribeSystemOrder(listener) {
  systemOrderListeners.add(listener);
  return () => systemOrderListeners.delete(listener);
}
