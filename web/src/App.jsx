import yaml from "js-yaml";
import { useEffect, useMemo, useRef, useState } from "react";
import Bench from "./Bench.jsx";
import StlViewer from "./components/StlViewer.jsx";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import {
  clearGlobalOverrides,
  clearOverrides,
  getGlobalOverrides,
  getOverrides,
  resolveParams,
  setOverrides,
  updateGlobalOverrides,
} from "./lib/userOverrides.js";

function useCatalogue() {
  const [parts, setParts] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}catalogue.yaml`)
      .then((res) => res.text())
      .then((text) => setParts(yaml.load(text).parts))
      .catch((err) => setError(err.message));
  }, []);
  return { parts, error };
}

function useGlobalDefaults() {
  const [defaults, setDefaults] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}global-defaults.json`)
      .then((res) => res.json())
      .then(setDefaults)
      .catch(() => setDefaults({}));
  }, []);
  return defaults;
}

function groupBySystem(parts) {
  const groups = new Map();
  for (const part of parts) {
    if (!groups.has(part.system)) groups.set(part.system, []);
    groups.get(part.system).push(part);
  }
  return groups;
}

function matchesSearch(part, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    part.name.toLowerCase().includes(q) ||
    part.system.toLowerCase().includes(q) ||
    part.id.toLowerCase().includes(q) ||
    part.confidence.toLowerCase().includes(q)
  );
}

// catalogueDefault + onReset: an "obvious way to see that a value
// differs from the catalogue default and reset it back" — a dot next
// to the label plus a reset button, shown only when the current value
// actually differs (deep-enough for the primitives every param is).
function ParamField({ name, value, options, catalogueDefault, onChange, onReset }) {
  const differs = catalogueDefault !== undefined && value !== catalogueDefault;
  const label = (
    <span className="field-label">
      {differs && <span className="field-differs" title={`Catalogue default: ${catalogueDefault}`} />}
      {name}
      {differs && onReset && (
        <button type="button" className="field-reset" title="Reset to catalogue default" onClick={onReset}>
          ↺
        </button>
      )}
    </span>
  );

  if (options) {
    return (
      <label className="field">
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="field field-checkbox">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="field">
        {label}
        <input
          type="number"
          value={value}
          step="any"
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <label className="field">
      {label}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Shared by Library and the Bench settings entry point: FIT_CLEARANCE
// and friends, the "same override layer" as per-part defaults but not
// scoped to a part — see web/src/lib/userOverrides.js.
function SettingsModal({ globalDefaults, onClose }) {
  const [saved, setSaved] = useState(() => getGlobalOverrides());
  const catalogueDefault = globalDefaults?.FIT_CLEARANCE;
  const current = saved.FIT_CLEARANCE ?? catalogueDefault;
  const differs = catalogueDefault !== undefined && current !== catalogueDefault;

  function apply(value) {
    setSaved(updateGlobalOverrides({ FIT_CLEARANCE: value }));
  }

  function reset() {
    clearGlobalOverrides(["FIT_CLEARANCE"]);
    setSaved(getGlobalOverrides());
  }

  return (
    <div className="bench-modal-backdrop" onClick={onClose}>
      <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Printer settings</h3>
        <p className="muted">
          Applied to every render, on top of any part's own defaults — the same saved-override layer, just not
          scoped to one part. Only affects parts that actually read FIT_CLEARANCE (Basics and 2020-extrusion parts,
          and bolted/snap joints) — a part that wraps a vendored upstream module directly (Gridfinity, GoPro,
          openGrid) uses that upstream's own fit logic instead and won't change here.
        </p>
        <label className="field">
          <span className="field-label">
            {differs && <span className="field-differs" title={`Catalogue default: ${catalogueDefault}`} />}
            FIT_CLEARANCE (mm) — printer runs tight? increase it.
            {differs && (
              <button type="button" className="field-reset" title="Reset to catalogue default" onClick={reset}>
                ↺
              </button>
            )}
          </span>
          <input
            type="number"
            step="any"
            value={current ?? ""}
            onChange={(e) => apply(Number(e.target.value))}
          />
        </label>
        <button className="bench-modal-cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function Library({ parts, globalDefaults }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [params, setParams] = useState({});
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const [savedVersion, setSavedVersion] = useState(0); // bumps to force a re-read of localStorage
  // Renders resolve out of order — a cached part swaps in instantly while
  // a slower one is still compiling — so only the newest request may
  // touch the viewer.
  const renderSeq = useRef(0);

  const filteredParts = useMemo(
    () => (parts ? parts.filter((p) => matchesSearch(p, search)) : []),
    [parts, search],
  );
  const groups = useMemo(() => groupBySystem(filteredParts), [filteredParts]);
  const selected = useMemo(() => parts?.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);
  const savedOverride = useMemo(
    () => (selected ? getOverrides(selected.id) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, savedVersion],
  );

  useEffect(() => {
    if (parts && !selectedId) setSelectedId(parts[0].id);
  }, [parts, selectedId]);

  const doRender = async (renderParams) => {
    if (!selected) return;
    const request = {
      scadFile: selected.file,
      module: selected.module,
      params: renderParams,
      globalOverrides: getGlobalOverrides(),
    };

    const seq = ++renderSeq.current;

    // Still-warm result: show it straight away rather than flashing a
    // "Rendering…" state for a render that isn't going to happen.
    const cached = getCachedRender(request);
    if (cached) {
      setStlBuffer(cached);
      setRenderError(null);
      setStatus("done");
      return;
    }

    setStatus("rendering");
    setRenderError(null);
    try {
      const buffer = await renderPart(request);
      if (seq !== renderSeq.current) return;
      setStlBuffer(buffer);
      setStatus("done");
    } catch (err) {
      if (seq !== renderSeq.current) return;
      setRenderError(err.message);
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!selected) return;
    // catalogue default -> saved user override -> (no instance value yet)
    const initial = resolveParams(selected, {});
    setParams(initial);
    doRender(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function downloadStl() {
    if (!stlBuffer) return;
    const blob = new Blob([stlBuffer], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.id.replace("/", "_")}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveAsDefault() {
    const catalogueDefaults = selected.defaults ?? {};
    const diff = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== catalogueDefaults[key]) diff[key] = value;
    }
    setOverrides(selected.id, diff);
    setSavedVersion((v) => v + 1);
  }

  function clearSavedDefault() {
    clearOverrides(selected.id);
    setSavedVersion((v) => v + 1);
  }

  function resetAllToCatalogue() {
    const catalogueDefaults = { ...(selected.defaults ?? {}) };
    setParams(catalogueDefaults);
  }

  const hasSavedOverride = Object.keys(savedOverride).length > 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <input
          type="search"
          className="search-input"
          placeholder="Search parts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {filteredParts.length === 0 && <p className="muted no-results">No parts match "{search}".</p>}
        {[...groups.entries()].map(([system, systemParts]) => (
          <div key={system} className="system-group">
            <h2>{system}</h2>
            <ul>
              {systemParts.map((part) => (
                <li key={part.id}>
                  <button
                    className={part.id === selectedId ? "part-button active" : "part-button"}
                    onClick={() => setSelectedId(part.id)}
                  >
                    <span>{part.name}</span>
                    <span className={`badge badge-${part.confidence}`}>{part.confidence}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <main className="workspace">
        {selected && (
          <>
            <header className="part-header">
              <div>
                <h2>{selected.name}</h2>
                <p className="print-note">{selected.print_note}</p>
              </div>
              <button className="render-button" onClick={() => doRender(params)} disabled={status === "rendering"}>
                {status === "rendering" ? "Rendering…" : "Render"}
              </button>
            </header>

            <div className="workspace-body">
              <div className="params-panel">
                {Object.entries(params).length === 0 && <p className="muted">No parameters — defaults only.</p>}
                {Object.entries(params).map(([key, value]) => (
                  <ParamField
                    key={key}
                    name={key}
                    value={value}
                    options={selected.options?.[key]}
                    catalogueDefault={selected.defaults?.[key]}
                    onChange={(next) => setParams((p) => ({ ...p, [key]: next }))}
                    onReset={() => setParams((p) => ({ ...p, [key]: selected.defaults?.[key] }))}
                  />
                ))}

                {Object.keys(params).length > 0 && (
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
                {hasSavedOverride && (
                  <p className="muted params-saved-note">
                    Your saved default for this part: {JSON.stringify(savedOverride)}
                  </p>
                )}

                <p className="source-note">Source: {selected.source}</p>
                {renderError && <p className="error-text">{renderError}</p>}
              </div>

              <div className="viewer-panel">
                {stlBuffer ? (
                  <StlViewer stlBuffer={stlBuffer} />
                ) : (
                  <div className="viewer-placeholder">Render a part to preview it here.</div>
                )}
                {stlBuffer && (
                  <button className="download-button" onClick={downloadStl}>
                    Download STL
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const { parts, error } = useCatalogue();
  const globalDefaults = useGlobalDefaults();
  const [mode, setMode] = useState("library"); // "library" | "bench"
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (error) return <div className="error-screen">Failed to load catalogue: {error}</div>;
  if (!parts) return <div className="loading-screen">Loading catalogue&hellip;</div>;

  return (
    <div className="shell">
      <nav className="mode-tabs">
        <span className="brand">Connector Foundry</span>
        <button className={mode === "library" ? "mode-tab active" : "mode-tab"} onClick={() => setMode("library")}>
          Library
        </button>
        <button className={mode === "bench" ? "mode-tab active" : "mode-tab"} onClick={() => setMode("bench")}>
          Bench
        </button>
        <button className="mode-tab settings-tab" onClick={() => setSettingsOpen(true)} title="Printer settings">
          ⚙ Settings
        </button>
      </nav>
      <div className="shell-body">
        {mode === "library" ? <Library parts={parts} globalDefaults={globalDefaults} /> : <Bench parts={parts} />}
      </div>
      {settingsOpen && <SettingsModal globalDefaults={globalDefaults} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
