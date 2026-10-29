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

// `fallback` when it was never set (or storage can't be read): App passes
// whether the sidebar is a phone's bottom drawer, which starts closed.
export function getSidebarCollapsed(fallback = false) {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
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

// Which Holes preset groups are open (components/holes/PresetPicker.jsx):
// a JSON object of group name -> true/false, only for groups the user has
// opened or closed. A group with no entry follows the picker's default.
const PRESET_GROUPS_OPEN_KEY = "connector-foundry.holesPresetGroupsOpen";

export function getPresetGroupsOpen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_GROUPS_OPEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function setPresetGroupOpen(group, open) {
  const next = { ...getPresetGroupsOpen(), [group]: Boolean(open) };
  try {
    localStorage.setItem(PRESET_GROUPS_OPEN_KEY, JSON.stringify(next));
  } catch {
    // best-effort — see header comment
  }
  return next;
}

// --- Grid ---------------------------------------------------------------
// The grid that handle drags, arrow-key handle steps and Holes
// placements snap to, in mm (TinkerCAD's "Snap Grid", same values); 0 is
// Off. One value for every tab: it is how coarsely the user wants to
// work, not a property of a part. The default is 0.5 mm, the Holes tab's
// free-placement grid before this setting existed (snapCandidates.js's
// FREE_GRID_MM); TinkerCAD's is 1 mm, but that would change where every
// existing user's next hole lands. Stored only when not the default; a
// stored value that is not one of the options reads as the default.
const GRID_SNAP_KEY = "connector-foundry.gridSnap";
export const GRID_SNAP_OPTIONS = Object.freeze([0, 0.1, 0.25, 0.5, 1, 2, 5]);
export const GRID_SNAP_DEFAULT = 0.5;

let gridSnap = null;
const gridSnapListeners = new Set();

function readGridSnap() {
  let stored = null;
  try {
    stored = localStorage.getItem(GRID_SNAP_KEY);
  } catch {
    // best-effort — see header comment
  }
  if (stored === null) return GRID_SNAP_DEFAULT;
  const n = Number(stored);
  return stored.trim() !== "" && GRID_SNAP_OPTIONS.includes(n) ? n : GRID_SNAP_DEFAULT;
}

/** @returns {number} mm, 0 for Off */
export function getGridSnap() {
  if (gridSnap === null) gridSnap = readGridSnap();
  return gridSnap;
}

/** @param {number} mm one of GRID_SNAP_OPTIONS; anything else is ignored */
export function setGridSnap(mm) {
  const next = Number(mm);
  if (!GRID_SNAP_OPTIONS.includes(next)) return;
  // Read (and cache) the current value before writing: a first read after
  // the write would find the new value already there and never notify.
  const previous = getGridSnap();
  try {
    if (next === GRID_SNAP_DEFAULT) localStorage.removeItem(GRID_SNAP_KEY);
    else localStorage.setItem(GRID_SNAP_KEY, String(next));
  } catch {
    // best-effort — see header comment; the in-memory value still updates
  }
  if (next === previous) return;
  gridSnap = next;
  for (const listener of gridSnapListeners) listener();
}

// For useSyncExternalStore (hooks/useGridSnap.js): the viewer's Grid
// select and the Settings row stay in step. Returns the unsubscribe.
export function subscribeGridSnap(listener) {
  gridSnapListeners.add(listener);
  return () => gridSnapListeners.delete(listener);
}

// --- Command palette recents ----------------------------------------------
// The commands run from the palette (components/CommandPalette.jsx), newest
// first: they head its list on an empty query and win near-ties when
// something is typed (commands.js's rankCommands()). Only ids are kept —
// compared, never interpreted — so the check on the way in is that each is
// a short string without control characters; an id that names no command
// any more is simply never matched. Capped, so a long session can't grow
// the stored list without bound.
const COMMAND_RECENTS_KEY = "connector-foundry.commandRecents";
export const COMMAND_RECENTS_MAX = 30;
const COMMAND_ID_MAX = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** @type {readonly string[] | null} */
let commandRecents = null;

/** @param {unknown} id */
function isCommandId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= COMMAND_ID_MAX && !CONTROL_CHARS.test(id);
}

function readCommandRecents() {
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(COMMAND_RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return Object.freeze([...new Set(parsed.filter(isCommandId))].slice(0, COMMAND_RECENTS_MAX));
}

/** @returns {readonly string[]} command ids, newest first */
export function getCommandRecents() {
  if (commandRecents === null) commandRecents = readCommandRecents();
  return commandRecents;
}

/** @param {string} id moved (or added) to the front */
export function recordCommandRecent(id) {
  if (!isCommandId(id)) return;
  commandRecents = Object.freeze(
    [id, ...getCommandRecents().filter((r) => r !== id)].slice(0, COMMAND_RECENTS_MAX),
  );
  try {
    localStorage.setItem(COMMAND_RECENTS_KEY, JSON.stringify(commandRecents));
  } catch {
    // best-effort — see header comment; this session still remembers
  }
}
