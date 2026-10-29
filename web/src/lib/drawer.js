// The narrow layout's bottom drawer: the sidebar as a sheet over the 3D
// view, pulled up and pushed down by its handle (components/
// SidebarToggle.jsx, which is that handle). This is the arithmetic, kept
// apart from the DOM so a unit test can hold it: where the sheet may rest
// (its detents) and which of them a released drag goes to.
//
// Three rests, as a phone's own sheets have: closed (only the handle shows,
// over the foot of the view), half the workspace (the view's top half and
// its toolbar stay in sight), and nearly all of it (a long part list or
// the Bench's tree, with a strip of the view left to drag it back down).

// The same test as styles.css's narrow layout: under 900 px, browsers
// only. The desktop app never stacks its panes (see :root.desktop there).
export const DRAWER_QUERY = "(max-width: 900px)";

// The share of the workspace's height each open rest takes.
export const DRAWER_HALF_SHARE = 0.5;
export const DRAWER_FULL_SHARE = 0.88;

// How far ahead a release's speed carries the sheet, in ms: a flick goes
// on to the next rest, as a phone's sheets do, rather than back to the
// nearest one. And how far a press may move (px) before it is a drag
// rather than a tap.
export const DRAWER_FLING_MS = 160;
export const DRAWER_DRAG_SLOP_PX = 6;

/** @typedef {"closed" | "half" | "full"} DrawerRest */

/**
 * Whether the page is in the narrow layout, where the sidebar is a drawer.
 * @returns {boolean}
 */
export function isDrawerLayout() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (document.documentElement.classList.contains("desktop")) return false;
  return window.matchMedia?.(DRAWER_QUERY).matches === true;
}

/**
 * Calls `onChange` when the page goes into or out of the narrow layout.
 * @param {() => void} onChange
 * @returns {() => void} unsubscribes
 */
export function subscribeDrawerLayout(onChange) {
  const query = typeof window === "undefined" ? null : window.matchMedia?.(DRAWER_QUERY);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The heights (px) the drawer rests at.
 * @param {number} available the workspace's height under the nav, px
 * @param {number} closed the closed sheet's height (the handle and the
 *   home indicator's inset), px
 * @returns {Record<DrawerRest, number>} every rest at least `closed` and at
 *   most `available`, closed <= half <= full
 */
export function drawerRests(available, closed) {
  const room = Number.isFinite(available) && available > 0 ? available : 0;
  const low = Math.min(Math.max(0, Number.isFinite(closed) ? closed : 0), room);
  const at = (share) => Math.round(Math.min(room, Math.max(low, room * share)));
  return { closed: Math.round(low), half: at(DRAWER_HALF_SHARE), full: at(DRAWER_FULL_SHARE) };
}

/**
 * The rest a drag released at `height` goes to.
 * @param {number} height the sheet's height when released, px
 * @param {number} velocity its speed then, px per ms, positive upward
 *   (growing)
 * @param {Record<DrawerRest, number>} rests from drawerRests()
 * @returns {DrawerRest}
 */
export function drawerSnap(height, velocity, rests) {
  const v = Number.isFinite(velocity) ? velocity : 0;
  const aim = height + v * DRAWER_FLING_MS;
  /** @type {DrawerRest} */
  let best = "closed";
  for (const rest of /** @type {DrawerRest[]} */ (["closed", "half", "full"])) {
    if (Math.abs(rests[rest] - aim) < Math.abs(rests[best] - aim)) best = rest;
  }
  return best;
}

/**
 * How much of the foot of the screen the things over the 3D view keep
 * clear of (the Bench's Print button, the selection pill): the sheet's
 * height, but never more than its half rest. Pulled up all the way, the
 * sheet covers them, as a phone's sheets cover the map under them; they
 * would otherwise be pushed into the toolbar at the top of the view.
 * @param {number} height the sheet's height, px
 * @param {Record<DrawerRest, number>} rests from drawerRests()
 * @returns {number} px
 */
export function drawerInset(height, rests) {
  return Math.round(Math.max(0, Math.min(height, rests.half)));
}
