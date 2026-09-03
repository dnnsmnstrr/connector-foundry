import { useEffect, useMemo, useRef, useState } from "react";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import { downloadBlob } from "./lib/download.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { getGlobalOverrides, resolveParams } from "./lib/userOverrides.js";
import { listedParts, slugify } from "./lib/catalogueUtils.js";
import { useHiddenLibrary } from "./hooks/useHiddenLibrary.js";

// Library mode: pick a part, edit its parameters, render, download the
// STL — or hand it to the Bench as a root with those same parameters.
// `onSelectionChange({ part, params })` reports the current selection
// as it changes, so the shell can seed the Bench with it on a plain
// mode switch when that setting is on (see App.jsx's switchToBench()).
// `initialSelection` is that same record handed back on remount, so a
// round trip through the Bench comes back to the part (and parameter
// edits) that were showing, not to the first part in the catalogue.
export default function Library({
  parts,
  onOpenInBench,
  onSelectionChange,
  initialSelection,
  sidebarCollapsed,
  onToggleSidebar,
}) {
  const [selectedId, setSelectedId] = useState(initialSelection?.part.id ?? null);
  const [params, setParams] = useState({});
  // Consumed by the first selection effect only — after that a pick
  // resolves its params from catalogue defaults + saved overrides.
  const carried = useRef(initialSelection);
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  // Renders resolve out of order — a cached part swaps in instantly while
  // a slower one is still compiling — so only the newest request may
  // touch the viewer.
  const renderSeq = useRef(0);

  const selected = useMemo(() => parts.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);

  // First visit lands on the first part the sidebar actually lists — not
  // one the user hid in Settings (a hidden part still shows here if it's
  // what was selected when it was hidden; it just isn't the default).
  const hidden = useHiddenLibrary();
  useEffect(() => {
    if (!selectedId && parts.length) setSelectedId((listedParts(parts, hidden)[0] ?? parts[0]).id);
  }, [parts, hidden, selectedId]);

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
    const seed = carried.current;
    carried.current = null;
    // Remount with a carried-over selection: keep its params as they
    // were. Otherwise: catalogue default -> saved user override -> (no
    // instance value yet).
    const initial = seed && seed.part.id === selected.id ? seed.params : resolveParams(selected, {});
    setParams(initial);
    doRender(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (selected) onSelectionChange?.({ part: selected, params });
  }, [selected, params, onSelectionChange]);

  function downloadStl() {
    if (!stlBuffer) return;
    downloadBlob(stlBuffer, `${slugify(selected.id)}.stl`, "model/stl");
  }

  return (
    <div className={sidebarCollapsed ? "app sidebar-collapsed" : "app"}>
      <aside className="sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && <PartBrowser parts={parts} activeId={selectedId} onPick={(part) => setSelectedId(part.id)} />}
      </aside>

      <main className="workspace">
        {selected && (
          <>
            <header className="part-header">
              <div>
                <h2>{selected.name}</h2>
                <p className="print-note">{selected.print_note}</p>
              </div>
              <div className="part-header-actions">
                <button
                  className="render-button bench-open-button"
                  onClick={() => onOpenInBench(selected, params)}
                  title="Start a new Bench with this part (and its current parameters) as the root"
                >
                  Open in Bench
                </button>
                <button
                  className="render-button"
                  onClick={() => doRender(params)}
                  disabled={status === "rendering"}
                  aria-live="polite"
                >
                  {status === "rendering" ? "Rendering…" : "Render"}
                </button>
              </div>
            </header>

            <div className="workspace-body">
              <div className="params-panel">
                <ParamsEditor
                  part={selected}
                  params={params}
                  onChange={setParams}
                  emptyText="No parameters — defaults only."
                  showSavedNote
                />
                <p className="source-note">
                  Source:{" "}
                  {selected.source_url ? (
                    <a href={selected.source_url} target="_blank" rel="noreferrer">
                      {selected.source}
                    </a>
                  ) : (
                    selected.source
                  )}
                </p>
                {renderError && (
                  <p className="error-text" role="alert">
                    {renderError}
                  </p>
                )}
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
