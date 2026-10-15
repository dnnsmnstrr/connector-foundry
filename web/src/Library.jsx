import { useEffect, useMemo, useState } from "react";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarResizer from "./components/SidebarResizer.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import { downloadBlob } from "./lib/download.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { resolveParams } from "./lib/userOverrides.js";
import { listedParts, slugify } from "./lib/catalogueUtils.js";
import { useGlobalOverrides } from "./hooks/useGlobalOverrides.js";
import { useRender } from "./hooks/useRender.js";
import { useHiddenLibrary } from "./hooks/useHiddenLibrary.js";
import { LAYERLING_COPY_TITLE, useLayerlingCopy } from "./hooks/useLayerlingCopy.js";
import { meshExtents } from "./lib/meshExtents.js";
import { outsideDimensions } from "./lib/outsideDimensions.js";

// How long after the last parameter edit the preview re-renders: long
// enough that typing "120" into a number field is one render, not three.
// A result already in the render cache shows at once instead.
const PARAM_RENDER_DELAY_MS = 400;

// The render request for useRender's key.
function requestFor({ part, params, globalOverrides }) {
  return { scadFile: part.file, module: part.module, params, globalOverrides };
}

// Library mode: pick a part, edit its parameters (the preview re-renders
// on its own, PARAM_RENDER_DELAY_MS after the last edit), download the
// STL — or hand it to the Bench as a root with those same parameters.
// `onSelectionChange({ part, params })` reports the current selection
// as it changes, so the shell can seed the Bench with it on a plain
// mode switch when that setting is on (see App.jsx's switchToBench()).
// `initialSelection` is that same record handed back on remount, so a
// round trip through the Bench comes back to the part (and parameter
// edits) that were showing, not to the first part in the catalogue.
/**
 * @param {{
 *   parts: any[],
 *   onOpenInBench: (...args: any[]) => void,
 *   onAddHoles: (...args: any[]) => void,
 *   onSelectionChange: (...args: any[]) => void,
 *   initialSelection: any,
 *   sidebarCollapsed: boolean,
 *   onToggleSidebar: () => void,
 * }} props
 */
export default function Library({
  parts,
  onOpenInBench,
  onAddHoles,
  onSelectionChange,
  initialSelection,
  sidebarCollapsed,
  onToggleSidebar,
}) {
  // The part and its parameters change together (select()), so no render
  // ever sees one part with another's parameters. A remount with a
  // carried-over selection keeps its params as they were.
  const [selectedId, setSelectedId] = useState(initialSelection?.part.id ?? null);
  const [params, setParams] = useState(initialSelection?.params ?? {});
  const globalOverrides = useGlobalOverrides();

  const selected = useMemo(() => parts.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);

  // catalogue default -> saved user override -> (no instance value yet).
  function select(part) {
    setSelectedId(part.id);
    setParams(resolveParams(part, {}));
  }

  // First visit lands on the first part the sidebar actually lists — not
  // one the user hid in Settings (a hidden part still shows here if it's
  // what was selected when it was hidden; it just isn't the default).
  const hidden = useHiddenLibrary();
  useEffect(() => {
    if (selectedId || !parts.length) return;
    const first = listedParts(parts, hidden)[0] ?? parts[0];
    setSelectedId(first.id);
    setParams(resolveParams(first, {}));
  }, [parts, hidden, selectedId]);

  // The preview follows the part, its parameters and the printer
  // settings. A parameter edit waits PARAM_RENDER_DELAY_MS for the edits
  // to pause; a new part, a settings change or the Render button renders
  // at once, and a result still in the render cache shows straight away.
  const renderKey = useMemo(
    () => (selected ? { part: selected, params, globalOverrides } : null),
    [selected, params, globalOverrides],
  );
  const preview = useRender(renderKey, (key, signal) => renderPart(requestFor(key), { signal }), {
    cached: (key) => getCachedRender(requestFor(key)),
    delay: (key, previous) =>
      previous &&
      previous !== key &&
      previous.part === key.part &&
      previous.globalOverrides === key.globalOverrides
        ? PARAM_RENDER_DELAY_MS
        : 0,
  });
  const stlBuffer = preview.result;
  const { status, error: renderError } = preview;

  useEffect(() => {
    if (selected) onSelectionChange?.({ part: selected, params });
  }, [selected, params, onSelectionChange]);

  // Until the render for the current values lands the download stays off,
  // and the Render button already says "Rendering…".
  const canDownload = status === "done" && preview.key === renderKey;
  const dimensions = useMemo(
    () => (canDownload && stlBuffer ? outsideDimensions(meshExtents(stlBuffer)) : null),
    [canDownload, stlBuffer],
  );

  function downloadStl() {
    if (!canDownload) return;
    downloadBlob(stlBuffer, `${slugify(selected.id)}.stl`, "model/stl");
  }

  const layerling = useLayerlingCopy(preview.setError);
  function copyToLayerling() {
    if (!canDownload) return;
    layerling.copy([{ name: selected.name, stlBuffer }]);
  }

  return (
    <div className={sidebarCollapsed ? "app sidebar-collapsed" : "app"}>
      <aside className="sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && <PartBrowser parts={parts} activeId={selectedId} onPick={select} />}
      </aside>
      {!sidebarCollapsed && <SidebarResizer />}

      <main className="workspace">
        {selected && (
          <>
            <header className="part-header">
              <div>
                <h2>{selected.name}</h2>
                <p className="print-note">{selected.print_note}</p>
                {/* The line keeps its height while a render is in flight
                    (dimensions is null until it lands), so the form and the
                    viewer below don't jump up and back on every edit. */}
                {dimensions ? (
                  <p
                    className="outside-dimensions"
                    aria-label={`Outside dimensions: width ${dimensions.width} millimetres, height ${dimensions.height} millimetres, depth ${dimensions.depth} millimetres`}
                  >
                    Outside: W {dimensions.width} × H {dimensions.height} × D {dimensions.depth} mm
                  </p>
                ) : (
                  <p className="outside-dimensions" aria-hidden="true">
                    {"\u00a0"}
                  </p>
                )}
              </div>
              <div className="part-header-actions">
                <button
                  type="button"
                  className="render-button bench-open-button"
                  onClick={() => onOpenInBench(selected, params)}
                  title="Start a new Bench with this part (and its current parameters) as the root"
                >
                  Open in Bench
                </button>
                <button
                  type="button"
                  className="render-button bench-open-button"
                  onClick={() => onAddHoles(selected, params)}
                  title="Drill holes into this part (with its current parameters) in the Holes tab"
                >
                  Add Holes
                </button>
                <button
                  type="button"
                  className="render-button"
                  onClick={preview.retry}
                  disabled={status === "rendering"}
                  aria-live="polite"
                >
                  {/* Sized for the longer label either way, so the button
                      doesn't grow when a render starts. */}
                  <span className="stable-label">
                    <span>{status === "rendering" ? "Rendering…" : "Render"}</span>
                    <span className="stable-label-sizer" aria-hidden="true">
                      Rendering…
                    </span>
                  </span>
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
                  <div className="viewer-actions">
                    <button
                      type="button"
                      className="download-button layerling-button"
                      onClick={copyToLayerling}
                      disabled={!canDownload || layerling.copying}
                      title={LAYERLING_COPY_TITLE}
                    >
                      {layerling.label}
                    </button>
                    <button
                      type="button"
                      className="download-button"
                      onClick={downloadStl}
                      disabled={!canDownload}
                    >
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
