import { useEffect, useLayoutEffect, useRef } from "react";
import { useDrawerLayout } from "../hooks/useDrawerLayout.js";
import { DRAWER_DRAG_SLOP_PX, drawerInset, drawerRests, drawerSnap, isDrawerLayout } from "../lib/drawer.js";

// Collapse/expand control shared by the Library's, the Bench's and Holes'
// sidebar — same `[` shortcut either way (see App.jsx's keydown handler),
// so the button's tooltip stays truthful whichever screen it is in.
//
// Two faces. On a wide screen the sidebar is a column and this is the
// chevron at its top. In the narrow layout (under 900 px, browsers only:
// lib/drawer.js) the sidebar is a sheet over the foot of the 3D view and
// this is its grab handle, the first thing in it: a tap opens or closes
// it, and a drag pulls it up or pushes it down to one of its rests
// (closed, half, nearly full). The handle is still the one button, with
// aria-expanded, so a keyboard or a screen reader opens and closes the
// sheet as it does the column. A tap, `[` and the palette open it to its
// half rest, which leaves the view's top half and toolbar in sight; only
// a drag takes it further.
//
// The sheet's height is not React state: a drag sets it on every pointer
// move, as --drawer-height on the <aside> (this button's parent), and how
// much of the view's foot it covers as --drawer-inset on .shell-body,
// which the foot of the Bench's view (its error, its docked selection
// pill) and the viewer's pinned selection pill keep clear of (styles.css,
// StlViewer's overlay). The inset stops at the half
// rest, so .shell-body also gets drawer-past-half while the sheet is
// higher: the Holes snapping bar, a tab on the sheet's top edge drawn over
// it, goes under the sheet then rather than over its content.
//
// Closed, the sidebar renders nothing past this button, as the column
// does (each tab's `{!sidebarCollapsed && ...}`): a drag from closed
// expands it on its first move, so the part list rides up with the
// sheet, and a release at the closed rest collapses it once the sheet is
// down, so the list doesn't vanish from under the finger.

// The sheet's height transition in styles.css (0.25s), and a little more:
// when a sheet sent to its closed rest may collapse.
const SETTLE_MS = 280;

/** @param {HTMLElement} aside @param {HTMLElement} button */
function measureRests(aside, button) {
  const shell = aside.closest(".shell-body");
  const top = shell ? shell.getBoundingClientRect().top : 0;
  // The sheet fills the bottom safe area so its contents can scroll behind
  // the home indicator; the padding keeps the last control reachable above it.
  const safeArea = parseFloat(getComputedStyle(aside).paddingBottom) || 0;
  const closed = button.offsetHeight + safeArea;
  return drawerRests(window.innerHeight - top, closed);
}

/**
 * Sets the sheet's height (and the view's cleared foot). `animate`
 * false: at once, as during a drag or when a tab's sheet first appears
 * (a switch of tabs would otherwise slide each new sheet up from closed).
 * @param {HTMLElement} aside
 * @param {number} height px
 * @param {ReturnType<typeof drawerRests>} rests
 * @param {boolean} animate
 */
function placeSheet(aside, height, rests, animate) {
  const root = document.documentElement;
  if (!animate) root.classList.add("drawer-still");
  // The CSS safe-area padding is inside the sheet and the measured height.
  aside.style.setProperty("--drawer-height", `${Math.round(height)}px`);
  const shell = /** @type {HTMLElement | null} */ (aside.closest(".shell-body"));
  shell?.style.setProperty("--drawer-inset", `${drawerInset(height, rests)}px`);
  shell?.classList.toggle("drawer-past-half", height > rests.half + 0.5);
  if (!animate) {
    // The browser has to work out the new height while the class is on,
    // or the transition runs anyway: this layout read makes it.
    void aside.offsetHeight;
    root.classList.remove("drawer-still");
  }
  // The viewer's selection pill keeps clear of the sheet; it is placed
  // when the scene draws, which a sheet moving over it doesn't cause.
  window.dispatchEvent(new Event("sidebar-drawer"));
}

/**
 * @param {{
 *   collapsed: boolean,
 *   onToggle: () => void,
 *   title: string,
 * }} props
 */
export default function SidebarToggle({ collapsed, onToggle, title }) {
  // `title`: what the sheet holds ("Part list"), shown on the handle in
  // the narrow layout and read in its label there.
  const drawer = useDrawerLayout();
  const buttonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  // The drag in progress, if any (see onPointerDown).
  const drag = useRef(null);
  // A click that ends a drag is not a tap.
  const dragged = useRef(false);
  // The timer that collapses a sheet once it is down (see settleClosed).
  const settling = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  // Whether this handle has placed its sheet yet: the first placement is
  // instant, every later one slides.
  const placed = useRef(false);
  // The rest the sheet is at while open: a drag sets it, a resize keeps
  // it, and closing puts it back to half for the next opening.
  const openRest = useRef(/** @type {"half" | "full"} */ ("half"));

  // The sheet to its rest whenever `collapsed` changes (a tap, `[`, the
  // palette, the Library's "Find a part"), and again on a resize — a
  // phone's address bar hiding, or turning it — which moves the rests. Out
  // of the narrow layout the properties go, and the column is as it was.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const aside = button?.parentElement;
    if (!button || !aside) return undefined;
    const shell = /** @type {HTMLElement | null} */ (aside.closest(".shell-body"));
    function layout(animate) {
      if (!isDrawerLayout()) {
        aside.style.removeProperty("--drawer-height");
        shell?.style.removeProperty("--drawer-inset");
        shell?.classList.remove("drawer-past-half");
        return;
      }
      if (drag.current) return;
      if (collapsed) openRest.current = "half";
      const rests = measureRests(aside, button);
      placeSheet(aside, collapsed ? rests.closed : rests[openRest.current], rests, animate);
    }
    const openFully = () => {
      if (!isDrawerLayout()) return;
      openRest.current = "full";
      if (!collapsed) layout(true);
    };
    layout(placed.current);
    placed.current = true;
    const relayout = () => layout(false);
    window.addEventListener("resize", relayout);
    window.addEventListener("sidebar-drawer-full", openFully);
    return () => {
      window.removeEventListener("resize", relayout);
      window.removeEventListener("sidebar-drawer-full", openFully);
      // Gone with its tab (the Bench's start screen has no sidebar): the
      // next tab's handle sets its own.
      shell?.style.removeProperty("--drawer-inset");
      shell?.classList.remove("drawer-past-half");
    };
  }, [collapsed, drawer]);

  // Unmounted mid-drag or mid-settle: nothing will clear the class that
  // holds transitions off, or collapse the sheet.
  useEffect(
    () => () => {
      if (drag.current) document.documentElement.classList.remove("drawer-dragging");
      if (settling.current) clearTimeout(settling.current);
    },
    [],
  );

  // Down to the closed rest, then collapsed: the content goes once it is
  // out of sight. Nothing else starts while it settles.
  function settleClosed(aside, rests) {
    placeSheet(aside, rests.closed, rests, true);
    settling.current = setTimeout(() => {
      settling.current = null;
      onToggle();
    }, SETTLE_MS);
  }

  function onPointerDown(e) {
    if (e.button !== 0 || settling.current || !isDrawerLayout()) return;
    const button = e.currentTarget;
    const aside = button.parentElement;
    const rests = measureRests(aside, button);
    const height = aside.getBoundingClientRect().height;
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      startHeight: height,
      height,
      rests,
      moving: false,
      // Recent positions, for the speed a release flings with.
      samples: [{ y: e.clientY, t: e.timeStamp }],
    };
    dragged.current = false;
    button.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const up = d.startY - e.clientY;
    if (!d.moving) {
      if (Math.abs(up) < DRAWER_DRAG_SLOP_PX) return;
      d.moving = true;
      dragged.current = true;
      // No easing while it follows the finger, for the sheet and for what
      // keeps clear of it.
      document.documentElement.classList.add("drawer-dragging");
      if (collapsed) onToggle();
    }
    d.height = Math.min(d.rests.full, Math.max(d.rests.closed, d.startHeight + up));
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
    placeSheet(e.currentTarget.parentElement, d.height, d.rests, false);
  }

  function endDrag(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!d.moving) return;
    document.documentElement.classList.remove("drawer-dragging");
    // The speed over the last moves (px per ms, upward positive); a
    // finger held still before letting go has none.
    const last = d.samples[d.samples.length - 1];
    const first = d.samples.find((s) => last.t - s.t <= 100) ?? last;
    const still = e.timeStamp - last.t > 80;
    const velocity = !still && last.t > first.t ? (first.y - last.y) / (last.t - first.t) : 0;
    const rest = drawerSnap(d.height, velocity, d.rests);
    const aside = e.currentTarget.parentElement;
    if (rest === "closed") {
      settleClosed(aside, d.rests);
      return;
    }
    openRest.current = rest;
    placeSheet(aside, d.rests[rest], d.rests, true);
  }

  function onClick(e) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (settling.current) return;
    // Closing the sheet slides it down with its content still in it.
    if (!collapsed && isDrawerLayout()) {
      const button = e.currentTarget;
      settleClosed(button.parentElement, measureRests(button.parentElement, button));
      return;
    }
    onToggle();
  }

  const label = drawer
    ? `${collapsed ? "Show" : "Hide"} the ${title.toLowerCase()}`
    : collapsed
      ? "Show sidebar"
      : "Hide sidebar";
  return (
    <button
      ref={buttonRef}
      type="button"
      className="sidebar-toggle"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      aria-expanded={!collapsed}
      aria-label={label}
      title={drawer ? `${label} · drag to pull it up or down` : `${label} ([)`}
    >
      <span className="sidebar-toggle-grip" aria-hidden="true" />
      <span className="sidebar-toggle-chevron" aria-hidden="true">
        {collapsed ? "»" : "«"}
      </span>
      <span className="sidebar-toggle-text">{title}</span>
    </button>
  );
}
