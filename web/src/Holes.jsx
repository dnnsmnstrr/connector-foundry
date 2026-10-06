import { useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import ImportFlow from "./components/bench/ImportFlow.jsx";
import HoleSpecFields from "./components/holes/HoleSpecFields.jsx";
import PresetPicker from "./components/holes/PresetPicker.jsx";
import ScrewIcon from "./components/holes/ScrewIcon.jsx";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import { useBenchSession } from "./hooks/useBenchSession.js";
import { useGlobalOverrides } from "./hooks/useGlobalOverrides.js";
import { useHolesSession } from "./hooks/useHolesSession.js";
import { benchName, compileToScad } from "./lib/assembly.js";
import { defaultBenchName, exportFilename } from "./lib/benchName.js";
import { downloadBlob } from "./lib/download.js";
import { groundedMesh } from "./lib/importedPart.js";
import { setHolesDoc } from "./lib/holesSession.js";
import { isEditableTarget } from "./lib/isEditableTarget.js";
import { meshExtents } from "./lib/meshExtents.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { outsideDimensions } from "./lib/outsideDimensions.js";
import {
  addHole,
  createHolesDoc,
  distance,
  getHole,
  holeLabel,
  holesToScad,
  removeHole,
  setDocName,
  setNextSpec,
  sourceLabel,
  sourceStem,
  updateHole,
} from "./lib/screwHoles.js";
import { getPreset, specMatchesPreset } from "./lib/screwPresets.js";
import { DEFAULT_CORNER_INSET_MM, analyzeFace, gridPoint, nearestCandidate, planePoint } from "./lib/snapCandidates.js";
import { resolveParams } from "./lib/userOverrides.js";

// Debounce between the last hole edit and the re-render it triggers, so
// typing a diameter doesn't compile once per keystroke.
const RENDER_DEBOUNCE_MS = 250;
// Marker colours: holes in the imported-badge blue, the selected one and
// the snap point about to be used in the selection yellow, the rest of
// a face's snap points by kind.
const HOLE_COLOR = 0x7fa8e0;
const SELECTED_COLOR = 0xffd23f;
const SNAP_COLORS = { hole: 0x7fa8e0, center: 0x2ecc71, quarter: 0xd8d9db, corner: 0xd8d9db };

// Holes mode: take a model — a catalogue part with its parameters, a
// mesh brought in as STL/STEP/3MF, or the current bench as one mesh — and
// drill screw holes into it by clicking its faces. A click snaps to the
// significant points of the flat face under it (lib/snapCandidates.js):
// its center, the center of each quadrant, the centers of holes already
// through it, and a point set in from each corner. Each hole
// has a diameter, a depth (or goes through), and a head pocket —
// counterbore, countersink or hex — from a preset (lib/screwPresets.js)
// or typed in. The result is rendered as `difference() { base; holes }`
// through the same worker as everything else (lib/screwHoles.js's
// holesToScad()) and exported as STL or .scad.
//
// The document lives in lib/holesSession.js so a trip to the Bench and
// back doesn't lose it; selection, hover and the viewer are local.
export default function Holes({ parts, sidebarCollapsed, onToggleSidebar, librarySelection }) {
  const globalOverrides = useGlobalOverrides();
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const { doc } = useHolesSession();
  const setDoc = setHolesDoc;
  const bench = useBenchSession();

  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [snapOn, setSnapOn] = useState(true);
  const [inset, setInset] = useState(DEFAULT_CORNER_INSET_MM);
  // The face under the pointer and the snap point that would be used:
  // { faceKey, snapId } — compared by value so a pointer moving across
  // one face doesn't re-render anything.
  const [hover, setHover] = useState(null);
  const [stlBuffer, setStlBuffer] = useState(null);
  const [baseExtents, setBaseExtents] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const [renderRetry, setRenderRetry] = useState(0);
  const [benchBusy, setBenchBusy] = useState(false);
  const renderSeq = useRef(0);
  // Every face analysed on the current mesh, by key — a click on a snap
  // marker resolves through this, whichever face the pointer is on now.
  const facesRef = useRef(new Map());

  // --- the mesh on screen ------------------------------------------------
  // The base alone when there are no holes (a catalogue part rendered
  // standalone — a cache hit if the Library just showed it — or the
  // imported bytes as they are), else the base with the holes cut, via
  // the generated source. The base's extents give a through hole its
  // length and the snap radius its scale, so the holed render waits on
  // them; after the first time that is a lookup.
  useEffect(() => {
    if (!doc) {
      setStlBuffer(null);
      setBaseExtents(null);
      return;
    }
    const seq = ++renderSeq.current;
    const controller = new AbortController();
    const signal = controller.signal;
    const run = async () => {
      setStatus("rendering");
      setRenderError(null);
      try {
        const base = await baseBuffer(doc.source, catalogueById, globalOverrides, signal);
        const extents = meshExtents(base);
        const buf = doc.holes.length ? await renderPart(holedRequest(doc, catalogueById, extents, globalOverrides), { signal }) : base;
        if (seq !== renderSeq.current) return;
        setBaseExtents(extents);
        setStlBuffer(buf);
        setStatus("done");
      } catch (err) {
        if (seq !== renderSeq.current) return;
        setRenderError(err.name === "AbortError" ? null : err.message);
        setStatus(err.name === "AbortError" ? "idle" : "error");
      }
    };
    // Only a real compile is worth waiting out the debounce for.
    const cached = doc.holes.length === 0 || getCachedRender(holedRequestIfKnown(doc, catalogueById, baseExtents, globalOverrides)) !== null;
    const timer = setTimeout(run, cached ? 0 : RENDER_DEBOUNCE_MS);
    return () => {
      ++renderSeq.current;
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.source, doc?.holes, catalogueById, globalOverrides, renderRetry]);

  // Two geometries from one STL: the parsed one for display (flat facet
  // normals straight from the file), and a welded, indexed copy for the
  // face analysis — triangle adjacency is meaningless on a triangle soup
  // (see faceCluster.js). Triangle order is the same in both, so the
  // viewer's hit on the display mesh indexes the welded one directly.
  const geometries = useMemo(() => {
    if (!stlBuffer) return null;
    const display = new STLLoader().parse(stlBuffer);
    const stripped = new BufferGeometry();
    stripped.setAttribute("position", display.getAttribute("position"));
    const topo = mergeVertices(stripped, 1e-3);
    facesRef.current = new Map();
    return { display, topo };
  }, [stlBuffer]);
  useEffect(
    () => () => {
      geometries?.display.dispose();
      geometries?.topo.dispose();
    },
    [geometries],
  );
  useEffect(() => setHover(null), [geometries]);

  const dimensions = useMemo(() => (stlBuffer ? outsideDimensions(meshExtents(stlBuffer)) : null), [stlBuffer]);
  const maxExtent = baseExtents ? Math.max(...baseExtents) : 50;
  // How close to a snap point a click has to land to take it, and how
  // big the dots are — both scaled to the model.
  const snapRadius = Math.max(1.5, 0.04 * maxExtent);
  const snapDot = Math.max(0.6, 0.018 * maxExtent);

  // --- keys ----------------------------------------------------------
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    if (e.key === "Escape") {
      if (importOpen) setImportOpen(false);
      else if (selectedId) setSelectedId(null);
      return;
    }
    if (importOpen || !doc || !selectedId || isEditableTarget(e.target)) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteHole(selectedId);
    }
  };
  useEffect(() => {
    const onKeyDown = (e) => keyHandlerRef.current?.(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- picking a base ------------------------------------------------
  function start(source, name = null) {
    setDoc(createHolesDoc(source, name));
    setSelectedId(null);
    setRenderError(null);
  }

  function pickCataloguePart(part, params = resolveParams(part, {})) {
    start({ kind: "catalogue", partId: part.id, params });
  }

  // Centered on the grid with its bottom at z = 0 (see groundedMesh()):
  // a file saved at some corner of a print bed would otherwise sit far
  // from the grid, and a hole's coordinates would carry that offset.
  function useImportedMesh(part) {
    const { stlBytes, extents } = groundedMesh(part.geometry);
    start({ kind: "mesh", name: part.name, stlBytes, extents });
    setImportOpen(false);
  }

  // The bench as one mesh: its "all" body, rendered through the same
  // request the Bench's own preview uses, so it is a cache hit when the
  // Bench just showed it.
  async function useCurrentBench() {
    const { assembly, importedParts } = bench;
    if (!assembly) return;
    const partsById = new Map([...catalogueById, ...importedParts]);
    const importedFiles = new Map();
    const scadSource = compileToScad(assembly, partsById, importedFiles);
    setBenchBusy(true);
    try {
      const buf = await renderPart({ scadSource, part: "all", importedFiles, globalOverrides });
      const name = benchName(assembly) ?? defaultBenchName(assembly, partsById);
      start({ kind: "mesh", name, stlBytes: buf, extents: meshExtents(buf) }, name);
    } catch (err) {
      setRenderError(`Couldn't render the bench: ${err.message}`);
    } finally {
      setBenchBusy(false);
    }
  }

  function changeBase() {
    if (doc.holes.length && !window.confirm(`Pick another model? The ${doc.holes.length} hole${doc.holes.length === 1 ? "" : "s"} on this one will be dropped.`)) return;
    setDoc(null);
    setSelectedId(null);
  }

  // --- placing -------------------------------------------------------
  // The face under a hit and the snap point it would take: the analysed
  // face (cached per face after the first look), then the nearest of
  // its snap points within reach — none with snapping off or Alt held.
  function resolveHit(hit) {
    if (!geometries) return null;
    const face = analyzeFace(geometries.topo, hit.faceIndex, { inset });
    facesRef.current.set(face.key, face);
    const snap = snapOn && !hit.altKey ? nearestCandidate(face, hit.point, snapRadius) : null;
    return { face, snap };
  }

  function onSurfaceHover(hit) {
    if (!hit) {
      setHover(null);
      return;
    }
    const resolved = resolveHit(hit);
    if (!resolved) return;
    const next = { faceKey: resolved.face.key, snapId: resolved.snap?.id ?? null };
    setHover((prev) => (prev && prev.faceKey === next.faceKey && prev.snapId === next.snapId ? prev : next));
  }

  function onSurfaceHit(hit) {
    const resolved = resolveHit(hit);
    if (!resolved) return;
    const { face, snap } = resolved;
    const free = !snapOn || hit.altKey;
    const point = snap ? snap.point : free ? planePoint(face, hit.point) : gridPoint(face, hit.point);
    placeAt(point, face.normal);
  }

  // A spot that already has a hole selects it; anywhere else drills a
  // new one with the "new holes" spec and selects that.
  function placeAt(point, normal) {
    const existing = doc.holes.find((h) => distance(h.point, point) < Math.max(1, Math.max(h.spec.diameter, h.spec.headDiameter) / 2));
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    const { doc: next, hole } = addHole(doc, { point, normal });
    setDoc(next);
    setSelectedId(hole.id);
  }

  function onMarkerClick(id) {
    if (id.startsWith("hole:")) {
      setSelectedId(id.slice("hole:".length));
      return;
    }
    if (id.startsWith("snap:")) {
      const candidateId = id.slice("snap:".length);
      const face = facesRef.current.get(Number(candidateId.split(":")[0]));
      const candidate = face?.candidates.find((c) => c.id === candidateId);
      if (candidate) placeAt(candidate.point, face.normal);
    }
  }

  function deleteHole(id) {
    setDoc((d) => removeHole(d, id));
    setSelectedId((s) => (s === id ? null : s));
  }

  // --- the editor's target: the selected hole, else the next one ------
  const selected = doc && selectedId ? getHole(doc, selectedId) : null;
  const editingSpec = selected ? selected.spec : doc?.nextSpec;
  const editingPresetId = selected ? selected.presetId : doc?.nextPresetId;
  function applySpec(spec, presetId = editingPresetId) {
    if (selected) setDoc((d) => updateHole(d, selected.id, { spec, presetId }));
    else setDoc((d) => setNextSpec(d, spec, presetId));
  }
  function applyPreset(preset) {
    applySpec({ ...preset.spec }, preset.id);
  }

  // --- export --------------------------------------------------------
  const exportName = doc ? doc.name?.trim() || sourceStem(doc.source, catalogueById) : "";

  async function downloadStl() {
    try {
      const base = await baseBuffer(doc.source, catalogueById, globalOverrides);
      const buf = doc.holes.length ? await renderPart(holedRequest(doc, catalogueById, meshExtents(base), globalOverrides)) : base;
      downloadBlob(buf, exportFilename(exportName, "holes", ".stl"), "model/stl");
    } catch (err) {
      setRenderError(err.message);
    }
  }

  function downloadScad() {
    const throughLength = baseExtents ? Math.hypot(...baseExtents) + 2 : undefined;
    downloadBlob(holesToScad(doc, catalogueById, { throughLength }), exportFilename(exportName, "holes", ".scad"), "text/plain");
  }

  // --- markers -------------------------------------------------------
  const markers = useMemo(() => {
    if (!doc) return [];
    const out = doc.holes.map((h) => ({
      id: `hole:${h.id}`,
      shape: "ring",
      x: h.point[0],
      y: h.point[1],
      z: h.point[2],
      normal: h.normal,
      radius: Math.max(h.spec.diameter, h.spec.headDiameter) / 2 + 0.5,
      color: h.id === selectedId ? SELECTED_COLOR : HOLE_COLOR,
    }));
    const face = hover ? facesRef.current.get(hover.faceKey) : null;
    for (const c of face?.candidates ?? []) {
      const active = c.id === hover.snapId;
      out.push({
        id: `snap:${c.id}`,
        x: c.point[0],
        y: c.point[1],
        z: c.point[2],
        radius: active ? snapDot * 1.7 : snapDot,
        color: active ? SELECTED_COLOR : SNAP_COLORS[c.kind] ?? SNAP_COLORS.quarter,
      });
    }
    return out;
  }, [doc, selectedId, hover, snapDot]);

  const hoveredSnap = hover?.snapId ? facesRef.current.get(hover.faceKey)?.candidates.find((c) => c.id === hover.snapId) : null;

  // --- start screen --------------------------------------------------
  if (!doc) {
    const benchReady = Boolean(bench.assembly);
    return (
      <main className="bench-empty holes-empty">
        <h2>Drill screw holes</h2>
        <p className="muted">
          Pick a model to put screw holes into — a catalogue part, a mesh of your own, or the bench as it stands.
          Then click its faces: a hole snaps to the face's center, the center of each quadrant, holes already in
          it, and a set-in point at each corner.
        </p>
        {renderError && (
          <p className="error-text bench-config-error" role="alert">
            {renderError}
          </p>
        )}
        <div className="bench-part-list">
          <PartBrowser
            parts={parts}
            onPick={(part) => pickCataloguePart(part)}
            autoFocus
            toolbar={
              <div className="holes-start-toolbar">
                <button className="render-button bench-import-button" onClick={() => setImportOpen(true)}>
                  Import STL / STEP / 3MF…
                </button>
                {librarySelection && (
                  <button
                    className="render-button bench-import-button"
                    onClick={() => pickCataloguePart(librarySelection.part, librarySelection.params)}
                    title="The part the Library tab is showing, with its current parameters"
                  >
                    Library's part: {librarySelection.part.name}
                  </button>
                )}
                {benchReady && (
                  <button
                    className="render-button bench-import-button"
                    onClick={useCurrentBench}
                    disabled={benchBusy}
                    title="The whole bench, rendered as one mesh"
                  >
                    {benchBusy ? "Rendering the bench…" : "Use the current bench"}
                  </button>
                )}
              </div>
            }
          />
        </div>
        {importOpen && <ImportFlow mode="mesh" onCancel={() => setImportOpen(false)} onConfirm={useImportedMesh} />}
      </main>
    );
  }

  const label = sourceLabel(doc.source, catalogueById);
  const cataloguePart = doc.source.kind === "catalogue" ? catalogueById.get(doc.source.partId) : null;
  const selectedPreset = selected ? getPreset(selected.presetId) : null;

  return (
    <div className={sidebarCollapsed ? "bench holes sidebar-collapsed" : "bench holes"}>
      <aside className="sidebar bench-sidebar holes-sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && (
          <>
            <h2>{label}</h2>
            <p className="muted">
              {doc.source.kind === "catalogue" ? "Catalogue part." : "Imported mesh."} Click a face in the scene to drill
              a hole.
            </p>
            <label className="field bench-name-field" title="What the exports are called — <name>_holes.stl and <name>_holes.scad">
              <span className="field-label">Name</span>
              <input
                type="text"
                placeholder={sourceStem(doc.source, catalogueById)}
                value={doc.name ?? ""}
                onChange={(e) => setDoc((d) => setDocName(d, e.target.value))}
              />
            </label>
            <button className="render-button bench-reset" onClick={changeBase}>
              Pick another model
            </button>

            <details className="bench-node-params-details">
              <summary>Part parameters</summary>
              {cataloguePart ? (
                <>
                  <ParamsEditor
                    className="bench-node-params"
                    part={cataloguePart}
                    params={doc.source.params}
                    onChange={(params) => setDoc((d) => ({ ...d, source: { ...d.source, params } }))}
                    emptyText="This part has no parameters."
                  />
                  {doc.holes.length > 0 && (
                    <p className="muted holes-params-note">
                      Holes stay where they are in the part's coordinates; a change that moves a face moves it out
                      from under them.
                    </p>
                  )}
                </>
              ) : (
                <p className="muted holes-params-note">
                  An imported mesh has no parameters — change it in the file it came from, or in the Bench if it is
                  the bench.
                </p>
              )}
            </details>

            <h3>Snapping</h3>
            <label className="field field-checkbox bench-crop-field" title="Clicks land on the face center, quadrant centers, existing holes and corner insets when one is within reach. Alt-click places freely.">
              <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
              <span className="field-label">Snap to face features</span>
            </label>
            <label className="field bench-offset-field holes-inset-field" title="How far in from each edge the corner snap points sit">
              <span className="field-label">Corner inset (mm)</span>
              <input type="number" min="0" step="0.5" value={inset} onChange={(e) => setInset(Math.max(0, Number(e.target.value) || 0))} />
            </label>

            <h3>{selected ? `Hole ${doc.holes.indexOf(selected) + 1}` : "New holes"}</h3>
            {selected ? (
              <p className="muted holes-editor-note">
                {selectedPreset ? selectedPreset.name : "Custom"}
                {selectedPreset && !specMatchesPreset(selected.spec, selected.presetId) ? " (edited)" : ""} at [
                {formatPoint(selected.point)}]. Changes apply to this hole only.
              </p>
            ) : (
              <p className="muted holes-editor-note">The screw every new hole is made for. Select a hole to change just that one.</p>
            )}
            <PresetPicker value={editingPresetId} onPick={applyPreset} />
            <HoleSpecFields spec={editingSpec} onChange={(spec) => applySpec(spec)} />
            {selected && (
              <div className="holes-selected-actions">
                <button
                  type="button"
                  className="render-button holes-small-button"
                  onClick={() => setDoc((d) => setNextSpec(d, selected.spec, selected.presetId))}
                  title="Make this hole's screw the one new holes get"
                >
                  Use for new holes
                </button>
                <button type="button" className="render-button holes-small-button holes-delete-button" onClick={() => deleteHole(selected.id)}>
                  Delete hole
                </button>
              </div>
            )}

            <h3>Holes ({doc.holes.length})</h3>
            {doc.holes.length === 0 && <p className="muted">None yet — click a face in the scene.</p>}
            <ul className="holes-list">
              {doc.holes.map((h, i) => {
                const preset = getPreset(h.presetId);
                return (
                  <li key={h.id} className={h.id === selectedId ? "holes-row is-selected" : "holes-row"}>
                    <button
                      type="button"
                      className="holes-row-main"
                      aria-pressed={h.id === selectedId}
                      onClick={() => setSelectedId(h.id === selectedId ? null : h.id)}
                      title={holeLabel(h)}
                    >
                      <ScrewIcon spec={h.spec} screw={preset?.screw ?? null} className="screw-icon-small" />
                      <span className="holes-row-text">
                        <span className="holes-row-title">
                          {i + 1}. {preset ? preset.name : holeLabel(h)}
                          {preset && !specMatchesPreset(h.spec, h.presetId) ? " (edited)" : ""}
                        </span>
                        <span className="muted holes-row-meta">
                          {h.spec.depth > 0 ? `${h.spec.depth} mm deep` : "through"} · [{formatPoint(h.point)}]
                        </span>
                      </span>
                    </button>
                    <button type="button" className="bench-remove" aria-label={`Remove hole ${i + 1}`} title="Remove this hole" onClick={() => deleteHole(h.id)}>
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>

            <h3>Export</h3>
            <div className="bench-export">
              <button className="download-button bench-export-button" onClick={downloadStl} disabled={status === "error"}>
                Download STL
              </button>
              <button className="download-button bench-export-button" onClick={downloadScad} title="The base and the holes as OpenSCAD source">
                Download .scad
              </button>
            </div>
          </>
        )}
      </aside>

      <main className="workspace">
        <header className="part-header">
          <div>
            <h2>Holes</h2>
            {dimensions && (
              <p className="outside-dimensions" aria-label={`Outside dimensions: width ${dimensions.width} millimetres, height ${dimensions.height} millimetres, depth ${dimensions.depth} millimetres`}>
                Outside: W {dimensions.width} × H {dimensions.height} × D {dimensions.depth} mm
              </p>
            )}
            {/* Fixed at two lines (styles.css .holes-note): a hint that
                changed height here would resize the viewer under the
                pointer and make the model jump. The snap-point hint is a
                chip over the viewer for the same reason. */}
            <p className="print-note holes-note" aria-live="polite">
              {selected ? (
                <>
                  Hole {doc.holes.indexOf(selected) + 1} selected — edit it in the sidebar; Delete removes it, Esc deselects.
                </>
              ) : (
                <>
                  {doc.holes.length === 0 ? `Click a face of ${label} to drill a hole there.` : `${doc.holes.length} hole${doc.holes.length === 1 ? "" : "s"} on ${label}.`}{" "}
                  Hover a flat face to see its snap points; Alt-click places exactly where you click.
                </>
              )}
              {status === "rendering" && " Rendering…"}
            </p>
          </div>
        </header>
        <div className="viewer-panel bench-viewer">
          {hoveredSnap && (
            <div className="holes-snap-hint" aria-hidden="true">
              Snap: {hoveredSnap.label}
            </div>
          )}
          {geometries ? (
            <StlViewer
              geometry={geometries.display}
              markers={markers}
              onMarkerClick={onMarkerClick}
              placingMode
              onSurfaceHit={onSurfaceHit}
              onSurfaceHover={onSurfaceHover}
              overlayAnchor={selected ? selected.point : null}
            >
              {selected && (
                <div className="bench-rotate-panel holes-pill">
                  <span className="bench-rotate-name">
                    Hole {doc.holes.indexOf(selected) + 1}
                    <span className="muted"> · {selectedPreset ? selectedPreset.name : holeLabel(selected)}</span>
                  </span>
                  <button
                    type="button"
                    className="bench-rotate-delete"
                    onClick={() => deleteHole(selected.id)}
                    aria-label={`Remove hole ${doc.holes.indexOf(selected) + 1}`}
                    title="Remove (Delete)"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                      <path
                        fill="currentColor"
                        d="M6 1.5h4a1 1 0 0 1 1 1V3h3v1.5h-1.1l-.7 9.1A1.5 1.5 0 0 1 10.7 15H5.3a1.5 1.5 0 0 1-1.5-1.4L3.1 4.5H2V3h3v-.5a1 1 0 0 1 1-1Zm.5 1.5h3v-.5h-3V3Zm-1.9 1.5.7 9h5.4l.7-9H4.6Zm1.7 1.5h1.2v6H6.3v-6Zm2.2 0h1.2v6H8.5v-6Z"
                      />
                    </svg>
                  </button>
                  <button type="button" className="bench-rotate-close" onClick={() => setSelectedId(null)} aria-label="Deselect" title="Deselect (Esc)">
                    ✕
                  </button>
                </div>
              )}
            </StlViewer>
          ) : (
            <div className="viewer-placeholder" role="status">
              {status === "rendering" ? "Rendering…" : "No preview yet."}
            </div>
          )}
          {renderError && (
            <p className="error-text bench-error" role="alert">
              {renderError}
            </p>
          )}
          {renderError && status !== "rendering" && (
            <button className="render-button" onClick={() => setRenderRetry((n) => n + 1)}>
              Retry preview
            </button>
          )}
        </div>
      </main>

      {importOpen && <ImportFlow mode="mesh" onCancel={() => setImportOpen(false)} onConfirm={useImportedMesh} />}
    </div>
  );
}

// "[12.0, -3.5, 4.0]" — a hole's position for the sidebar, with -0 shown
// as 0 (a snapped coordinate can come out as a negative zero).
function formatPoint(point) {
  return point.map((n) => (Math.round(n * 10) / 10 || 0).toFixed(1)).join(", ");
}

// The base model's STL: a catalogue part rendered on its own (cached
// by openscad-client), or a mesh source's own bytes.
function baseBuffer(source, catalogueById, globalOverrides, signal) {
  if (source.kind === "mesh") return Promise.resolve(source.stlBytes);
  const part = catalogueById.get(source.partId);
  if (!part) return Promise.reject(new Error(`Unknown catalogue part ${source.partId}`));
  return renderPart({ scadFile: part.file, module: part.module, params: source.params, globalOverrides }, { signal });
}

function holedRequest(doc, catalogueById, extents, globalOverrides) {
  const importedFiles = new Map();
  const scadSource = holesToScad(doc, catalogueById, { throughLength: Math.hypot(...extents) + 2, importedFiles });
  return { scadSource, importedFiles, globalOverrides };
}

// For the cache probe before debouncing: without the base's extents the
// request can't be formed yet, and an impossible one is never cached.
function holedRequestIfKnown(doc, catalogueById, extents, globalOverrides) {
  if (!extents) return { scadSource: "\0unknown" };
  try {
    return holedRequest(doc, catalogueById, extents, globalOverrides);
  } catch {
    return { scadSource: "\0unknown" };
  }
}
