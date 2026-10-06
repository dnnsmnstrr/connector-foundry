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
import InfoTip from "./InfoTip.jsx";
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

  // Circle detail (lib/constants.scad's CIRCLE_DETAIL): "normal" is the
  // catalogue default, so picking it clears the override rather than
  // saving the default as one.
  const detailDefault = globalDefaults?.CIRCLE_DETAIL ?? "normal";
  const detail = saved.CIRCLE_DETAIL ?? detailDefault;
  function applyDetail(value) {
    if (value === detailDefault) clearGlobalOverrides(["CIRCLE_DETAIL"]);
    else updateGlobalOverrides({ CIRCLE_DETAIL: value });
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
      <label className="field has-info-tip">
        <span className="field-label">
          {differs && (
            <span
              className="field-differs"
              role="img"
              aria-label={`Differs from catalogue default ${catalogueDefault}`}
              title={`Catalogue default: ${catalogueDefault}`}
            />
          )}
          Fit clearance (mm)
          <InfoTip
            label="About fit clearance"
            text="Extra gap in parts that fit into each other. Increase it if your printer prints tight. Affects the Basics parts, the 2020 extrusion fittings and bolted or snap joints; parts built on another project's model (Gridfinity, GoPro, openGrid) keep that model's fit."
          />
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
        <input aria-label="Fit clearance (mm)" type="number" step="any" value={current ?? ""} onChange={(e) => apply(e.target.value)} />
      </label>
      <label className="field has-info-tip">
        <span className="field-label">
          {detail !== detailDefault && (
            <span className="field-differs" role="img" aria-label={`Differs from catalogue default ${detailDefault}`} title={`Catalogue default: ${detailDefault}`} />
          )}
          Circle detail
          <InfoTip
            label="About circle detail"
            text="How smooth holes and curves come out. Draft is coarser and renders faster, fine is rounder and slower. Parts that need an exact shape to fit (the BitBeam pin and axle, the 2020 rail, the MultiConnect head) and drilled holes keep theirs."
          />
        </span>
        <select aria-label="Circle detail" value={detail} onChange={(e) => applyDetail(e.target.value)}>
          <option value="draft">Draft</option>
          <option value="normal">Normal</option>
          <option value="fine">Fine</option>
        </select>
      </label>

      <h4 className="settings-section">Bench</h4>
      <label className="field field-checkbox has-info-tip">
        <input type="checkbox" checked={benchFollows} onChange={(e) => toggleBenchFollows(e.target.checked)} />
        <span className="field-label">
          Start an empty Bench with the Library's part
          <InfoTip
            label="About starting the Bench"
            text="When you switch to an empty Bench, the part selected in the Library, with its parameters, becomes its base, like the Open in Bench button. A bench you've started is never replaced."
          />
        </span>
      </label>

      <h4 className="settings-section has-info-tip">
        Part list
        <InfoTip
          label="About the part list"
          text="The parts the Library and the Bench pickers offer, and the order of their groups. A hidden part still works in any bench, link or config that uses it. New groups appear at the end."
        />
      </h4>
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
        Untick to hide, use the arrows to reorder.
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
