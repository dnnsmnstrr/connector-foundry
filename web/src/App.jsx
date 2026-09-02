import yaml from "js-yaml";
import { useEffect, useMemo, useRef, useState } from "react";
import StlViewer from "./components/StlViewer.jsx";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";

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

function ParamField({ name, value, options, onChange }) {
  // A parameter with a fixed set of values is a dropdown, not a text
  // box: these are strings OpenSCAD compares literally, so a typo or the
  // wrong capitalisation silently renders the fallback branch rather
  // than failing. The list comes from catalogue.yaml.
  if (options) {
    return (
      <label className="field">
        {name}
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
        {name}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="field">
        {name}
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
      {name}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function App() {
  const { parts, error } = useCatalogue();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [params, setParams] = useState({});
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
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

  useEffect(() => {
    if (parts && !selectedId) setSelectedId(parts[0].id);
  }, [parts, selectedId]);

  const doRender = async (renderParams) => {
    if (!selected) return;
    const request = { scadFile: selected.file, module: selected.module, params: renderParams };

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
    const defaults = { ...selected.defaults };
    setParams(defaults);
    doRender(defaults);
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

  if (error) return <div className="error-screen">Failed to load catalogue: {error}</div>;
  if (!parts) return <div className="loading-screen">Loading catalogue&hellip;</div>;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Connector Foundry</h1>
        <p className="tagline">Printable mounting interfaces, compiled in your browser.</p>
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
                    onChange={(next) => setParams((p) => ({ ...p, [key]: next }))}
                  />
                ))}
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
