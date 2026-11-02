import { useRef } from "react";

// The tabs of the narrow layout's drawer (lib/drawer.js), phone or tablet: the
// Library's parameter form and part list, Holes' holes and hole types,
// one at a time. A segmented control in the ARIA tabs pattern: one tab in
// the Tab order, ←/→ (and Home/End) move between them and show the one
// they land on.
//
// Two pieces, because they live in different places. The tab list is part
// of the drawer's handle (SidebarToggle.jsx renders it under the grip), so
// it shows while the drawer is closed too and a tap on a tab opens the
// drawer on that tab; the panel is the drawer's content, which a closed
// drawer doesn't render. `id` ties the two together: the tabs are
// `<id>-<tab>`, the panel `<id>-panel`.

/**
 * @typedef {object} DrawerTabsSpec
 * @property {string} id the base of the tabs' and the panel's ids (one per page)
 * @property {string} label the tab list's accessible name
 * @property {{ id: string, label: string }[]} tabs the tabs in order
 * @property {string} selected the id on show
 * @property {(id: string) => void} onSelect called with a tab's id when it is picked
 */

/**
 * @param {DrawerTabsSpec & {
 *   onPick?: (id: string) => void,
 *   panelShown?: boolean,
 *   dragProps?: import("react").HTMLAttributes<HTMLDivElement>,
 * }} props
 */
export function DrawerTabList({ id, label, tabs, selected, onSelect, onPick, panelShown = true, dragProps }) {
  // `onPick`: called after `onSelect` when a tab is tapped or reached by a
  // key (the handle opens a closed drawer with it); `panelShown`: whether
  // the panel is in the page, for aria-controls; `dragProps`: the handle's
  // pointer handlers, so the row drags the sheet as the grip does.
  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  /** @param {string} tabId */
  function pick(tabId) {
    onSelect(tabId);
    onPick?.(tabId);
  }

  function onKeyDown(e) {
    const at = tabs.findIndex((t) => t.id === selected);
    let next = null;
    if (e.key === "ArrowRight") next = (at + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (at - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    // The keys are the tabs': not a scroll, nor anything a window
    // listener does with an arrow.
    e.preventDefault();
    e.stopPropagation();
    pick(tabs[next].id);
    listRef.current?.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div
      {...dragProps}
      ref={listRef}
      className="drawer-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${id}-${tab.id}`}
          className="drawer-tab"
          aria-selected={tab.id === selected}
          aria-controls={panelShown ? `${id}-panel` : undefined}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => pick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * @param {{ id: string, selected: string, children: import("react").ReactNode }} props
 */
export function DrawerTabPanel({ id, selected, children }) {
  // `id` and `selected`: as the tab list's; `children`: the selected
  // tab's content.
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}`}>
      {children}
    </div>
  );
}
