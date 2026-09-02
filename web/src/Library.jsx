import { useEffect, useMemo, useRef, useState } from "react";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import { downloadBlob } from "./lib/download.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { getGlobalOverrides, resolveParams } from "./lib/userOverrides.js";
import { slugify } from "./lib/catalogueUtils.js";

// Library mode: pick a part, edit its parameters, render, download the
// STL — or hand it to the Bench as a root with those same parameters.
export default function Library({ parts, onOpenInBench, sidebarCollapsed, onToggleSidebar }) {
  const [selectedId, setSelectedId] = useState(null);
  const [params, setParams] = useState({});
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  // Renders resolve out of order — a cached part swaps in instantly while
  // a slower one is still compiling — so only the newest request may
  // touch the viewer.
  const renderSeq = useRef(0);

  const selected = useMemo(() => parts.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);

  useEffect(() => {
    if (!selectedId && parts.length) setSelectedId(parts[0].id);
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
                <button className="render-button" onClick={() => doRender(params)} disabled={status === "rendering"}>
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
