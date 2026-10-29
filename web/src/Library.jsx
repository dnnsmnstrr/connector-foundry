import { useEffect, useMemo, useRef, useState } from "react";
import DrawerTabs from "./components/DrawerTabs.jsx";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarResizer from "./components/SidebarResizer.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import UndoRedoButtons from "./components/UndoRedoButtons.jsx";
import { downloadBlob } from "./lib/download.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { resolveParams } from "./lib/userOverrides.js";
import { listedParts, slugify } from "./lib/catalogueUtils.js";
import { useGlobalOverrides } from "./hooks/useGlobalOverrides.js";
import { useRender } from "./hooks/useRender.js";
import { useHiddenLibrary } from "./hooks/useHiddenLibrary.js";
import { useLibraryHistory } from "./hooks/useLibraryHistory.js";
import { useUndoShortcuts } from "./hooks/useUndoShortcuts.js";
import { useCommands } from "./hooks/useCommands.js";
import { useDrawerTab, useDrawerTabsLayout } from "./hooks/useDrawerLayout.js";
import { setDrawerTab } from "./lib/drawer.js";
import { useWebMcpTab } from "./hooks/useWebMcp.js";
import { builtin, linkActions, partCommand } from "./lib/commandCatalog.js";
import { LAYERLING_COPY_TITLE, useLayerlingCopy } from "./hooks/useLayerlingCopy.js";
import { recordLibrary, redoLibrary, subscribeLibraryRequest, undoLibrary } from "./lib/librarySession.js";
import { meshBounds, meshExtents } from "./lib/meshExtents.js";
import { outsideDimensions } from "./lib/outsideDimensions.js";
import {
  axisLetter,
  boxEdges,
  centreCross,
  dragResize,
  handlesForBox,
  mirrorHandleId,
  resizeAxes,
  resizeText,
  stepResize,
  typedResize,
  viewerHandles,
} from "./lib/resize.js";
import { getGridSnap } from "./lib/uiPrefs.js";

// How long after the last parameter edit the preview re-renders: long
// enough that typing "120" into a number field is one render, not three.
// A result already in the render cache shows at once instead.
const PARAM_RENDER_DELAY_MS = 400;

// The render request for useRender's key.
function requestFor({ part, params, globalOverrides }) {
  return { scadFile: part.file, module: part.module, params, globalOverrides };
}

/** @typedef {import("./lib/resize.js").Box} Box */

// The shown mesh's box carried over to other parameters: each resize
// axis grows by its slope times the change (X and Y about the centre, Z
// up from the bottom), exactly what a handle's ghost predicts. A box can
// be predicted only while the same axes apply — a switch that changes
// which parameter drives which side (a rail turned vertical) gives null.
// Other parameters are taken not to move the box; a corner radius doesn't.
/**
 * @param {Box} box
 * @param {any} part
 * @param {Record<string, any>} from the parameters the box was rendered with
 * @param {Record<string, any>} to
 * @returns {Box | null}
 */
function predictBox(box, part, from, to) {
  const before = resizeAxes(part, from);
  const after = resizeAxes(part, to);
  const same = (a, b) => a.axis === b.axis && a.param === b.param && a.per === b.per;
  if (before.length !== after.length || !before.every((a, i) => same(a, after[i]))) return null;
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  for (const { axis, param, per } of after) {
    const grown = (Number(to[param]) - Number(from[param])) * per;
    if (!Number.isFinite(grown)) return null;
    if (axis === "x" || axis === "xy") size[0] += grown;
    if (axis === "y" || axis === "xy") size[1] += grown;
    if (axis === "z") size[2] += grown;
  }
  if (!size.every((s) => s > 0)) return null;
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const z0 = box.min[2];
  return {
    min: [cx - size[0] / 2, cy - size[1] / 2, z0],
    max: [cx + size[0] / 2, cy + size[1] / 2, z0 + size[2]],
  };
}

// The ghost for a box: its outline, plus a small cross at its footprint's
// centre when width or depth is changing — the part grows on both sides,
// and the cross says where it stays put. The label sits at the dragged
// handle's new spot.
function ghostFor(handle, axes, box) {
  const footprint = handle.axes.some((key) => key !== "z");
  const span = Math.min(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  const cross = Math.min(10, Math.max(2, span * 0.15));
  const moved = handlesForBox(box, axes).find((h) => h.id === handle.id);
  return {
    segments: footprint ? [...boxEdges(box), ...centreCross(box, cross)] : boxEdges(box),
    textPoint: moved?.point ?? box.max,
  };
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
// `onFindPart()` is the shell's part search (the `/` key): on a phone the
// part list is in the bottom drawer, so the header's "Find a part" button
// (shown in the narrow layout only) opens it there. Under a phone's 600 px
// the drawer holds the parameter form too, on a tab beside the part list
// (components/DrawerTabs.jsx), and the view runs to the foot of the
// screen; a part picked from the list turns to its parameters.
//
// A part whose catalogue entry has `resize` gets TinkerCAD's handles in
// the viewer (lib/resize.js): a drag shows a ghost of the new size and
// commits one parameter change on release, rendered at once; an arrow
// key on a focused handle steps it, with the usual debounce; a click on
// one types an exact size. Every parameter change, handle or sidebar,
// and every switch to another part is a step in the Library's undo
// history (lib/librarySession.js, which outlives this component).
/**
 * @param {{
 *   parts: any[],
 *   onOpenInBench: (...args: any[]) => void,
 *   onAddHoles: (...args: any[]) => void,
 *   onSelectionChange: (...args: any[]) => void,
 *   initialSelection: any,
 *   sidebarCollapsed: boolean,
 *   onToggleSidebar: () => void,
 *   onFindPart: () => void,
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
  onFindPart,
}) {
  // The part and its parameters change together (select()), so no render
  // ever sees one part with another's parameters. A remount with a
  // carried-over selection keeps its params as they were.
  const [selectedId, setSelectedId] = useState(initialSelection?.part.id ?? null);
  const [params, setParams] = useState(initialSelection?.params ?? {});
  // The last handle commit: the parameters it set (the very object, so
  // anything else that changes them — a sidebar edit, undo — no longer
  // matches) and the printer settings it rendered with (a Settings change
  // re-renders the same parameters, and that render is not the commit's),
  // whether it renders at once, and the ghost of the size it asked for,
  // shown until that render lands.
  const [pending, setPending] = useState(null);
  const globalOverrides = useGlobalOverrides();

  const selected = useMemo(() => parts.find((p) => p.id === selectedId) ?? null, [parts, selectedId]);
  // On a phone the form is in the drawer, on a tab beside the part list.
  const tabbed = useDrawerTabsLayout();
  const drawerTab = useDrawerTab();

  // Undo history: record() before each change, with the selection it
  // replaces — from these handlers, never inside a setState updater
  // (StrictMode runs those twice in development).
  const current = () => ({ partId: selectedId, params });
  function restore(entry) {
    if (!entry) return;
    setSelectedId(entry.partId);
    setParams(entry.params);
    setPending(null);
  }
  const undo = () => restore(undoLibrary(current()));
  const redo = () => restore(redoLibrary(current()));
  useUndoShortcuts({ onUndo: undo, onRedo: redo });
  const history = useLibraryHistory();

  // catalogue default -> saved user override -> (no instance value yet).
  function select(part) {
    const next = resolveParams(part, {});
    if (selectedId !== null && (part.id !== selectedId || JSON.stringify(next) !== JSON.stringify(params))) {
      recordLibrary(current(), { label: part.id === selectedId ? "reset parameters" : "switch part" });
    }
    setSelectedId(part.id);
    setParams(next);
    setPending(null);
  }

  // A sidebar edit: one undo step per field being typed into (a run of
  // keystrokes in one field coalesces), one for a reset of them all.
  function editParams(next) {
    const changed = Object.keys({ ...params, ...next }).filter((key) => next[key] !== params[key]);
    if (changed.length) {
      const one = changed.length === 1 ? changed[0] : null;
      recordLibrary(current(), {
        key: one && `param:${one}`,
        label: one ? `edit ${one}` : "edit parameters",
      });
    }
    setParams(next);
    setPending(null);
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

  // A part asked for from outside while the Library is up — a user's
  // command with parameters of its own (librarySession.js's
  // requestLibrarySelection()): a pick like one in the list, an undo step
  // when it changes anything. Through a ref, so the one subscription
  // always sees this render's state.
  const takeRequest = useRef(null);
  takeRequest.current = ({ partId, params: requested }) => {
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    if (
      selectedId !== null &&
      (part.id !== selectedId || JSON.stringify(requested) !== JSON.stringify(params))
    ) {
      recordLibrary(current(), { label: "switch part" });
    }
    setSelectedId(part.id);
    setParams(requested);
    setPending(null);
  };
  useEffect(() => subscribeLibraryRequest((request) => takeRequest.current(request)), []);

  // The preview follows the part, its parameters and the printer
  // settings. A parameter edit waits PARAM_RENDER_DELAY_MS for the edits
  // to pause; a new part, a settings change, Retry preview or a handle
  // drag (or typed size) renders at once, and a result still in the
  // render cache shows straight away. There is no Render button: the
  // preview is always on its way to the current values, and the nav's
  // status (RenderActivity.jsx) says when a render runs.
  const renderKey = useMemo(
    () => (selected ? { part: selected, params, globalOverrides } : null),
    [selected, params, globalOverrides],
  );
  const preview = useRender(renderKey, (key, signal) => renderPart(requestFor(key), { signal }), {
    cached: (key) => getCachedRender(requestFor(key)),
    delay: (key, previous) => {
      // The flag is the committed object itself, not a boolean to reset:
      // a commit that hits the cache never asks for a delay at all.
      if (pending?.immediate && key.params === pending.params) return 0;
      return previous &&
        previous !== key &&
        previous.part === key.part &&
        previous.globalOverrides === key.globalOverrides
        ? PARAM_RENDER_DELAY_MS
        : 0;
    },
  });
  const stlBuffer = preview.result;
  const { status, error: renderError } = preview;
  // How the preview went, for the browser's AI agent (lib/webmcp.js).
  useWebMcpTab({ tab: "library", preview: () => ({ status, error: renderError }) });

  useEffect(() => {
    if (selected) onSelectionChange?.({ part: selected, params });
  }, [selected, params, onSelectionChange]);

  // Until the render for the current values lands the download stays off
  // (the nav's "Rendering…" says why).
  const canDownload = status === "done" && preview.key === renderKey;
  const dimensions = useMemo(
    () => (canDownload && stlBuffer ? outsideDimensions(meshExtents(stlBuffer)) : null),
    [canDownload, stlBuffer],
  );

  // --- Resize handles ------------------------------------------------------
  const fullParams = useMemo(() => ({ ...(selected?.defaults ?? {}), ...params }), [selected, params]);
  const axes = useMemo(() => (selected ? resizeAxes(selected, fullParams) : []), [selected, fullParams]);
  // The handles sit on the mesh on screen when it is current, and on the
  // box predicted from it while a newer render runs — so they stay put
  // (and a focused one keeps its focus) through the render a handle
  // starts, and a second drag can start before the first lands. None on
  // a failed render: the in-viewer note below takes their place.
  const shownKey = preview.key;
  const handleBox = useMemo(() => {
    if (!axes.length || status === "error" || !stlBuffer || shownKey?.part !== selected) return null;
    const bounds = meshBounds(stlBuffer);
    if (shownKey.params === params) return bounds;
    return predictBox(bounds, selected, { ...selected.defaults, ...shownKey.params }, fullParams);
  }, [axes, status, stlBuffer, shownKey, selected, params, fullParams]);
  const handles = useMemo(
    () => (handleBox ? viewerHandles(handleBox, axes, fullParams) : undefined),
    [handleBox, axes, fullParams],
  );
  // The pending ghost stays while its render runs; a cancel (idle), an
  // error, a landed mesh or any other change to the parameters or the
  // printer settings ends it. The failed-render note's Undo is for the
  // resize, so it shows only while the failed render is the resize's.
  const pendingCurrent =
    pending && pending.params === params && pending.globalOverrides === globalOverrides ? pending : null;
  const pendingShown = pendingCurrent && status === "rendering" ? pendingCurrent : null;
  const handleFailed = !!pendingCurrent && status === "error";

  // What a drag started from, for its previews and its commit: the box
  // and parameters at pointerdown, whatever renders land meanwhile.
  const dragStart = useRef(null);
  const findHandle = (id) => handles?.find((h) => h.id === id) ?? null;

  // One handle change, from a drag, a key or a typed size: an undo step
  // (a run of arrow presses on one handle is one), the changed values
  // merged into the current parameters, and the ghost of the new size
  // until its render lands.
  function commitResize(handle, startAxes, result, { immediate, key = null }) {
    if (!result || !Object.keys(result.params).length) return;
    recordLibrary(current(), { key, label: `resize ${handle.axes.map(axisLetter).join(" and ")}` });
    const next = { ...params, ...result.params };
    setParams(next);
    setPending({
      params: next,
      globalOverrides,
      immediate,
      box: result.box,
      ghost: {
        ...ghostFor(handle, startAxes, result.box),
        text: `${resizeText(handle, startAxes, result.box, result)} · rendering…`,
      },
    });
  }

  const onHandleStart = (id) => {
    const handle = findHandle(id);
    dragStart.current = handle && handleBox ? { handle, box: handleBox, params: fullParams, axes } : null;
  };
  const dragResult = (id, point) => {
    const start = dragStart.current;
    if (!start || start.handle.id !== id) return null;
    const result = dragResize({
      handle: start.handle,
      axes: start.axes,
      box: start.box,
      startParams: start.params,
      point,
      gridMm: getGridSnap(),
    });
    return result && { start, result };
  };
  const onHandlePreview = (id, point) => {
    const drag = dragResult(id, point);
    if (!drag) return null;
    const { start, result } = drag;
    // The dragged handle and its mirror ride on the ghost.
    const moved = handlesForBox(result.box, start.axes);
    /** @type {Record<string, number[]>} */
    const handlePoints = {};
    for (const h of moved) if (h.id === id || h.id === mirrorHandleId(id)) handlePoints[h.id] = h.point;
    return {
      ...ghostFor(start.handle, start.axes, result.box),
      text: resizeText(start.handle, start.axes, start.box, result),
      handlePoints,
    };
  };
  const onHandleCommit = (id, point) => {
    const drag = dragResult(id, point);
    if (drag) commitResize(drag.start.handle, drag.start.axes, drag.result, { immediate: true });
  };
  const onHandleStep = (id, steps, modifiers) => {
    const handle = findHandle(id);
    if (!handle || !handleBox) return;
    // Shift is ten steps of a length; ten Gridfinity units would be 420 mm.
    const free = handle.axes.every((key) => !axes.find((a) => a.axis === key)?.step);
    const result = stepResize({
      handle,
      axes,
      box: handleBox,
      startParams: fullParams,
      steps: steps * (modifiers.shiftKey && free ? 10 : 1),
      gridMm: getGridSnap(),
    });
    // Held or repeated presses wait for the usual debounce and make one
    // undo step, like typing into the field.
    commitResize(handle, axes, result, { immediate: false, key: `handle:${id}` });
  };
  const onHandleSet = (id, mm) => {
    const handle = findHandle(id);
    if (!handle || !handleBox) return;
    const result = typedResize({ handle, axes, box: handleBox, startParams: fullParams, mm });
    commitResize(handle, axes, result, { immediate: true });
  };

  // While a commit renders, the header shows the size it asked for,
  // muted, instead of a blank line.
  const predicted = useMemo(
    () =>
      !dimensions && pendingShown
        ? outsideDimensions([0, 1, 2].map((i) => pendingShown.box.max[i] - pendingShown.box.min[i]))
        : null,
    [dimensions, pendingShown],
  );

  function downloadStl() {
    if (!canDownload) return;
    downloadBlob(stlBuffer, `${slugify(selected.id)}.stl`, "model/stl");
  }

  // No "Print with EasyPrint…" here, unlike the Bench and Holes: EasyPrint
  // takes no model from another site (prusaslicer:// links open only
  // printables.com's), so the sheet could only hand over the file that
  // Download STL already saves.

  const layerling = useLayerlingCopy(preview.setError);
  function copyToLayerling() {
    if (!canDownload) return;
    layerling.copy([{ name: selected.name, stlBuffer }]);
  }

  // The palette's Library commands: every part (search-only — picking
  // one is what the sidebar's list does, an undo step like it), and what
  // the header's buttons do for the part on show.
  useCommands("library", () => {
    const waiting = !canDownload && (status === "error" ? "The render failed" : "Waiting for the render…");
    return [
      ...listedParts(parts, hidden).map((part) =>
        partCommand(part, {
          id: `part:${part.id}`,
          searchOnly: true,
          checked: part.id === selectedId,
          actions: [
            { title: "Show in the Library", run: () => select(part) },
            { title: "Open in Bench", run: () => onOpenInBench(part, resolveParams(part, {})) },
            { title: "Add holes", run: () => onAddHoles(part, resolveParams(part, {})) },
          ],
        }),
      ),
      selected && builtin("library.openInBench", { run: () => onOpenInBench(selected, params) }),
      selected && builtin("library.addHoles", { run: () => onAddHoles(selected, params) }),
      selected &&
        builtin("library.render", {
          disabled: status === "rendering" && "Rendering…",
          run: preview.retry,
        }),
      selected && builtin("library.downloadStl", { disabled: waiting, run: downloadStl }),
      selected && builtin("library.layerling", { disabled: waiting, run: copyToLayerling }),
      selected &&
        tabbed &&
        builtin("library.parameters", {
          when: sidebarCollapsed || drawerTab !== "params",
          run: showParameters,
        }),
      selected &&
        Object.keys(selected.defaults ?? {}).length > 0 &&
        builtin("library.resetParams", { run: () => editParams({ ...selected.defaults }) }),
      selected?.source_url &&
        builtin("library.source", { subtitle: selected.source, actions: linkActions(selected.source_url) }),
      builtin("library.undo", {
        when: history.canUndo,
        title: history.undoLabel ? `Undo ${history.undoLabel}` : "Undo",
        run: undo,
      }),
      builtin("library.redo", {
        when: history.canRedo,
        title: history.redoLabel ? `Redo ${history.redoLabel}` : "Redo",
        run: redo,
      }),
    ];
  });

  // The drawer's Parameters tab, open (the palette's "Show the
  // parameters").
  function showParameters() {
    setDrawerTab("params");
    if (sidebarCollapsed) onToggleSidebar();
  }

  // A part picked in the phone's drawer: its parameters next, in the same
  // drawer, while the view above renders it.
  function pickInDrawer(part) {
    select(part);
    setDrawerTab("params");
  }

  const shownDimensions = dimensions ?? predicted;
  // The way back from a failed render, or one the nav's Cancel stopped
  // (a cancelled render ends "idle"; a part on show is never idle
  // otherwise, useRender puts up "rendering" before the first paint):
  // the same values again. Beside the error, as on the Bench and Holes.
  const retryButton = selected && (status === "error" || status === "idle") && (
    <button type="button" className="render-button library-retry" onClick={preview.retry}>
      Retry preview
    </button>
  );
  const paramsPanel = selected && (
    <div className="params-panel">
      <ParamsEditor
        part={selected}
        params={params}
        onChange={editParams}
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
      {/* In the drawer it would be out of sight: the header has it there. */}
      {renderError && !tabbed && (
        <p className="error-text" role="alert">
          {renderError}
        </p>
      )}
      {!tabbed && retryButton}
    </div>
  );
  const classes = ["app", sidebarCollapsed && "sidebar-collapsed", tabbed && "library-tabbed"];
  return (
    <div className={classes.filter(Boolean).join(" ")}>
      <aside className="sidebar">
        <SidebarToggle
          collapsed={sidebarCollapsed}
          onToggle={onToggleSidebar}
          title={tabbed ? "Parameters and parts" : "Part list"}
        />
        {!sidebarCollapsed &&
          (tabbed && selected ? (
            <DrawerTabs
              label="Part"
              tabs={[
                { id: "params", label: "Parameters" },
                { id: "parts", label: "Parts" },
              ]}
              selected={drawerTab}
              onSelect={(id) => setDrawerTab(id === "parts" ? "parts" : "params")}
            >
              {drawerTab === "params" ? (
                paramsPanel
              ) : (
                <PartBrowser parts={parts} activeId={selectedId} onPick={pickInDrawer} />
              )}
            </DrawerTabs>
          ) : (
            <PartBrowser parts={parts} activeId={selectedId} onPick={select} />
          ))}
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
                {shownDimensions ? (
                  <p
                    className={dimensions ? "outside-dimensions" : "outside-dimensions is-predicted"}
                    aria-label={`${dimensions ? "Outside" : "Predicted outside"} dimensions: width ${shownDimensions.width} millimetres, height ${shownDimensions.height} millimetres, depth ${shownDimensions.depth} millimetres`}
                  >
                    Outside: W {shownDimensions.width} × H {shownDimensions.height} × D{" "}
                    {shownDimensions.depth} mm
                  </p>
                ) : (
                  <p className="outside-dimensions" aria-hidden="true">
                    {" "}
                  </p>
                )}
                {/* On a phone the form, and the error under it, are in the
                    drawer: the error is here instead, in sight. */}
                {renderError && tabbed && (
                  <p className="error-text library-header-error" role="alert">
                    {renderError}
                  </p>
                )}
                {tabbed && retryButton}
              </div>
              <div className="part-header-actions">
                <button type="button" className="render-button find-part-button" onClick={onFindPart}>
                  Find a part
                </button>
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
              </div>
            </header>

            <div className="workspace-body">
              {!tabbed && paramsPanel}

              <div className="viewer-panel">
                {stlBuffer ? (
                  <StlViewer
                    stlBuffer={stlBuffer}
                    fitKey={selected.id}
                    handles={handles}
                    ghost={pendingShown?.ghost ?? null}
                    gridControl={axes.some((a) => !a.step)}
                    onHandleStart={onHandleStart}
                    onHandlePreview={onHandlePreview}
                    onHandleCommit={onHandleCommit}
                    onHandleEnd={() => {
                      dragStart.current = null;
                    }}
                    onHandleStep={onHandleStep}
                    onHandleSet={onHandleSet}
                    toolbar={
                      <UndoRedoButtons
                        canUndo={history.canUndo}
                        canRedo={history.canRedo}
                        onUndo={undo}
                        onRedo={redo}
                        undoLabel={history.undoLabel}
                        redoLabel={history.redoLabel}
                      />
                    }
                  />
                ) : (
                  <div className="viewer-placeholder">Render a part to preview it here.</div>
                )}
                {handleFailed && (
                  // The size a handle asked for didn't render (a floor the
                  // module asserts, a WASM limit): the way back is here, by
                  // the handles it replaces. The panel's alert says why.
                  <div className="viewer-error-note">
                    <span>Couldn't render that size.</span>
                    <button type="button" className="viewer-error-undo" onClick={undo}>
                      Undo
                    </button>
                  </div>
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
