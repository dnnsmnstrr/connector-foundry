import { useMemo, useState } from "react";
import { clearOverrides, getOverrides, setOverrides } from "../lib/userOverrides.js";
import ParamField from "./ParamField.jsx";

// One part's parameter editor: a field per parameter, each showing
// whether it differs from the catalogue default with a one-click reset,
// plus the whole-part row — reset all, "Save as my default" (persist the
// diff against the catalogue as this part's user override, see
// lib/userOverrides.js), and clear that saved default. Library mode and
// every node in the Bench use this same component, so the two can't
// drift in how a saved default is computed or displayed.
//
// `params` is the caller's state; `onChange` gets the whole next object.
// `allowSavedDefaults` is off for an imported part: it has no catalogue
// defaults, and no stable id to save an override under.
export default function ParamsEditor({
  part,
  params,
  onChange,
  emptyText = "No parameters.",
  allowSavedDefaults = true,
  showSavedNote = false,
  className,
}) {
  // Bumped after every save/clear to re-read localStorage; nothing else
  // observes it, which is why it's a dependency below and not a value.
  const [savedVersion, setSavedVersion] = useState(0);
  const savedOverride = useMemo(
    () => (allowSavedDefaults ? getOverrides(part.id) : {}),
    [part.id, allowSavedDefaults, savedVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const hasSavedOverride = Object.keys(savedOverride).length > 0;
  const entries = Object.entries(params ?? {});
  const catalogueDefaults = part.defaults ?? {};

  function setParam(key, value) {
    onChange({ ...params, [key]: value });
  }

  function resetAllToCatalogue() {
    onChange({ ...catalogueDefaults });
  }

  function saveAsDefault() {
    const diff = {};
    for (const [key, value] of entries) {
      if (value !== catalogueDefaults[key]) diff[key] = value;
    }
    setOverrides(part.id, diff);
    setSavedVersion((v) => v + 1);
  }

  function clearSavedDefault() {
    clearOverrides(part.id);
    setSavedVersion((v) => v + 1);
  }

  if (entries.length === 0) return <p className="muted">{emptyText}</p>;

  return (
    <div className={className}>
      {entries.map(([key, value]) => (
        <ParamField
          key={key}
          name={key}
          value={value}
          options={part.options?.[key]}
          catalogueDefault={catalogueDefaults[key]}
          onChange={(next) => setParam(key, next)}
          onReset={() => setParam(key, catalogueDefaults[key])}
        />
      ))}
      {allowSavedDefaults && (
        <div className="params-defaults-row">
          <button className="bench-modal-cancel params-defaults-button" onClick={resetAllToCatalogue}>
            Reset all to catalogue
          </button>
          <button className="bench-modal-cancel params-defaults-button" onClick={saveAsDefault}>
            Save as my default
          </button>
          {hasSavedOverride && (
            <button className="bench-modal-cancel params-defaults-button" onClick={clearSavedDefault}>
              Clear my saved default
            </button>
          )}
        </div>
      )}
      {showSavedNote && hasSavedOverride && (
        <p className="muted params-saved-note">Your saved default for this part: {JSON.stringify(savedOverride)}</p>
      )}
    </div>
  );
}
