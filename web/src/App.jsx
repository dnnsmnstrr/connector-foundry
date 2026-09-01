import yaml from "js-yaml";
import { useEffect, useMemo, useState } from "react";
import StlViewer from "./components/StlViewer.jsx";
import { renderPart } from "./lib/openscad-client.js";

function useCatalogue() {
  const [parts, setParts] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch("/catalogue.yaml")
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

function ParamField({ name, value, onChange }) {
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
  const [selectedId, setSelectedId] = useState(null);
  const [params, setParams] = useState({});
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);

  const groups = useMemo(() => (parts ? groupBySystem(parts) : new Map()), [parts]);
  const selected = useMemo(() => parts?.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);

  useEffect(() => {
    if (parts && !selectedId) setSelectedId(parts[0].id);
  }, [parts, selectedId]);

  useEffect(() => {
    if (selected) setParams({ ...selected.defaults });
  }, [selected]);

  async function doRender() {
    if (!selected) return;
    setStatus("rendering");
    setRenderError(null);
    try {
      const buffer = await renderPart({ scadFile: selected.file, module: selected.module, params });
      setStlBuffer(buffer);
      setStatus("done");
    } catch (err) {
      setRenderError(err.message);
      setStatus("error");
    }
  }

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
              <button className="render-button" onClick={doRender} disabled={status === "rendering"}>
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
