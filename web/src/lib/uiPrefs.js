// Lightweight, session-crossing UI preferences — not part of the
// catalogue/override system (userOverrides.js), just small display
// state a user would expect to stick around, like whether the sidebar
// is collapsed. Backed by localStorage, best-effort like every other
// browser-storage read/write in this app (see userOverrides.js's
// header) — wrapped in try/catch so a private window or blocked
// storage degrades to "not collapsed" rather than breaking the app.
const SIDEBAR_COLLAPSED_KEY = "connector-foundry.sidebarCollapsed";

export function getSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // best-effort — see header comment
  }
}
