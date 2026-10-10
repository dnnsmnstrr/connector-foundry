import { useEffect, useMemo, useRef, useState } from "react";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarResizer from "./components/SidebarResizer.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import { downloadBlob } from "./lib/download.js";
import { getCachedRender, renderPart, renderRequestKey } from "./lib/openscad-client.js";
import { resolveParams } from "./lib/userOverrides.js";
import { listedParts, slugify } from "./lib/catalogueUtils.js";
import { useGlobalOverrides } from "./hooks/useGlobalOverrides.js";
import { useHiddenLibrary } from "./hooks/useHiddenLibrary.js";
import { LAYERLING_COPY_TITLE, useLayerlingCopy } from "./hooks/useLayerlingCopy.js";
import { meshExtents } from "./lib/meshExtents.js";
import { outsideDimensions } from "./lib/outsideDimensions.js";

// How long after the last parameter edit the preview re-renders: long
// enough that typing "120" into a number field is one render, not three.
// A result already in the render cache shows at once instead.
const PARAM_RENDER_DELAY_MS = 400;

// Library mode: pick a part, edit its parameters (the preview re-renders
// on its own, PARAM_RENDER_DELAY_MS after the last edit), download the
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
  const [rendered, setRendered] = useState(null);
  const stlBuffer = rendered?.buffer;
  const previewController = useRef(null);
  const globalOverrides = useGlobalOverrides();
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  // Renders resolve out of order — a cached part swaps in instantly while
  // a slower one is still compiling — so only the newest request may
  // touch the viewer.
  const renderSeq = useRef(0);
  // The pending re-render after a parameter edit (changeParams()).
  const paramRenderTimer = useRef(null);

  const selected = useMemo(() => parts.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);

  // First visit lands on the first part the sidebar actually lists — not
  // one the user hid in Settings (a hidden part still shows here if it's
  // what was selected when it was hidden; it just isn't the default).
  const hidden = useHiddenLibrary();
  useEffect(() => {
    if (!selectedId && parts.length) setSelectedId((listedParts(parts, hidden)[0] ?? parts[0]).id);
  }, [parts, hidden, selectedId]);

  const doRender = async (renderParams) => {
    clearTimeout(paramRenderTimer.current);
    if (!selected) return;
    const request = {
      scadFile: selected.file,
      module: selected.module,
      params: renderParams,
      globalOverrides,
    };

    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    const seq = ++renderSeq.current;
    const key = renderRequestKey(request);

    // Still-warm result: show it straight away rather than flashing a
    // "Rendering…" state for a render that isn't going to happen.
    const cached = getCachedRender(request);
    if (cached) {
      setRendered({ buffer: cached, key });
      setRenderError(null);
      setStatus("done");
      return;
    }

    setStatus("rendering");
    setRenderError(null);
    try {
      const buffer = await renderPart(request, { signal: controller.signal });
      if (seq !== renderSeq.current) return;
      setRendered({ buffer, key });
      setStatus("done");
    } catch (err) {
      if (seq !== renderSeq.current) return;
      setRenderError(err.name === "AbortError" ? null : err.message);
      setStatus(err.name === "AbortError" ? "idle" : "error");
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
    return () => {
      ++renderSeq.current;
      clearTimeout(paramRenderTimer.current);
      previewController.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Keep parameter edits when printer settings change, but cancel the
  // preview produced under the old settings and render the current ones.
  const previousGlobals = useRef(globalOverrides);
  useEffect(() => {
    if (previousGlobals.current === globalOverrides) return;
    previousGlobals.current = globalOverrides;
    doRender(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalOverrides]);

  useEffect(() => {
    if (selected) onSelectionChange?.({ part: selected, params });
  }, [selected, params, onSelectionChange]);

  const currentKey = selected && renderRequestKey({
    scadFile: selected.file, module: selected.module, params, globalOverrides,
  });
  const canDownload = status === "done" && rendered?.key === currentKey;
  const dimensions = useMemo(
    () => (canDownload && stlBuffer ? outsideDimensions(meshExtents(stlBuffer)) : null),
    [canDownload, stlBuffer],
  );

  // An edit cancels the render for the old values and queues one for the
  // new — straight away if it is cached, otherwise once the edits pause.
  // Until it lands the download stays off (canDownload compares keys), and
  // the button already says "Rendering…".
  function changeParams(next) {
    ++renderSeq.current;
    previewController.current?.abort();
    clearTimeout(paramRenderTimer.current);
    setRenderError(null);
    setParams(next);
    const request = { scadFile: selected.file, module: selected.module, params: next, globalOverrides };
    if (getCachedRender(request)) {
      doRender(next);
      return;
    }
    setStatus("rendering");
    paramRenderTimer.current = setTimeout(() => doRender(next), PARAM_RENDER_DELAY_MS);
  }

  function downloadStl() {
    if (!canDownload) return;
    downloadBlob(stlBuffer, `${slugify(selected.id)}.stl`, "model/stl");
  }

  const layerling = useLayerlingCopy(setRenderError);
  function copyToLayerling() {
    if (!canDownload) return;
    layerling.copy([{ name: selected.name, stlBuffer }]);
  }

  return (
    <div className={sidebarCollapsed ? "app sidebar-collapsed" : "app"}>
      <aside className="sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && <PartBrowser parts={parts} activeId={selectedId} onPick={(part) => setSelectedId(part.id)} />}
      </aside>
      {!sidebarCollapsed && <SidebarResizer />}

      <main className="workspace">
        {selected && (
          <>
            <header className="part-header">
              <div>
                <h2>{selected.name}</h2>
                <p className="print-note">{selected.print_note}</p>
                {dimensions && (
                  <p className="outside-dimensions" aria-label={`Outside dimensions: width ${dimensions.width} millimetres, height ${dimensions.height} millimetres, depth ${dimensions.depth} millimetres`}>
                    Outside: W {dimensions.width} × H {dimensions.height} × D {dimensions.depth} mm
                  </p>
                )}
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
                  onChange={changeParams}
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
                  <div className="viewer-actions">
                    <button className="download-button layerling-button" onClick={copyToLayerling} disabled={!canDownload || layerling.copying} title={LAYERLING_COPY_TITLE}>
                      {layerling.label}
                    </button>
                    <button className="download-button" onClick={downloadStl} disabled={!canDownload}>
                      Download STL
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
