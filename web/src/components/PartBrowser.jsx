import { useMemo, useState } from "react";
import { groupBySystem, matchesSearch } from "../lib/catalogueUtils.js";

// Search box + the catalogue grouped by system, one button per part —
// Library's sidebar and both of the Bench's pickers (start a bench,
// attach to a slot) are this same list, so a part shows up under the
// same heading with the same badge everywhere. `toolbar` renders
// between the search box and the list (the Bench's "Import STL…"
// button); `activeId` highlights the selected part where there is one.
export default function PartBrowser({ parts, activeId, onPick, toolbar, autoFocus = false }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => parts.filter((p) => matchesSearch(p, search)), [parts, search]);
  const groups = useMemo(() => groupBySystem(filtered), [filtered]);

  return (
    <>
      <input
        type="search"
        className="search-input"
        placeholder="Search parts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus={autoFocus}
      />
      {toolbar}
      {filtered.length === 0 && <p className="muted no-results">No parts match "{search}".</p>}
      {[...groups.entries()].map(([system, systemParts]) => (
        <div key={system} className="system-group">
          <h2>{system}</h2>
          <ul>
            {systemParts.map((part) => (
              <li key={part.id}>
                <button
                  className={part.id === activeId ? "part-button active" : "part-button"}
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
