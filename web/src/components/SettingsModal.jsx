import { useState } from "react";
import { clearGlobalOverrides, getGlobalOverrides, updateGlobalOverrides } from "../lib/userOverrides.js";
import Modal from "./Modal.jsx";

// Printer-level settings — FIT_CLEARANCE and friends, the "same override
// layer" as per-part defaults but not scoped to a part (see
// lib/userOverrides.js). Opened from the nav in either mode.
export default function SettingsModal({ globalDefaults, onClose }) {
  const [saved, setSaved] = useState(() => getGlobalOverrides());
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

  return (
    <Modal onClose={onClose} title="Printer settings">
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
      <button type="button" className="bench-modal-cancel" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
