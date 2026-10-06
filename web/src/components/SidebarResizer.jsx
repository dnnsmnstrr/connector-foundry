import { useRef } from "react";
import { useSidebarWidth } from "../hooks/useSidebarWidth.js";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, getSidebarWidth, setSidebarWidth } from "../lib/uiPrefs.js";

// The drag handle on the sidebar's right edge. A sibling of the
// <aside>, not a child: the sidebar scrolls, and a handle inside it
// would scroll away with the content. styles.css pins it over the
// column boundary using the same clamped width the grid uses, so the
// two can't disagree.
//
// Drag it to resize; with it focused, ←/→ step 16 px (Shift: 64),
// Home/End go to the narrowest and widest; a double-click puts the
// default back. The width is one preference for all three modes (see
// uiPrefs.js). Hidden while the sidebar is collapsed and on narrow
// screens, where the sidebar stacks above the workspace instead.
const STEP_PX = 16;
const BIG_STEP_PX = 64;

export default function SidebarResizer() {
  const width = useSidebarWidth();
  const drag = useRef(null);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const current = Math.min(getSidebarWidth(), maxShownWidth());
    drag.current = { startX: e.clientX, startWidth: current, lastWidth: current };
    // While dragging: no grid transition (the column would lag the
    // pointer) and no text selection across the page.
    document.documentElement.classList.add("sidebar-resizing");
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    // The window caps it too (styles.css), so track what is actually
    // shown, or a drag past the cap would have to come all the way back
    // before the column moves again.
    const shown = Math.min(d.startWidth + e.clientX - d.startX, maxShownWidth());
    d.lastWidth = shown;
    setSidebarWidth(shown, { persist: false });
  }

  function endDrag() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.documentElement.classList.remove("sidebar-resizing");
    setSidebarWidth(d.lastWidth);
  }

  function onKeyDown(e) {
    const step = e.shiftKey ? BIG_STEP_PX : STEP_PX;
    // The store's value, not this render's: held-down arrow keys can
    // repeat faster than React re-renders.
    const shown = Math.min(getSidebarWidth(), maxShownWidth());
    let next = null;
    if (e.key === "ArrowLeft") next = shown - step;
    else if (e.key === "ArrowRight") next = shown + step;
    else if (e.key === "Home") next = SIDEBAR_WIDTH_MIN;
    else if (e.key === "End") next = Math.min(SIDEBAR_WIDTH_MAX, maxShownWidth());
    if (next === null) return;
    e.preventDefault();
    setSidebarWidth(next);
  }

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize the sidebar · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}

// The widest the column is allowed to show in this window: the same
// share of the shell that styles.css caps --sidebar-width at.
export const SIDEBAR_MAX_SHARE = 0.6;
function maxShownWidth() {
  const shell = document.querySelector(".shell-body");
  return Math.max(SIDEBAR_WIDTH_MIN, (shell?.clientWidth ?? window.innerWidth) * SIDEBAR_MAX_SHARE);
}
