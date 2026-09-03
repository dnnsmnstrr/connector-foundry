import { useRef, useState } from "react";
import { CONFIG_EXTENSION } from "../../lib/benchConfig.js";

// Saved bench setups (and, optionally, the config-file import), in one
// panel used in two places: the start screen (no bench yet, so no "save"
// row — just the saved presets to pick up; the import button sits in the
// part picker's toolbar there, see ConfigImportButton) and the sidebar of
// a running bench (save the current setup under a name, load another,
// import a file). The list itself comes from useBenchPresets(), so both
// places always agree.
//
// `onSave(name)` returns true when the preset was stored; absent, the save
// row isn't rendered. `onImportFile(file)` absent means no import button.
// `onLoad(preset)` / `onDelete(name)` do what they say; `error` is
// whatever the last config load/save had to report. `emptyText` null
// renders nothing at all for an empty list.
export default function PresetsPanel({ presets, defaultName = "", onSave, onLoad, onDelete, onImportFile, error, emptyText }) {
  const [name, setName] = useState(defaultName);
  const trimmed = name.trim();
  const replaces = trimmed !== "" && presets.some((p) => p.name.localeCompare(trimmed, undefined, { sensitivity: "base" }) === 0);
  const empty = emptyText === undefined
    ? (onSave ? "No presets yet — name the current bench above to keep it." : "No saved presets yet.")
    : emptyText;

  function submit(e) {
    e.preventDefault();
    onSave(trimmed);
  }

  return (
    <div className="bench-presets">
      {onSave && (
        <form className="bench-preset-save" onSubmit={submit}>
          <input
            type="text"
            className="bench-preset-name"
            placeholder="Preset name"
            aria-label="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="render-button bench-preset-save-button"
            disabled={trimmed === ""}
            title={replaces ? `Replace the saved preset "${trimmed}" with the current bench` : "Save the current bench as a preset in this browser"}
          >
            {replaces ? "Replace" : "Save"}
          </button>
        </form>
      )}

      {presets.length === 0 ? (
        empty && <p className="muted bench-presets-empty">{empty}</p>
      ) : (
        <ul className="bench-preset-list">
          {presets.map((preset) => (
            <li key={preset.name} className="bench-preset-row">
              <button
                type="button"
                className="bench-preset-load"
                onClick={() => onLoad(preset)}
                title={`Load "${preset.name}"${onSave ? " (replaces the current bench)" : ""}`}
              >
                <span className="bench-preset-title">{preset.name}</span>
                <span className="muted bench-preset-meta">{describePreset(preset)}</span>
              </button>
              <button
                type="button"
                className="bench-remove"
                onClick={() => onDelete(preset.name)}
                aria-label={`Delete preset ${preset.name}`}
                title="Delete this preset"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {onImportFile && <ConfigImportButton onFile={onImportFile} className="bench-modal-cancel bench-config-import" />}

      {error && (
        <p className="error-text bench-config-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// "Import config…": a button fronting a hidden file input, so it can sit
// in a toolbar next to "Import STL…" and look like it. Hands the chosen
// File to `onFile`; the input is cleared after each pick so the same file
// can be chosen again after a failed load.
export function ConfigImportButton({ onFile, className = "bench-modal-cancel" }) {
  const fileInputRef = useRef(null);

  function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={`${CONFIG_EXTENSION},.json,application/json`}
        onChange={handleFile}
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        className={className}
        onClick={() => fileInputRef.current?.click()}
        title="Load a bench config file (.bench.json) exported with “Download config”"
      >
        Import config…
      </button>
    </>
  );
}

// "3 parts · 3 Sept 2026" — enough to tell two similarly named presets
// apart without opening them.
function describePreset(preset) {
  const count = 1 + (preset.config?.nodes?.length ?? 0);
  const parts = `${count} part${count === 1 ? "" : "s"}`;
  const date = preset.savedAt ? new Date(preset.savedAt) : null;
  const when = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;
  return when ? `${parts} · ${when}` : parts;
}
