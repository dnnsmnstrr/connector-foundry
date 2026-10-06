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
import SidebarResizer from "./components/SidebarResizer.jsx";
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
  flipHoles,
  getHole,
  holeFootprintRadius,
  holeLabel,
  holeMeta,
  holesToScad,
  removeHole,
  setDocName,
  setNextSpec,
  slotOutline,
  sourceLabel,
  sourceStem,
  updateHole,
} from "./lib/screwHoles.js";
import { getPreset, specMatchesPreset } from "./lib/screwPresets.js";
import { DEFAULT_CENTER_RADIUS_MM, DEFAULT_CORNER_INSET_MM, analyzeFace, edgeDistances, gridPoint, nearestCandidate, nearestGuide, planePoint } from "./lib/snapCandidates.js";
import { resolveParams } from "./lib/userOverrides.js";

// Debounce between the last hole edit and the re-render it triggers, so
// typing a diameter doesn't compile once per keystroke.
const RENDER_DEBOUNCE_MS = 250;
// Marker colours: holes in the imported-badge blue, the selected one and
// the snap point about to be used in the selection yellow, the rest of
// a face's snap points by kind.
const HOLE_COLOR = 0x7fa8e0;
const SELECTED_COLOR = 0xffd23f;
const SNAP_COLORS = { hole: 0x7fa8e0, center: 0x2ecc71, quarter: 0xd8d9db, corner: 0xd8d9db, intersection: 0x9a9ba0, circle: 0xe0c07f };
// Guide lines on the hovered face: center lines solid, quarter lines
// dashed, radials dashed and dim, the center circle in the circle
// points' colour.
const GUIDE_CENTER_COLOR = 0x9db4e8;
const GUIDE_QUARTER_COLOR = 0x6b7390;
const GUIDE_RADIAL_COLOR = 0x6b7390;
const GUIDE_CIRCLE_COLOR = 0xb39a50;
// Measurement lines (Option held): bright, over the guides.
const MEASURE_COLOR = 0xf0f0f0;
const MEASURE_LIFT_MM = 0.1;
// Lifted off the face so the lines don't z-fight it.
const GUIDE_LIFT_MM = 0.06;
// How long the pointer has to rest on another face before the guide
// lines move there — long enough that a face crossed on the way to the
// sidebar doesn't take them with it.
const GUIDE_SWITCH_DELAY_MS = 350;

// Holes mode: take a model — a catalogue part with its parameters, a
// mesh brought in as STL/STEP/3MF, or the current bench as one mesh — and
// drill screw holes into it by clicking its faces. A click snaps to the
// significant points of the flat face under it (lib/snapCandidates.js):
// its center, the center of each quadrant, the centers of holes already
// through it, and a point set in from each corner. Each hole
// has a diameter, a depth (or goes through), and a head pocket —
// counterbore, countersink or hex — from a preset (lib/screwPresets.js)
// or typed in; or it is a connector slot (openConnect, MultiConnect)
// cut by the repo's own libraries, with a direction on its face. The
// result is rendered as `difference() { base; holes }`
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
  const [radius, setRadius] = useState(DEFAULT_CENTER_RADIUS_MM);
  // The face under the pointer and the snap that would be used: the
  // snap point's id, or — near a guide line but no point — the spot on
  // the line, as { faceKey, snapId, linePoint, lineLabel }. Compared by
  // value, so a pointer moving across one face only re-renders when the
  // snap changes (the line spot moves in grid steps).
  const [hover, setHover] = useState(null);
  // The face whose guide lines and snap points are showing: the last
  // face the pointer rested on, kept after it leaves the model so the
  // inset and radius can be adjusted with the lines in view. Another
  // face takes over only after GUIDE_SWITCH_DELAY_MS under the pointer
  // (`pendingGuide` is that timer), or at once on a click. Cleared with
  // the mesh (a re-render renumbers the triangles).
  const [guideFaceKey, setGuideFaceKey] = useState(null);
  const pendingGuide = useRef(null); // { key, timer } | null
  // Option held: the point under the pointer (or the selected hole) gets
  // its distances to the face's edges and center drawn and labelled.
  // `hoverPoint` is the latest resolved hover point, kept in a ref so
  // moving the pointer costs no render until Option is down.
  const [altHeld, setAltHeld] = useState(false);
  const [measurePoint, setMeasurePoint] = useState(null);
  const hoverPoint = useRef(null);
  const [stlBuffer, setStlBuffer] = useState(null);
  const [baseExtents, setBaseExtents] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const [renderRetry, setRenderRetry] = useState(0);
  const [benchBusy, setBenchBusy] = useState(false);
  const renderSeq = useRef(0);

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
    return { display, topo };
  }, [stlBuffer]);
  useEffect(
    () => () => {
      geometries?.display.dispose();
      geometries?.topo.dispose();
    },
    [geometries],
  );
  useEffect(() => {
    setHover(null);
    setGuideFaceKey(null);
    cancelPendingGuide();
  }, [geometries]);
  useEffect(() => cancelPendingGuide, []);

  function cancelPendingGuide() {
    if (pendingGuide.current) clearTimeout(pendingGuide.current.timer);
    pendingGuide.current = null;
  }

  // The guide face follows the pointer to `key` — at once when there is
  // none yet or when `now` (a click), otherwise after the dwell.
  function proposeGuideFace(key, now = false) {
    if (key === guideFaceKey) {
      cancelPendingGuide();
      return;
    }
    if (now || guideFaceKey === null) {
      cancelPendingGuide();
      setGuideFaceKey(key);
      return;
    }
    if (pendingGuide.current?.key === key) return;
    cancelPendingGuide();
    pendingGuide.current = {
      key,
      timer: setTimeout(() => {
        pendingGuide.current = null;
        setGuideFaceKey(key);
      }, GUIDE_SWITCH_DELAY_MS),
    };
  }

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

  // Option (Alt) held → measurements. Tracked on the window so it works
  // with the pointer anywhere; released on blur too, since the keyup
  // goes elsewhere when the key is used to switch apps.
  useEffect(() => {
    const down = (e) => {
      if (e.key === "Alt" && !e.repeat) {
        setAltHeld(true);
        setMeasurePoint(hoverPoint.current);
      }
    };
    const up = (e) => {
      if (e.key === "Alt") setAltHeld(false);
    };
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
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
    start(meshSource(part.name, part.geometry, false));
    setImportOpen(false);
  }

  // Turn a mesh source over (or back). The holes go with it, so they
  // stay on the spots they were placed on.
  function setFlip(flip) {
    setDoc((d) => {
      if (!d || d.source.kind !== "mesh" || Boolean(d.source.flip) === flip) return d;
      const source = meshSource(d.source.name, d.source.geometry, flip);
      return { ...flipHoles(d, d.source.extents[2]), source };
    });
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
      start(meshSource(name, new STLLoader().parse(buf), false), name);
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
  // The face under a hit, the snap it would take and the point a click
  // would drill: the analysed face (cached per face after the first
  // look), then the nearest of its snap points within reach, else the
  // nearest guide line within reach (the hit slid onto it) — neither
  // with snapping off or Shift held — else the hit rounded to the grid
  // (or exactly as it is, with Shift or snapping off).
  function resolveHit(hit) {
    if (!geometries) return null;
    const face = analyzeFace(geometries.topo, hit.faceIndex, { inset, radius });
    const snapping = snapOn && !hit.shiftKey;
    const snap = snapping ? nearestCandidate(face, hit.point, snapRadius) : null;
    const line = snapping && !snap ? nearestGuide(face, hit.point, snapRadius) : null;
    const point = snap ? snap.point : line ? line.point : snapping ? gridPoint(face, hit.point) : planePoint(face, hit.point);
    return { face, snap, line, point };
  }

  function onSurfaceHover(hit) {
    if (!hit) {
      cancelPendingGuide();
      hoverPoint.current = null;
      setHover(null);
      if (altHeld) setMeasurePoint(null);
      return;
    }
    const resolved = resolveHit(hit);
    if (!resolved) return;
    hoverPoint.current = resolved.point;
    if (altHeld) setMeasurePoint((prev) => (prev && prev.every((n, i) => n === resolved.point[i]) ? prev : resolved.point));
    proposeGuideFace(resolved.face.key);
    const next = {
      faceKey: resolved.face.key,
      snapId: resolved.snap?.id ?? null,
      snapLabel: resolved.snap?.label ?? null,
      linePoint: resolved.line?.point ?? null,
      lineLabel: resolved.line?.label ?? null,
    };
    setHover((prev) => (sameHover(prev, next) ? prev : next));
  }

  function onSurfaceHit(hit) {
    const resolved = resolveHit(hit);
    if (!resolved) return;
    proposeGuideFace(resolved.face.key, true);
    placeAt(resolved.point, resolved.face.normal);
  }

  // A spot that already has a hole selects it; anywhere else drills a
  // new one with the "new holes" spec and selects that.
  function placeAt(point, normal) {
    const existing = doc.holes.find((h) => distance(h.point, point) < Math.max(1, holeFootprintRadius(h.spec)));
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
      // The snap markers shown are always the guide face's.
      const candidate = guideFace?.candidates.find((c) => `snap:${c.id}` === id);
      if (candidate) placeAt(candidate.point, guideFace.normal);
    }
  }

  function deleteHole(id) {
    setDoc((d) => removeHole(d, id));
    setSelectedId((s) => (s === id ? null : s));
  }

  // --- the editor's target: the selected hole, else the next one ------
  // Whatever screw was picked or typed last — for a selected hole or in
  // the "New holes" editor — is what the next click drills, so a run of
  // holes of one kind doesn't need the type re-picked each time.
  const selected = doc && selectedId ? getHole(doc, selectedId) : null;
  const editingSpec = selected ? selected.spec : doc?.nextSpec;
  const editingPresetId = selected ? selected.presetId : doc?.nextPresetId;
  function applySpec(spec, presetId = editingPresetId) {
    setDoc((d) => setNextSpec(selected ? updateHole(d, selected.id, { spec, presetId }) : d, spec, presetId));
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
  // The guide face, analysed with the current inset and radius — so a
  // change to either redraws its lines and points at once, hovering or
  // not. (analyzeFace() refreshes the cached face in place.)
  const guideFace = useMemo(() => {
    if (guideFaceKey === null || !geometries) return null;
    return analyzeFace(geometries.topo, guideFaceKey, { inset, radius });
  }, [guideFaceKey, geometries, inset, radius]);

  const markers = useMemo(() => {
    if (!doc) return [];
    const out = doc.holes.map((h) => ({
      id: `hole:${h.id}`,
      shape: "ring",
      x: h.point[0],
      y: h.point[1],
      z: h.point[2],
      normal: h.normal,
      radius: holeFootprintRadius(h.spec) + 0.5,
      color: h.id === selectedId ? SELECTED_COLOR : HOLE_COLOR,
    }));
    // The spot on a guide line the click would take: a marker that
    // follows the pointer along the line.
    if (hover?.linePoint) {
      out.push({
        id: "snap:line",
        x: hover.linePoint[0],
        y: hover.linePoint[1],
        z: hover.linePoint[2],
        radius: snapDot * 1.4,
        color: SELECTED_COLOR,
        // Display only: it sits under the pointer, and a click there
        // goes to the face and resolves to this same point.
        hitTest: false,
      });
    }
    const hovering = hover && guideFace && hover.faceKey === guideFace.key;
    for (const c of (snapOn && guideFace?.candidates) || []) {
      const active = hovering && c.id === hover.snapId;
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
  }, [doc, selectedId, hover, guideFace, snapOn, snapDot]);

  // The lines across the hovered face (nothing while a hole is being
  // dragged across it in the viewer — there is no such thing yet, so:
  // whenever a face is hovered with snapping on), and every connector
  // slot's outline on its own face — its channel, its entry (dashed)
  // and an arrow the way the head travels to seat, since a ring says
  // nothing about which way a slot points. Each piece is lifted off
  // its face along the normal.
  const guides = useMemo(() => {
    const segments = [];
    const lifted = (p, normal) => [p[0] + normal[0] * GUIDE_LIFT_MM, p[1] + normal[1] * GUIDE_LIFT_MM, p[2] + normal[2] * GUIDE_LIFT_MM];
    for (const h of doc?.holes ?? []) {
      const color = h.id === selectedId ? SELECTED_COLOR : HOLE_COLOR;
      for (const seg of slotOutline(h)) segments.push({ a: lifted(seg.a, h.normal), b: lifted(seg.b, h.normal), color, dashed: seg.dashed });
    }
    const face = snapOn ? guideFace : null;
    if (!face) return segments;
    const lift = (p) => lifted(p, face.normal);
    for (const g of face.guides) {
      if (g.kind === "circle") {
        // The circle as a chain of short segments.
        for (let i = 0; i + 1 < g.points.length; i++) {
          segments.push({ a: lift(g.points[i]), b: lift(g.points[i + 1]), color: GUIDE_CIRCLE_COLOR, dashed: false });
        }
        continue;
      }
      const color = g.kind === "center" ? GUIDE_CENTER_COLOR : g.kind === "radial" ? GUIDE_RADIAL_COLOR : GUIDE_QUARTER_COLOR;
      segments.push({ a: lift(g.a), b: lift(g.b), color, dashed: g.kind !== "center" });
    }
    return segments;
  }, [guideFace, snapOn, doc?.holes, selectedId]);

  const hoveredSnap = hover?.snapId ? { label: hover.snapLabel } : hover?.linePoint ? { label: hover.lineLabel, point: hover.linePoint } : null;

  // With Option held: the hovered point's (else the selected hole's, if
  // it lies on the guide face) distances to the guide face's edges and
  // center as dimension lines and labels, plus the face's size.
  const measurements = useMemo(() => {
    const none = { guides: [], labels: [] };
    if (!altHeld || !guideFace) return none;
    const face = guideFace;
    const onPlane = (p) => Math.abs((p[0] - face.center[0]) * face.normal[0] + (p[1] - face.center[1]) * face.normal[1] + (p[2] - face.center[2]) * face.normal[2]) < 0.05;
    const point = measurePoint ?? (selected && onPlane(selected.point) ? selected.point : null);
    const lift = (p) => [p[0] + face.normal[0] * MEASURE_LIFT_MM, p[1] + face.normal[1] * MEASURE_LIFT_MM, p[2] + face.normal[2] * MEASURE_LIFT_MM];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const mm = (n) => `${n.toFixed(1)} mm`;
    const guides = [];
    const labels = [];
    const [w, h] = face.extent;
    // The face's size at a corner of its bounding box, out of the way of
    // the lines through the point.
    const corner = face.center.map((c, i) => c + (face.u[i] * w) / 2 + (face.v[i] * h) / 2);
    labels.push({ id: "size", point: lift(corner), text: `${mm(w).slice(0, -3)} × ${mm(h)}` });
    if (!point || !onPlane(point)) return { guides, labels };
    const d = edgeDistances(face, point);
    if (!d) return { guides, labels };
    for (const side of ["left", "right", "down", "up"]) {
      if (d[side] < 0.05) continue;
      guides.push({ a: lift(point), b: lift(d.ends[side]), color: MEASURE_COLOR, dashed: false });
      labels.push({ id: side, point: lift(mid(point, d.ends[side])), text: mm(d[side]) });
    }
    if (d.toCenter > 0.05) {
      guides.push({ a: lift(point), b: lift(face.center), color: MEASURE_COLOR, dashed: true });
      labels.push({ id: "center", point: lift(mid(point, face.center)), text: `${mm(d.toCenter)} to center` });
    }
    return { guides, labels };
  }, [altHeld, guideFace, measurePoint, selected]);

  // --- start screen --------------------------------------------------
  if (!doc) {
    const benchReady = Boolean(bench.assembly);
    return (
      <main className="bench-empty holes-empty">
        <h2>Drill screw holes</h2>
        <p className="muted">
          Pick a model to put screw holes into — a catalogue part, a mesh of your own, or the bench as it stands.
          Then click its faces: a hole snaps to the face's center, the center of each quadrant, holes already in
          it, a set-in point at each corner, and the guide lines drawn across it — center and quarter lines, a
          radial to each corner, and a circle of the radius you choose.
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
                <>
                  <label
                    className="field field-checkbox bench-crop-field"
                    title="Turn the mesh over (a half turn about X) so the other side faces up — for a file saved the way it prints rather than the way it is used. Holes already placed go with it."
                  >
                    <input type="checkbox" checked={Boolean(doc.source.flip)} onChange={(e) => setFlip(e.target.checked)} />
                    <span className="field-label">Flip upside down</span>
                  </label>
                  <p className="muted holes-params-note">
                    A mesh has no other parameters — change it in the file it came from, or in the Bench if it is
                    the bench.
                  </p>
                </>
              )}
            </details>

            <h3>Snapping</h3>
            <label className="field field-checkbox bench-crop-field" title="Clicks land on the face center, quadrant centers, existing holes, corner insets and the guide lines when one is within reach. Shift-click places freely.">
              <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
              <span className="field-label">Snap to face features and guide lines</span>
            </label>
            <label className="field bench-offset-field holes-inset-field" title="How far in from each edge the corner snap points sit; a radial line runs from the face center through each of them">
              <span className="field-label">Corner inset (mm)</span>
              <input type="number" min="0" step="0.5" value={inset} onChange={(e) => setInset(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <p className="muted holes-params-note">
              Hold <kbd className="holes-key">⌥ Option</kbd> to see the pointed-at spot's distances to the face's edges and
              center.
            </p>
            <label className="field bench-offset-field holes-inset-field" title="A circle of this radius around the face center — a bolt circle. Snap points where it crosses the center lines and the radials; a click near it lands on it. 0 draws none.">
              <span className="field-label">Center radius (mm)</span>
              <input type="number" min="0" step="0.5" value={radius} onChange={(e) => setRadius(Math.max(0, Number(e.target.value) || 0))} />
            </label>

            <h3>{selected ? `Hole ${doc.holes.indexOf(selected) + 1}` : "New holes"}</h3>
            {selected ? (
              <p className="muted holes-editor-note">
                {selectedPreset ? selectedPreset.name : "Custom"}
                {selectedPreset && !specMatchesPreset(selected.spec, selected.presetId) ? " (edited)" : ""} at [
                {formatPoint(selected.point)}]. Changes apply to this hole, and to the holes you place next.
              </p>
            ) : (
              <p className="muted holes-editor-note">
                The screw — or connector slot — every new hole is made for: the one picked or edited last. Select a hole to
                change it.
              </p>
            )}
            <PresetPicker value={editingPresetId} onPick={applyPreset} />
            <HoleSpecFields spec={editingSpec} onChange={(spec) => applySpec(spec)} />
            {selected && (
              <div className="holes-selected-actions">
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
                          {holeMeta(h)} · [{formatPoint(h.point)}]
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
      {!sidebarCollapsed && <SidebarResizer />}

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
                  Hover a face for snap points and guides; hold Option for distances; Shift-click places freely.
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
              guides={measurements.guides.length ? [...guides, ...measurements.guides] : guides}
              labels={measurements.labels}
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

// A mesh source from its validated geometry: grounded on the grid, and
// turned over first when `flip` is set (importedPart.js's groundedMesh()).
function meshSource(name, geometry, flip) {
  const { stlBytes, extents } = groundedMesh(geometry, { flip });
  return { kind: "mesh", name, geometry, flip, stlBytes, extents };
}

// Two hover records that would draw the same thing.
function sameHover(a, b) {
  if (!a || !b) return a === b;
  if (a.faceKey !== b.faceKey || a.snapId !== b.snapId) return false;
  if (!a.linePoint || !b.linePoint) return a.linePoint === b.linePoint;
  return a.linePoint.every((n, i) => n === b.linePoint[i]);
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
