import { useState } from "react";
import { getBenchFollowsLibrary, setBenchFollowsLibrary } from "../lib/uiPrefs.js";
import { clearGlobalOverrides, getGlobalOverrides, updateGlobalOverrides } from "../lib/userOverrides.js";
import Modal from "./Modal.jsx";

// App-wide settings, opened from the nav in either mode. Two kinds live
// here: printer-level render overrides — FIT_CLEARANCE and friends, the
// "same override layer" as per-part defaults but not scoped to a part
// (see lib/userOverrides.js) — and UI preferences (lib/uiPrefs.js).
export default function SettingsModal({ globalDefaults, onClose }) {
  const [saved, setSaved] = useState(() => getGlobalOverrides());
  const [benchFollows, setBenchFollows] = useState(getBenchFollowsLibrary);
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

  return (
    <Modal onClose={onClose} title="Settings">
      <h4 className="settings-section">Printer</h4>
      <p className="muted">
        Applied to every render, on top of any part's own defaults — the same saved-override layer, just not
        scoped to one part. Only affects parts that actually read FIT_CLEARANCE (Basics and 2020-extrusion parts,
        and bolted/snap joints) — a part that wraps a vendored upstream module directly (Gridfinity, GoPro,
        openGrid) uses that upstream's own fit logic instead and won't change here.
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

      <button type="button" className="bench-modal-cancel" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
