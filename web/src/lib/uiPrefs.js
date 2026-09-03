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
