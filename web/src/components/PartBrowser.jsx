import { useMemo, useState } from "react";
import { useHiddenLibrary } from "../hooks/useHiddenLibrary.js";
import { useSystemOrder } from "../hooks/useSystemOrder.js";
import { groupBySystem, listedParts, matchesSearch, resolveSystemOrder } from "../lib/catalogueUtils.js";

// Search box + the catalogue grouped by system, one button per part —
// Library's sidebar and both of the Bench's pickers (start a bench,
// attach to a slot) are this same list, so a part shows up under the
// same heading with the same badge everywhere. `toolbar` renders
// between the search box and the list (the Bench's "Import STL…"
// button); `activeId` highlights the selected part where there is one.
//
// `autoFocus` is honoured only with a fine pointer: on a touch device it
// would pop the keyboard over the list the moment it appears. The same
// flag marks the box data-autofocus so Modal.jsx can steer focus to it.
//
// The system headings follow the order saved in Settings ("Part list"),
// catalogue order by default — resolved against the full `parts` list,
// not the filtered one, so a search never reshuffles what is left.
//
// What's listed is catalogueUtils.js's listedParts(): the catalogue minus
// entries it marks `hidden` itself and minus whatever the user hid in
// Settings ("Part list"), live through useHiddenLibrary() — all of which
// stay in `parts` for the code that looks parts up by id.
export default function PartBrowser({ parts, activeId, onPick, toolbar, autoFocus = false }) {
  const [search, setSearch] = useState("");
  const savedOrder = useSystemOrder();
  const hidden = useHiddenLibrary();
  const listed = useMemo(() => listedParts(parts, hidden), [parts, hidden]);
  const order = useMemo(() => resolveSystemOrder(listed, savedOrder), [listed, savedOrder]);
  const filtered = useMemo(() => listed.filter((p) => matchesSearch(p, search)), [listed, search]);
  const groups = useMemo(() => groupBySystem(filtered, order), [filtered, order]);
  const focusOnOpen = autoFocus && !hasCoarsePointer();

  return (
    <>
      <input
        type="search"
        className="search-input"
        placeholder="Search parts…"
        aria-label="Search parts"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus={focusOnOpen}
        data-autofocus={focusOnOpen ? "" : undefined}
      />
      {toolbar}
      {filtered.length === 0 && (
        <p className="muted no-results" role="status">
          No parts match "{search}".
        </p>
      )}
      {[...groups.entries()].map(([system, systemParts]) => (
        <div key={system} className="system-group">
          <h2>{system}</h2>
          <ul>
            {systemParts.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  className={part.id === activeId ? "part-button active" : "part-button"}
                  aria-current={part.id === activeId ? "true" : undefined}
                  onClick={() => onPick(part)}
                >
                  <span>{part.name}</span>
                  <span className={`badge badge-${part.confidence}`}>{part.confidence}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function hasCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}
