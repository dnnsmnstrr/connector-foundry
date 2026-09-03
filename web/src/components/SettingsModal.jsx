import { useMemo, useState } from "react";
import { useHiddenLibrary } from "../hooks/useHiddenLibrary.js";
import { groupBySystem, resolveSystemOrder } from "../lib/catalogueUtils.js";
import {
  getBenchFollowsLibrary,
  getSystemOrder,
  setBenchFollowsLibrary,
  setHiddenLibrary,
  setPartHidden,
  setSystemHidden,
  setSystemOrder,
} from "../lib/uiPrefs.js";
import { clearGlobalOverrides, getGlobalOverrides, updateGlobalOverrides } from "../lib/userOverrides.js";
import Modal from "./Modal.jsx";

// App-wide settings, opened from the nav in either mode. Two kinds live
// here: printer-level render overrides — FIT_CLEARANCE and friends, the
// "same override layer" as per-part defaults but not scoped to a part
// (see lib/userOverrides.js) — and UI preferences (lib/uiPrefs.js),
// including the order of the system headings in every part list and
// which systems and parts are listed at all.
export default function SettingsModal({ parts, globalDefaults, onClose }) {
  const [saved, setSaved] = useState(() => getGlobalOverrides());
  const [benchFollows, setBenchFollows] = useState(getBenchFollowsLibrary);
  // string[] | null; null is catalogue order. The list shown (and moved)
  // is always the resolved full permutation, so a system the saved order
  // predates still has a row.
  const [savedOrder, setSavedOrder] = useState(getSystemOrder);
  const systemOrder = useMemo(() => resolveSystemOrder(parts, savedOrder), [parts, savedOrder]);
  // Curation: every pickable part under its system, with a box per
  // system and per part. Read live from the store so the checkboxes and
  // the part lists behind the dialog can't disagree.
  const hidden = useHiddenLibrary();
  const hiddenSystems = useMemo(() => new Set(hidden.systems), [hidden]);
  const hiddenPartIds = useMemo(() => new Set(hidden.parts), [hidden]);
  const pickable = useMemo(() => parts.filter((p) => !p.hidden), [parts]);
  const partsBySystem = useMemo(() => groupBySystem(pickable), [pickable]);
  const hiddenCount = pickable.filter((p) => hiddenSystems.has(p.system) || hiddenPartIds.has(p.id)).length;
  const catalogueDefault = globalDefaults?.FIT_CLEARANCE;
  const current = saved.FIT_CLEARANCE ?? catalogueDefault;
  const differs = catalogueDefault !== undefined && current !== catalogueDefault;

  function apply(raw) {
    // An emptied field mid-edit is not a request to save 0.
    if (raw === "") return;
    setSaved(updateGlobalOverrides({ FIT_CLEARANCE: Number(raw) }));
  }

  function reset() {
    clearGlobalOverrides(["FIT_CLEARANCE"]);
    setSaved(getGlobalOverrides());
  }

  function toggleBenchFollows(on) {
    setBenchFollowsLibrary(on);
    setBenchFollows(on);
  }

  // Swap the heading at `index` with its neighbour; `dir` is -1 (up) or
  // +1 (down). Saves the whole resolved list, so the stored order is
  // always complete for the catalogue it was made against.
  function moveSystem(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= systemOrder.length) return;
    const next = [...systemOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setSystemOrder(next);
    setSavedOrder(next);
  }

  function resetSystemOrder() {
    setSystemOrder(null);
    setSavedOrder(null);
  }

  return (
    <Modal onClose={onClose} title="Settings">
      <h4 className="settings-section">Printer</h4>
      <p className="muted">
        Applied to every render, on top of any part's own defaults — the same saved-override layer, just not
        scoped to one part. Only affects parts that actually read FIT_CLEARANCE (Basics and the 2020-extrusion
        fittings, and bolted/snap joints) — a part that wraps a vendored upstream module directly (Gridfinity,
        GoPro, openGrid, the 2020 rail) uses that upstream's own geometry instead and won't change here.
      </p>
      <label className="field">
        <span className="field-label">
          {differs && (
            <span
              className="field-differs"
              role="img"
              aria-label={`Differs from catalogue default ${catalogueDefault}`}
              title={`Catalogue default: ${catalogueDefault}`}
            />
          )}
          FIT_CLEARANCE (mm) — printer runs tight? increase it.
          {differs && (
            <button
              type="button"
              className="field-reset"
              aria-label="Reset to catalogue default"
              title="Reset to catalogue default"
              onClick={reset}
            >
              ↺
            </button>
          )}
        </span>
        <input type="number" step="any" value={current ?? ""} onChange={(e) => apply(e.target.value)} />
      </label>

      <h4 className="settings-section">Bench</h4>
      <label className="field field-checkbox">
        <input type="checkbox" checked={benchFollows} onChange={(e) => toggleBenchFollows(e.target.checked)} />
        <span className="field-label">Switching to the Bench opens the Library's selected part</span>
      </label>
      <p className="muted settings-help">
        Same as the "Open in Bench" button: the part selected in the Library, with its current parameters,
        becomes the root of a new bench — only while the Bench is empty; a bench you've started is never
        replaced by a tab switch. Off, an empty Bench starts with its own part picker.
      </p>

      <h4 className="settings-section">Part list</h4>
      <ol className="settings-order-list" aria-label="Systems: shown or hidden, and their order">
        {systemOrder.map((system, index) => {
          const systemHidden = hiddenSystems.has(system);
          const systemParts = partsBySystem.get(system) ?? [];
          const hiddenHere = systemHidden
            ? systemParts.length
            : systemParts.filter((p) => hiddenPartIds.has(p.id)).length;
          return (
          <li key={system} className={systemHidden ? "settings-order-row is-hidden" : "settings-order-row"}>
            <div className="settings-system">
              <label className="settings-system-toggle">
                <input
                  type="checkbox"
                  checked={!systemHidden}
                  onChange={(e) => setSystemHidden(system, !e.target.checked)}
                  aria-label={`Show ${system} in the part lists`}
                />
                <span>{system}</span>
              </label>
              {systemParts.length > 0 && (
                <details className="settings-parts">
                  <summary>
                    {systemParts.length} part{systemParts.length === 1 ? "" : "s"}
                    {hiddenHere > 0 && <span className="muted">, {hiddenHere} hidden</span>}
                  </summary>
                  <ul className="settings-part-list">
                    {systemParts.map((part) => (
                      <li key={part.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={!systemHidden && !hiddenPartIds.has(part.id)}
                            disabled={systemHidden}
                            onChange={(e) => setPartHidden(part.id, !e.target.checked)}
                            aria-label={`Show ${part.name} in the part lists`}
                          />
                          <span>{part.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <span className="settings-order-actions">
              <button
                type="button"
                aria-label={`Move ${system} up`}
                title="Move up"
                disabled={index === 0}
                onClick={() => moveSystem(index, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${system} down`}
                title="Move down"
                disabled={index === systemOrder.length - 1}
                onClick={() => moveSystem(index, 1)}
              >
                ▼
              </button>
            </span>
          </li>
          );
        })}
      </ol>
      <p className="muted settings-help">
        What the Library sidebar and both Bench pickers list, and in what order. Untick a system or a part to
        keep it out of every list — a bench that already uses a hidden part keeps working, and so do links and
        configs that name one. Catalogue order by default; a system added later appears at the end.
        {savedOrder && (
          <>
            {" "}
            <button type="button" className="field-reset settings-order-reset" onClick={resetSystemOrder}>
              ↺ Reset to catalogue order
            </button>
          </>
        )}
        {hiddenCount > 0 && (
          <>
            {" "}
            <button type="button" className="field-reset settings-order-reset" onClick={() => setHiddenLibrary({})}>
              ↺ Show all {hiddenCount} hidden part{hiddenCount === 1 ? "" : "s"}
            </button>
          </>
        )}
      </p>

      <button type="button" className="bench-modal-cancel" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
