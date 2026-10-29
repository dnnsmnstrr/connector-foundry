import { useId, useRef } from "react";

// The tabs at the top of the Library's drawer on a phone (lib/drawer.js's
// DRAWER_TABS_QUERY): the parameter form and the part list, one at a time.
// A segmented control in the ARIA tabs pattern: one tab in the Tab order,
// ←/→ (and Home/End) move between them and show the one they land on.
// Pinned under the drawer's handle while the panel scrolls (styles.css).
/**
 * @param {{
 *   tabs: { id: string, label: string }[],
 *   selected: string,
 *   onSelect: (id: string) => void,
 *   label: string,
 *   children: import("react").ReactNode,
 * }} props
 */
export default function DrawerTabs({ tabs, selected, onSelect, label, children }) {
  // `tabs`: the tabs in order; `selected`: the id on show; `onSelect`:
  // called with a tab's id when it is picked; `label`: the tab list's
  // accessible name; `children`: the selected tab's panel.
  const base = useId();
  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));

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
    onSelect(tabs[next].id);
    listRef.current?.querySelectorAll("button")[next]?.focus();
  }

  return (
    <>
      <div ref={listRef} className="drawer-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-${tab.id}`}
            className="drawer-tab"
            aria-selected={tab.id === selected}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${selected}`}>
        {children}
      </div>
    </>
  );
}
