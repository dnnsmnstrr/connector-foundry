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

// The sidebar's width in px, set by dragging its edge (components/
// SidebarResizer.jsx). One width for all three modes — it is the same
// column. Clamped on the way in and out, so a stored value from a
// wider screen, or a hand-edited one, can't push the workspace off
// screen; styles.css clamps it again against the window (a stored
// 600 px on a 900 px window still leaves the viewer room).
const SIDEBAR_WIDTH_KEY = "connector-foundry.sidebarWidth";
export const SIDEBAR_WIDTH_DEFAULT = 280;
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 640;

export function clampSidebarWidth(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n)));
}

let sidebarWidth = null;
const sidebarWidthListeners = new Set();

export function getSidebarWidth() {
  if (sidebarWidth === null) {
    let stored = null;
    try {
      stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    } catch {
      // best-effort — see header comment
    }
    sidebarWidth = stored === null ? SIDEBAR_WIDTH_DEFAULT : clampSidebarWidth(stored);
  }
  return sidebarWidth;
}

// `persist` false updates the live width only — a drag in progress
// moves the column on every pointer move but writes storage once, on
// release.
export function setSidebarWidth(px, { persist = true } = {}) {
  const next = clampSidebarWidth(px);
  if (persist) {
    try {
      if (next === SIDEBAR_WIDTH_DEFAULT) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      else localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      // best-effort — see header comment
    }
  }
  if (next === sidebarWidth) return;
  sidebarWidth = next;
  for (const listener of sidebarWidthListeners) listener();
}

export function subscribeSidebarWidth(listener) {
  sidebarWidthListeners.add(listener);
  return () => sidebarWidthListeners.delete(listener);
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

// --- Library curation ---------------------------------------------------
// Which catalogue parts and whole systems the user has hidden from every
// part list (Settings → "Part list"): `{ systems: string[], parts: string[] }`,
// system names and part ids. A hidden part is only out of the pickers —
// it stays in the parts map, so a bench that already uses it (or a link
// or config that names it) keeps working. A hidden system hides the parts
// it has now and any added to it later; unchecking a part inside a hidden
// system has no effect until the system is shown again. Same cached-
// snapshot + listener shape as the system order above.
const HIDDEN_LIBRARY_KEY = "connector-foundry.hiddenLibrary";
const NOTHING_HIDDEN = Object.freeze({ systems: Object.freeze([]), parts: Object.freeze([]) });

let hiddenLibraryCache;
const hiddenLibraryListeners = new Set();

function readHiddenLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_LIBRARY_KEY));
    const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);
    if (!parsed || typeof parsed !== "object") return NOTHING_HIDDEN;
    const systems = strings(parsed.systems);
    const parts = strings(parsed.parts);
    return systems.length || parts.length ? { systems, parts } : NOTHING_HIDDEN;
  } catch {
    return NOTHING_HIDDEN;
  }
}

// { systems, parts } — a shared empty record when nothing is hidden.
export function getHiddenLibrary() {
  if (hiddenLibraryCache === undefined) hiddenLibraryCache = readHiddenLibrary();
  return hiddenLibraryCache;
}

export function setHiddenLibrary({ systems = [], parts = [] }) {
  const next = systems.length || parts.length ? { systems: [...systems], parts: [...parts] } : NOTHING_HIDDEN;
  try {
    if (next === NOTHING_HIDDEN) localStorage.removeItem(HIDDEN_LIBRARY_KEY);
    else localStorage.setItem(HIDDEN_LIBRARY_KEY, JSON.stringify(next));
  } catch {
    // best-effort — see header comment; the in-memory value still updates
  }
  hiddenLibraryCache = next;
  for (const listener of hiddenLibraryListeners) listener();
}

// Toggle one system or one part; `hidden` true hides it.
export function setSystemHidden(system, hidden) {
  const { systems, parts } = getHiddenLibrary();
  const without = systems.filter((s) => s !== system);
  setHiddenLibrary({ systems: hidden ? [...without, system] : without, parts });
}

export function setPartHidden(partId, hidden) {
  const { systems, parts } = getHiddenLibrary();
  const without = parts.filter((p) => p !== partId);
  setHiddenLibrary({ systems, parts: hidden ? [...without, partId] : without });
}

export function subscribeHiddenLibrary(listener) {
  hiddenLibraryListeners.add(listener);
  return () => hiddenLibraryListeners.delete(listener);
}
