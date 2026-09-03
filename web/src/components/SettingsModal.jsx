import { useMemo, useState } from "react";
import { resolveSystemOrder } from "../lib/catalogueUtils.js";
import { getBenchFollowsLibrary, getSystemOrder, setBenchFollowsLibrary, setSystemOrder } from "../lib/uiPrefs.js";
import { clearGlobalOverrides, getGlobalOverrides, updateGlobalOverrides } from "../lib/userOverrides.js";
import Modal from "./Modal.jsx";

// App-wide settings, opened from the nav in either mode. Two kinds live
// here: printer-level render overrides — FIT_CLEARANCE and friends, the
// "same override layer" as per-part defaults but not scoped to a part
// (see lib/userOverrides.js) — and UI preferences (lib/uiPrefs.js),
// including the order of the system headings in every part list.
export default function SettingsModal({ parts, globalDefaults, onClose }) {
  const [saved, setSaved] = useState(() => getGlobalOverrides());
  const [benchFollows, setBenchFollows] = useState(getBenchFollowsLibrary);
  // string[] | null; null is catalogue order. The list shown (and moved)
  // is always the resolved full permutation, so a system the saved order
  // predates still has a row.
  const [savedOrder, setSavedOrder] = useState(getSystemOrder);
  const systemOrder = useMemo(() => resolveSystemOrder(parts, savedOrder), [parts, savedOrder]);
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
        becomes the root of a new bench. Off, the Bench starts with its own part picker.
      </p>

      <h4 className="settings-section">Part list</h4>
      <ol className="settings-order-list" aria-label="System heading order">
        {systemOrder.map((system, index) => (
          <li key={system} className="settings-order-row">
            <span>{system}</span>
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
        ))}
      </ol>
      <p className="muted settings-help">
        The order of the system headings in the Library sidebar and both Bench pickers. Catalogue order by
        default; a system added later appears at the end.
        {savedOrder && (
          <>
            {" "}
            <button type="button" className="field-reset settings-order-reset" onClick={resetSystemOrder}>
              ↺ Reset to catalogue order
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
