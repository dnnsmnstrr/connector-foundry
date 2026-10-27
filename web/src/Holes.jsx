import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import ImportFlow from "./components/bench/ImportFlow.jsx";
import DecimalInput from "./components/DecimalInput.jsx";
import GridField from "./components/holes/GridField.jsx";
import HoleRow from "./components/holes/HoleRow.jsx";
import HoleSpecFields from "./components/holes/HoleSpecFields.jsx";
import PresetPicker from "./components/holes/PresetPicker.jsx";
import RepeatFields from "./components/holes/RepeatFields.jsx";
import ScrewIcon from "./components/holes/ScrewIcon.jsx";
import ParamsEditor from "./components/ParamsEditor.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import SidebarResizer from "./components/SidebarResizer.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import UndoRedoButtons from "./components/UndoRedoButtons.jsx";
import { useBenchSession } from "./hooks/useBenchSession.js";
import { useGlobalOverrides } from "./hooks/useGlobalOverrides.js";
import { useHolesHistory } from "./hooks/useHolesHistory.js";
import { useHolesSession } from "./hooks/useHolesSession.js";
import { useRender } from "./hooks/useRender.js";
import { useUndoShortcuts } from "./hooks/useUndoShortcuts.js";
import { useCommandDrop, useCommandHome, useCommands } from "./hooks/useCommands.js";
import { useWebMcpTab } from "./hooks/useWebMcp.js";
import { useFileDrop } from "./hooks/useFileDrop.js";
import { useHiddenLibrary } from "./hooks/useHiddenLibrary.js";
import { useSystemOrder } from "./hooks/useSystemOrder.js";
import { partSections } from "./lib/catalogueUtils.js";
import { benchName, compileToScad } from "./lib/assembly.js";
import { defaultBenchName, exportFilename } from "./lib/benchName.js";
import { builtin, partCommand } from "./lib/commandCatalog.js";
import PrintSheet from "./components/PrintSheet.jsx";
import { chordText } from "./lib/shortcuts.js";
import { downloadBlob } from "./lib/download.js";
import { LAYERLING_COPY_TITLE, useLayerlingCopy } from "./hooks/useLayerlingCopy.js";
import {
  NUDGE_OFF_MM,
  dragHoleResize,
  holeCross,
  holeHandles,
  holeMoveText,
  holeOutline,
  holePillAnchor,
  holeResizeText,
  moveHole,
  movedOnFace,
  nudgeHoles,
  oppositeSide,
  stepHoleSize,
  typedHoleSize,
} from "./lib/holeHandles.js";
import { getHolesSession, redoHoles, setHolesDoc, undoHoles } from "./lib/holesSession.js";
import { hasCoarsePointer, ignoresShortcut, isBehindOpenDialog } from "./lib/isEditableTarget.js";
import { meshExtents } from "./lib/meshExtents.js";
import { renderPart } from "./lib/openscad-client.js";
import {
  faceMeasurements,
  holeGuides,
  holeMarkers,
  onFacePlane,
  pitchMeasurements,
} from "./lib/holesOverlay.js";
import {
  baseBuffer,
  cachedHoled,
  meshSource,
  renderHoled,
  stlProbe,
  surfaceProbe,
} from "./lib/holesRender.js";
import { outsideDimensions } from "./lib/outsideDimensions.js";
import {
  addHole,
  createHolesDoc,
  flipHoles,
  formatPoint,
  holeAtSpot,
  holeFootprintRadius,
  holeLabel,
  holesToScad,
  patchHoles,
  REPEAT_DEFAULTS,
  removeHoles,
  repeatHole,
  rotateHoles,
  setDocName,
  setHolesSpec,
  setNextSpec,
  STANDARD_SPACINGS,
  getSpacing,
  sharedSpec,
  spacingLabel,
  sourceLabel,
  sourceStem,
  updateHole,
} from "./lib/screwHoles.js";
import {
  getPreset,
  presetGroups,
  presetSpacingId,
  presetSpecFor,
  specMatchesPreset,
} from "./lib/screwPresets.js";
import {
  DEFAULT_CENTER_RADIUS_MM,
  DEFAULT_CORNER_INSET_MM,
  analyzeFace,
  gridPoint,
  faceNear,
  nearestCandidate,
  nearestGuide,
  pitchCandidates,
  planePoint,
} from "./lib/snapCandidates.js";
import { getGridSnap } from "./lib/uiPrefs.js";
import { resolveParams } from "./lib/userOverrides.js";

// Debounce between the last hole edit and the re-render it triggers, so
// typing a diameter (or holding an arrow key) doesn't compile once per
// keystroke. A handle drag's commit, or a typed size, renders at once.
const RENDER_DEBOUNCE_MS = 250;
// How long the pointer has to rest on another face before the guide
// lines move there — long enough that a face crossed on the way to the
// sidebar doesn't take them with it.
const GUIDE_SWITCH_DELAY_MS = 350;
// How long a refused move or nudge says why, in the chip over the viewer.
const NOTICE_MS = 2500;
// The arrow keys' nudge directions: [across, up] along the hole's face.
/** @type {Record<string, number[]>} */
const ARROW_NUDGES = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
// No measurements (Option up and Measure off, or a handle being dragged):
// one object, so the viewer's labels and guides see the same arrays
// render after render.
const NO_MEASUREMENTS = { guides: [], labels: [] };
// How far a tap may land from a snap point and still take it, in screen
// pixels: a fingertip's reach, against the model-scaled snapRadius a
// mouse gets (see resolveHit()).
const TOUCH_SNAP_PX = 22;

/** @typedef {import("./components/StlViewer.jsx").SurfaceHit} SurfaceHit */

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
// The selected hole has TinkerCAD's handles in the viewer
// (lib/holeHandles.js): a rectangle's edges and corners and a round
// cutout's rim resize it from the opposite edge (Option: from the
// centre), the round one in the middle of any hole drags it across its
// face, and the arrow keys nudge the selection — each a ghost while it
// runs and one document change when it lands.
//
// The document lives in lib/holesSession.js so a trip to the Bench and
// back doesn't lose it, along with its undo history: every change to it
// is a step (Cmd/Ctrl+Z, the viewer's Undo and Redo), "Pick another
// model" too. Selection, hover and the viewer are local.
/**
 * @param {{
 *   parts: any[],
 *   sidebarCollapsed: boolean,
 *   onToggleSidebar: () => void,
 *   librarySelection: any,
 * }} props
 */
export default function Holes({ parts, sidebarCollapsed, onToggleSidebar, librarySelection }) {
  const globalOverrides = useGlobalOverrides();
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const session = useHolesSession();
  const { doc } = session;
  const setDoc = setHolesDoc;
  const bench = useBenchSession();

  const [importOpen, setImportOpen] = useState(false);
  // A model file the user already gave the import flow — dropped on the
  // start picker, the empty tab or the palette — which it reads as it opens.
  const [importFile, setImportFile] = useState(null);
  // The selected holes, by id, in the order they were picked: one by a
  // plain click, more with Shift-click (in the list, on a hole's ring,
  // or on a face spot that already has a hole).
  const [selectedIds, setSelectedIds] = useState([]);
  // The Repeat form: open or not, and its fields — kept while it is
  // closed, so a second pattern starts from the first one's numbers.
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatOptions, setRepeatOptions] = useState(REPEAT_DEFAULTS);
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
  // (`pendingGuide` is that timer), or at once on a click.
  //
  // A face is a triangle index, which only means anything in the mesh it
  // was taken from: a re-render (a hole drilled or deleted) renumbers the
  // triangles. So the key is stored with that mesh's topology and only
  // used while it is still the one on screen — checked here, in the same
  // render, not in an effect afterwards. (Clearing it in an effect left
  // one render with the new mesh and the old key; when the new mesh had
  // fewer triangles, the face lookup ran off its end and took the whole
  // tab down — deleting a hole that had been dropped inside another.)
  //
  // The guide also keeps a spot on its face (`anchor`, a point and the
  // face's normal) and the base it was taken on, so that a re-render of
  // the same base finds the face again (faceNear()) rather than dropping
  // it: a mouse would bring it back with the next hover, but a finger has
  // none, and on a phone the lines went with the first hole drilled.
  const [guide, setGuide] = useState(null); // { key, topo, anchor, source } | null
  const pendingGuide = useRef(null); // { key, timer } | null
  // Option held: the point under the pointer (or the selected hole) gets
  // its distances to the face's edges and center drawn and labelled.
  // `hoverPoint` is the latest resolved hover point, kept in a ref so
  // moving the pointer costs no render until Option is down.
  const [altHeld, setAltHeld] = useState(false);
  // The toolbar's Measure toggle (and the holes.measure command): the
  // same measurements as Option held, for a finger, which has no Option
  // key and no hover — they then follow the tapped spot or the selected
  // hole.
  const [measureOn, setMeasureOn] = useState(false);
  const measuring = altHeld || measureOn;
  const coarse = hasCoarsePointer();
  const [measurePoint, setMeasurePoint] = useState(null);
  // The system spacing Measure shows round the selected hole (an id of
  // STANDARD_SPACINGS, the Repeat form's too), or null for none: its next
  // holes as snap points.
  const [pitchId, setPitchId] = useState(null);
  const pitchSpacing = getSpacing(pitchId);
  const hoverPoint = useRef(null);
  const [benchBusy, setBenchBusy] = useState(false);
  // The last handle or move commit: the holes it set (the very array, so
  // any other change to them — an edit, an undo — no longer matches), the
  // document it made and the printer settings it rendered with, whether
  // it renders at once, and the ghost of what it asked for, shown until
  // that render lands (as the Library's handles do).
  const [pending, setPending] = useState(null);
  // A handle is being dragged: the Option-held measurements give way to
  // the drag's own label (Option is also the drag's "from the centre").
  const [handleDrag, setHandleDrag] = useState(false);
  // Why a move or nudge was refused ({ text }), for a moment.
  const [notice, setNotice] = useState(null);
  // Bumped whenever the base is replaced (start(), changeBase()) or the
  // tab unmounts, so a slow "Use the current bench" render that finishes
  // afterwards can tell it is no longer wanted.
  const baseRequest = useRef(0);
  useEffect(
    () => () => {
      ++baseRequest.current;
    },
    [],
  );

  // --- the mesh on screen ------------------------------------------------
  // The base alone when there are no holes (a catalogue part rendered
  // standalone — a cache hit if the Library just showed it — or the
  // imported bytes as they are), else the base with the holes cut, via
  // the generated source (lib/holesRender.js's renderHoled()). Only a
  // real compile is worth waiting out the debounce for.
  const source = doc?.source;
  const holes = doc?.holes;
  const renderKey = useMemo(
    () => (source ? { source, holes, catalogueById, globalOverrides } : null),
    [source, holes, catalogueById, globalOverrides],
  );
  // Whether a render is the last commit's: its holes on its base with its
  // settings. The holes alone would not do — a base-parameter edit or a
  // Settings change keeps the holes array, and its renders would lose
  // their debounce (each keystroke aborting the last, restarting the
  // worker) and bring the old ghost back.
  const isPendingRender = (key) =>
    !!pending &&
    !!key &&
    key.holes === pending.holes &&
    key.source === pending.doc.source &&
    key.globalOverrides === pending.globalOverrides;
  const preview = useRender(
    renderKey,
    (key, signal) => renderHoled(key, key.catalogueById, key.globalOverrides, signal),
    {
      // Everything already rendered (an undo, a hole put back where it
      // was) shows before the next paint, with no "rendering" between.
      cached: (key) => cachedHoled(key, key.catalogueById, key.globalOverrides),
      // A miss: the base alone (a part render, or none for a mesh) at
      // once; holes after the debounce, unless a handle just committed.
      delay: (key) =>
        key.holes.length === 0 || (pending?.immediate && isPendingRender(key)) ? 0 : RENDER_DEBOUNCE_MS,
    },
  );
  const stlBuffer = preview.result?.stl ?? null;
  const baseExtents = preview.result?.baseExtents ?? null;
  // The base without holes, for "is this spot on the model?" when a hole
  // moves (stlProbe(), built the first time it is asked): the mesh on
  // screen has the hole's own bore at its old spot, so a step shorter
  // than its radius would land in it and read as off the model.
  const baseStl = preview.result?.base ?? null;
  const { status, error: renderError, setError: setRenderError } = preview;
  // How the preview went, for the browser's AI agent (lib/webmcp.js).
  useWebMcpTab({ tab: "holes", preview: () => ({ status, error: renderError }) });

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
  // Is a spot on the rendered model, on a face turned like the hole's?
  // For the Repeat form: a pattern runs on the hole's face plane, which
  // the model may end, step, or have another hole in — so this one asks
  // the mesh on screen, holes and all (lib/holesRender.js).
  const repeatProbe = useMemo(() => (geometries ? surfaceProbe(geometries.display) : null), [geometries]);
  const shownSource = preview.key?.source;
  const guideFaceKey = useMemo(() => {
    if (!guide || !geometries) return null;
    if (guide.topo === geometries.topo) return guide.key;
    if (guide.source !== shownSource) return null;
    const t = faceNear(geometries.topo, guide.anchor.point, guide.anchor.normal);
    return t === null ? null : (analyzeFace(geometries.topo, t, { inset, radius })?.key ?? null);
  }, [guide, geometries, shownSource, inset, radius]);
  /**
   * @param {number} key
   * @param {{ point: number[], normal: number[] }} anchor a spot on the face
   */
  function setGuideFaceKey(key, anchor) {
    if (geometries) setGuide({ key, topo: geometries.topo, anchor, source: shownSource });
  }
  // The guide face moves to the face `hole` is on, at once: a hole picked
  // or dragged shows the lines to aim it by without a hover first.
  function guideToHole(hole) {
    if (!geometries || !meshIsCurrent) return;
    const t = faceNear(geometries.topo, hole.point, hole.normal);
    const face = t === null ? null : analyzeFace(geometries.topo, t, { inset, radius });
    if (!face) return;
    cancelPendingGuide();
    if (face.key !== guideFaceKey) setGuideFaceKey(face.key, { point: hole.point, normal: face.normal });
  }
  useEffect(() => {
    setHover(null);
    cancelPendingGuide();
  }, [geometries]);
  useEffect(() => cancelPendingGuide, []);

  function cancelPendingGuide() {
    if (pendingGuide.current) clearTimeout(pendingGuide.current.timer);
    pendingGuide.current = null;
  }

  // The guide face follows the pointer to `resolved`'s face (resolveHit())
  // — at once when there is none yet or when `now` (a click), otherwise
  // after the dwell. Its anchor is the spot the pointer resolved to: a
  // tap's is where the hole goes, which faceNear() finds around the bore.
  function proposeGuideFace(resolved, now = false) {
    const key = resolved.face.key;
    if (key === guideFaceKey) {
      cancelPendingGuide();
      return;
    }
    const anchor = { point: resolved.point, normal: resolved.face.normal };
    if (now || guideFaceKey === null) {
      cancelPendingGuide();
      setGuideFaceKey(key, anchor);
      return;
    }
    if (pendingGuide.current?.key === key) return;
    cancelPendingGuide();
    pendingGuide.current = {
      key,
      timer: setTimeout(() => {
        pendingGuide.current = null;
        setGuideFaceKey(key, anchor);
      }, GUIDE_SWITCH_DELAY_MS),
    };
  }

  const dimensions = useMemo(
    () => (stlBuffer ? outsideDimensions(meshExtents(stlBuffer)) : null),
    [stlBuffer],
  );
  const maxExtent = baseExtents ? Math.max(...baseExtents) : 50;
  // How close to a snap point a click has to land to take it, and how
  // big the dots are — both scaled to the model.
  const snapRadius = Math.max(1.5, 0.04 * maxExtent);
  const snapDot = Math.max(0.6, 0.018 * maxExtent);

  // --- keys ----------------------------------------------------------
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    if (e.key === "Escape") {
      if (importOpen) endImport();
      else if (repeatOpen) setRepeatOpen(false);
      // Someone else's dialog (Settings) is up: Escape is for closing that.
      else if (isBehindOpenDialog()) return;
      else if (selectedIds.length) setSelectedIds([]);
      return;
    }
    if (importOpen || !doc || ignoresShortcut(e)) return;
    // M: the Measure toggle, selection or not (held down, it toggles once).
    if (e.key === "m" || e.key === "M") {
      if (!e.repeat) toggleMeasure();
      return;
    }
    if (!selectedIds.length) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteHoles(selectedIds);
      return;
    }
    // A focused handle steps its own size and says so (preventDefault);
    // everywhere else the arrows nudge the selection, held keys too.
    const nudge = ARROW_NUDGES[e.key];
    if (nudge && !e.defaultPrevented) {
      e.preventDefault();
      nudgeSelection(nudge, e.shiftKey);
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
    ++baseRequest.current;
    setDoc(createHolesDoc(source, name), { label: "pick a model" });
    setSelectedIds([]);
    setRenderError(null);
  }

  function pickCataloguePart(part, params = resolveParams(part, {})) {
    start({ kind: "catalogue", partId: part.id, params });
  }

  // Centered on the grid with its bottom at z = 0 (see groundedMesh()):
  // a file saved at some corner of a print bed would otherwise sit far
  // from the grid, and a hole's coordinates would carry that offset.
  function pickImportedMesh(part) {
    start(meshSource(part.name, part.geometry, false));
    endImport();
  }

  // The import flow, opened on a file the user dropped, or on its own
  // chooser.
  /** @param {File | null} [file] */
  function startImport(file = null) {
    setImportFile(file);
    setImportOpen(true);
  }

  function endImport() {
    setImportOpen(false);
    setImportFile(null);
  }

  // Turn a mesh source over (or back). The holes go with it, so they
  // stay on the spots they were placed on.
  function setFlip(flip) {
    setDoc(
      (d) => {
        if (!d || d.source.kind !== "mesh" || Boolean(d.source.flip) === flip) return d;
        const source = meshSource(d.source.name, d.source.geometry, flip);
        return { ...flipHoles(d, d.source.extents[2]), source };
      },
      { label: "flip" },
    );
  }

  // The bench as one mesh: its "all" body, rendered through the same
  // request the Bench's own preview uses, so it is a cache hit when the
  // Bench just showed it. A model picked while it renders wins: the
  // render's result is dropped (see baseRequest) rather than replacing
  // that model and any holes already drilled into it.
  async function pickCurrentBench() {
    const { assembly, importedParts } = bench;
    if (!assembly) return;
    const request = baseRequest.current;
    setBenchBusy(true);
    try {
      const partsById = new Map([...catalogueById, ...importedParts]);
      const importedFiles = new Map();
      const scadSource = compileToScad(assembly, partsById, importedFiles);
      const buf = await renderPart({ scadSource, part: "all", importedFiles, globalOverrides });
      if (request !== baseRequest.current) return;
      const name = benchName(assembly) ?? defaultBenchName(assembly, partsById);
      start(meshSource(name, new STLLoader().parse(buf), false), name);
    } catch (err) {
      if (request !== baseRequest.current) return;
      setRenderError(`Couldn't render the bench: ${err.message}`);
    } finally {
      setBenchBusy(false);
    }
  }

  // A base-parameter edit's undo step: a run of keystrokes in one field
  // is one step.
  function baseStep(params) {
    const before = doc.source.params ?? {};
    const changed = Object.keys({ ...before, ...params }).filter((k) => params[k] !== before[k]);
    const one = changed.length === 1 ? changed[0] : null;
    return { key: one && `base:${one}`, label: one ? `edit ${one}` : "edit parameters" };
  }

  function changeBase() {
    if (
      doc.holes.length &&
      !window.confirm(
        `Pick another model? The ${doc.holes.length} hole${doc.holes.length === 1 ? "" : "s"} on this one will be dropped.`,
      )
    )
      return;
    ++baseRequest.current;
    // An undo step like any other: undo brings the model and its holes back.
    setDoc(null, { label: "pick another model" });
    setSelectedIds([]);
  }

  // --- placing -------------------------------------------------------
  // The face under a hit, the snap it would take and the point a click
  // would drill: the analysed face (cached per face after the first
  // look), then the nearest of its snap points within reach, else the
  // nearest guide line within reach (the hit slid onto it) — neither
  // with snapping off or Shift held — else the hit rounded to the grid
  // (or exactly as it is, with Shift or snapping off). The grid is the
  // Grid setting (uiPrefs.js), the one the handles and nudges use; Off
  // is exactly where the click landed.
  /** @param {SurfaceHit} hit */
  function resolveHit(hit) {
    if (!geometries) return null;
    const analysed = analyzeFace(geometries.topo, hit.faceIndex, { inset, radius });
    if (!analysed) return null;
    const face = analysed.key === pitch?.faceKey ? withPitch(analysed, pitch) : analysed;
    const snapping = snapOn && !hit.shiftKey;
    const grid = getGridSnap();
    // A fingertip lands within about 22 px of what it meant; the model's
    // own snap radius is 7 px on a phone for a 42 mm part, so a touch
    // reaches as far as the finger does (the viewer says what a pixel
    // measures at the hit).
    const reach = hit.touch && hit.mmPerPx ? Math.max(snapRadius, TOUCH_SNAP_PX * hit.mmPerPx) : snapRadius;
    const snap = snapping ? nearestCandidate(face, hit.point, reach) : null;
    const line = snapping && !snap ? nearestGuide(face, hit.point, reach, grid) : null;
    const point = snap
      ? snap.point
      : line
        ? line.point
        : snapping
          ? gridPoint(face, hit.point, grid)
          : planePoint(face, hit.point);
    return { face, snap, line, point };
  }

  // Whether the mesh on screen was rendered from the current base. While
  // a new base renders (another model picked, a mesh flipped) the old
  // mesh is still up, and a click on it would drill at the old model's
  // coordinates — so surface hits and hover are ignored until the two
  // match again. Holes being added or removed keep the source, and with
  // it a live mesh.
  const meshIsCurrent = Boolean(doc) && preview.key?.source === doc.source;

  /** @param {SurfaceHit | null} hit */
  function onSurfaceHover(hit) {
    if (!hit || !meshIsCurrent) {
      cancelPendingGuide();
      hoverPoint.current = null;
      setHover(null);
      if (measuring) setMeasurePoint(null);
      return;
    }
    const resolved = resolveHit(hit);
    if (!resolved) return;
    hoverPoint.current = resolved.point;
    if (measuring)
      setMeasurePoint((prev) =>
        prev && prev.every((n, i) => n === resolved.point[i]) ? prev : resolved.point,
      );
    proposeGuideFace(resolved);
    const next = {
      faceKey: resolved.face.key,
      snapId: resolved.snap?.id ?? null,
      snapLabel: resolved.snap?.label ?? null,
      linePoint: resolved.line?.point ?? null,
      lineLabel: resolved.line?.label ?? null,
    };
    setHover((prev) => (sameHover(prev, next) ? prev : next));
  }

  /** @param {SurfaceHit} hit */
  function onSurfaceHit(hit) {
    if (!meshIsCurrent) return;
    const resolved = resolveHit(hit);
    if (!resolved) return;
    // A finger never hovers, so the tap is the one place it can say
    // where to measure from.
    if (measuring) setMeasurePoint(resolved.point);
    // Nor can it see a face's guides before it drills, so the first tap on
    // a face that isn't showing them only brings them up, to aim the
    // second by. A tap on a hole there still picks it.
    const { point, face } = resolved;
    const firstLook =
      hit.touch && face.key !== guideFaceKey && !doc.holes.some((h) => holeAtSpot(h, point, face.normal));
    proposeGuideFace(resolved, true);
    if (!firstLook) placeAt(point, face.normal, hit.shiftKey);
  }

  // A spot that already has a hole selects it — or, with Shift, adds it
  // to the selection or takes it out; anywhere else drills a new one
  // with the "new holes" spec and selects that. (Shift on a bare face
  // is still free placement: resolveHit() didn't snap it.) The floor of a
  // cutout's pocket is somewhere else (holeAtSpot()): a hole can go there.
  function placeAt(point, normal, shiftKey = false) {
    const existing = doc.holes.find((h) => holeAtSpot(h, point, normal));
    if (existing) {
      pickHole(existing.id, shiftKey);
      return;
    }
    const { doc: next, hole } = addHole(doc, { point, normal });
    setDoc(next, { label: "drill a hole" });
    setSelectedIds([hole.id]);
  }

  // A click on a hole: just that one, with its face's guides (to drag it
  // by), or with Shift, toggle it in the selection. With Measure on, the distances then follow the selected
  // hole until the next tap on a face, rather than staying on a spot
  // tapped before (a finger has no hover to move them).
  function pickHole(id, shiftKey) {
    if (measuring) setMeasurePoint(null);
    if (shiftKey) setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    else {
      setSelectedIds([id]);
      const hole = doc.holes.find((h) => h.id === id);
      if (hole) guideToHole(hole);
    }
  }

  // The Measure toggle (the toolbar's button and the holes.measure
  // command): turned on, it measures from the selected hole until a face
  // is tapped.
  function toggleMeasure() {
    if (!measureOn) setMeasurePoint(null);
    setMeasureOn(!measureOn);
  }

  function onMarkerClick(id, modifiers = {}) {
    if (id.startsWith("hole:")) {
      pickHole(id.slice("hole:".length), modifiers.shiftKey);
      return;
    }
    if (id.startsWith("snap:") && meshIsCurrent) {
      // The snap markers shown are always the guide face's. A hole
      // drilled at a snap point has that point's marker on its centre
      // while the face is the guide, so Shift goes through too: Shift on
      // the hole there takes it out of the selection, as it does on the
      // face (onSurfaceHit) and on the hole's ring.
      const candidate = snapFace?.candidates.find((c) => `snap:${c.id}` === id);
      if (!candidate) return;
      if (measuring) setMeasurePoint(candidate.point);
      placeAt(candidate.point, snapFace.normal, modifiers.shiftKey);
    }
  }

  function deleteHoles(ids) {
    setDoc((d) => removeHoles(d, ids), { label: ids.length > 1 ? "delete holes" : "delete hole" });
    setSelectedIds((s) => s.filter((x) => !ids.includes(x)));
  }

  // The sidebar list's row callbacks, the same functions every render so
  // the memoised rows (HoleRow.jsx) don't re-render with the pointer.
  // Plain click: just this one (again: none). Shift: add it to the
  // selection or take it out.
  const pickRow = useStableCallback((id, shiftKey) => {
    if (measuring) setMeasurePoint(null);
    if (shiftKey) pickHole(id, true);
    else setSelectedIds((ids) => (ids.length === 1 && ids[0] === id ? [] : [id]));
  });
  const removeRow = useStableCallback((id) => deleteHoles([id]));

  // --- the editor's target: the selected holes, else the next one -----
  // Whatever screw was picked or typed last — for a selected hole or in
  // the "New holes" editor — is what the next click drills, so a run of
  // holes of one kind doesn't need the type re-picked each time. With
  // several selected, the editor shows what they share and a change
  // sets that field on all of them (screwHoles.js's sharedSpec() /
  // patchHoles()); a preset picked then is also what the next holes
  // get, a single field edit is not (it is only part of a spec).
  const selectedHoles = doc ? doc.holes.filter((h) => selectedIds.includes(h.id)) : [];
  const selected = selectedHoles.length === 1 ? selectedHoles[0] : null;
  // Measure follows the selected hole's system: turned on with a hole
  // whose preset belongs to one selected (or such a hole selected while it
  // is on), it shows that system's spacing. Only when that changes, so a
  // spacing picked by hand stays until the selection or Measure does —
  // adjusted while rendering, React's way for state that follows other
  // state, rather than in an effect a frame late.
  const autoPitchId = measuring && selected ? presetSpacingId(selected.presetId) : null;
  const [seenAutoPitchId, setSeenAutoPitchId] = useState(null);
  if (autoPitchId !== seenAutoPitchId) {
    setSeenAutoPitchId(autoPitchId);
    if (autoPitchId) setPitchId(autoPitchId);
  }
  const multi = selectedHoles.length > 1;
  const shared = useMemo(() => sharedSpec(selectedHoles), [doc?.holes, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const editingSpec = selected ? selected.spec : doc?.nextSpec;
  const editingPresetId = multi ? shared.presetId : selected ? selected.presetId : doc?.nextPresetId;
  // An edit's undo step: a run of keystrokes in one field of the same
  // holes (or of the next hole's spec) is one step, as typing is.
  function specStep(patch) {
    const fields = Object.keys(patch);
    const field = fields.length === 1 ? fields[0] : null;
    const ids = selectedIds.length ? [...selectedIds].sort().join(",") : "new";
    return { key: field && `spec:${ids}:${field}`, label: field ? `edit ${field}` : "edit hole" };
  }
  function applySpec(spec, presetId = editingPresetId, step = {}) {
    setDoc(
      (d) => setNextSpec(selected ? updateHole(d, selected.id, { spec, presetId }) : d, spec, presetId),
      step,
    );
  }
  // A slot preset keeps what the hole shares with it (presetSpecFor()):
  // switching MultiConnect types keeps the channel length, gap and
  // direction already set.
  function applyPreset(preset) {
    const step = { label: `pick ${preset.name}` };
    if (multi) {
      setDoc(
        (d) =>
          setNextSpec(
            setHolesSpec(d, selectedIds, preset.spec, preset.id),
            presetSpecFor(d.nextSpec, preset.spec),
            preset.id,
          ),
        step,
      );
      return;
    }
    applySpec(presetSpecFor(editingSpec, preset.spec), preset.id, step);
  }
  // The same function every render, for the memoised preset grid.
  const pickPreset = useStableCallback(applyPreset);
  function patchSelection(patch) {
    if (multi) setDoc((d) => patchHoles(d, selectedIds, patch), specStep(patch));
    else applySpec({ ...editingSpec, ...patch }, editingPresetId, specStep(patch));
  }
  // The Repeat form's result on the current document, for its preview,
  // its counts and its button: worked out afresh on each change.
  const repeatTarget = repeatOpen && selectedIds.length === 1 ? selectedIds[0] : null;
  const repeatResult = useMemo(
    () =>
      repeatTarget && doc && repeatProbe ? repeatHole(doc, repeatTarget, repeatOptions, repeatProbe) : null,
    [repeatTarget, doc, repeatProbe, repeatOptions],
  );
  function applyRepeat() {
    if (!repeatResult) return;
    setDoc(repeatResult.doc, { label: "repeat" });
    // The whole pattern selected, to edit or delete it in one go.
    setSelectedIds(repeatResult.ids);
    setRepeatOpen(false);
  }

  function rotateSelection(delta) {
    if (multi) setDoc((d) => rotateHoles(d, selectedIds, delta), { label: "turn" });
    else applySpec({ ...editingSpec, spin: editingSpec.spin + delta }, editingPresetId, { label: "turn" });
  }

  // --- undo ----------------------------------------------------------
  // The document's history (lib/holesSession.js; every setDoc() above
  // records a step, labelled for the Undo button's tooltip). A restored
  // document may lack a selected hole (an undone drill), so the
  // selection keeps only the holes it has; and a "Use the current bench"
  // render still running is no longer wanted (baseRequest). The last
  // handle commit (`pending`) stays: it is matched by identity, so it
  // means nothing while another document is up, and is right again when
  // its own comes back — a redo of it renders at once behind its ghost,
  // and undoing a rename made after it failed offers its undo again.
  const history = useHolesHistory();
  function afterRestore() {
    ++baseRequest.current;
    const ids = new Set(getHolesSession().doc?.holes.map((h) => h.id) ?? []);
    setSelectedIds((s) => (s.every((id) => ids.has(id)) ? s : s.filter((id) => ids.has(id))));
  }
  const undo = () => {
    if (undoHoles()) afterRestore();
  };
  const redo = () => {
    if (redoHoles()) afterRestore();
  };
  useUndoShortcuts({ onUndo: undo, onRedo: redo });

  // --- handles -------------------------------------------------------
  // On a single selected hole, once the mesh on screen is the current
  // base's (until then the face a drag runs on may be the old model's):
  // lib/holeHandles.js's move handle, and a cutout's resize handles.
  // They come from the document, not the mesh, so they stand where the
  // hole is now — a commit moves them at once, ahead of its render.
  const selectedNumber = selected ? doc.holes.indexOf(selected) + 1 : 0;
  const handles = useMemo(
    () => (selected && meshIsCurrent ? holeHandles(selected, selectedNumber) : undefined),
    [selected, selectedNumber, meshIsCurrent],
  );
  // The furthest one gesture reaches: the model's diagonal.
  const reachMm = baseExtents ? Math.hypot(...baseExtents) : 0;
  // The pending ghost stays while its render runs; a cancel, an error, a
  // landed mesh or any other change to the holes, the base or the
  // settings ends it.
  const pendingShown = isPendingRender(renderKey) && status === "rendering" ? pending : null;
  // Its render failed, and the document is still the one it made: the
  // error offers to undo it. Any later change — a rename, the next hole's
  // spec, which leave the holes (and the error) as they were — is what
  // Undo would take back instead, so the offer goes; and a render that
  // failed after a Settings change failed for the settings, not the size.
  const handleFailed =
    !!pending && pending.doc === doc && pending.globalOverrides === globalOverrides && status === "error";

  // What a drag started from: the hole and the handle at pointerdown
  // (and, for the move handle, the last spot it asked staysOnFace() about).
  // Nothing in it indexes the mesh on screen (the trap the guide face's
  // key has to dodge), so a render landing mid-drag leaves it valid; a
  // new base, which would not, takes the handles away (meshIsCurrent),
  // and the viewer ends a drag whose handle goes.
  const dragStart = useRef(null);
  const findHandle = (id) => handles?.find((h) => h.id === id) ?? null;
  // Is `hole`, moved to `point`, still on a face turned like it?
  // lib/holeHandles.js's movedOnFace(): asked of the base without holes
  // (renderHoled()'s `base`, parsed once), where the hole's own bore at
  // its old spot is not in the way, and — for a face only the holes made,
  // a pocket's floor with a hole drilled into it — of the mesh on screen.
  const staysOnFace = (hole, point) =>
    movedOnFace(hole, point, { base: baseStl && stlProbe(baseStl), shown: repeatProbe });

  // A resize's outcome as a gesture: the patch, the undo label, and the
  // ghost — the new outline, its label at the dragged handle's new spot,
  // and that handle and the opposite one (which stays put, unless from
  // the centre) riding on it.
  function resizeGesture(hole, handle, result, symmetric = false) {
    const at = { ...hole, point: result.point, spec: result.spec };
    const opposite = `${hole.id}:${oppositeSide(handle.side)}`;
    /** @type {Record<string, number[]>} */
    const handlePoints = {};
    for (const h of holeHandles(at, selectedNumber)) {
      if (h.id === handle.id || h.id === opposite) handlePoints[h.id] = h.point;
    }
    return {
      hole,
      patch: { spec: result.spec, point: result.point },
      changed: result.changed,
      onFace: true,
      label: resizeLabel(hole, handle),
      segments: holeOutline(at),
      text: holeResizeText(hole, handle, result, symmetric),
      textPoint: handlePoints[handle.id] ?? result.point,
      handlePoints,
    };
  }

  // A drag's outcome at `point`, for its previews and its commit. The
  // move handle: the hole's outline and centre where it would land, or
  // "Off the face" where it may not. A resize handle: resizeGesture().
  function dragGesture(id, point, modifiers) {
    const start = dragStart.current;
    if (!start || start.handle.id !== id) return null;
    const { hole, handle } = start;
    const gridMm = getGridSnap();
    if (handle.side !== "move") {
      const symmetric = modifiers.altKey;
      const result = dragHoleResize({ hole, handle, point, symmetric, gridMm, limitMm: reachMm });
      return result && resizeGesture(hole, handle, result, symmetric);
    }
    const moved = moveHole({ hole, point, gridMm, free: modifiers.shiftKey, limitMm: reachMm });
    if (!moved) return null;
    const at = { ...hole, point: moved.point };
    const changed = moved.offset.some((c) => c !== 0);
    // Where the hole already is needs no asking ("Not moved", not "Off the
    // face", for a hole whose spot the base can't confirm — one on a face
    // only the holed mesh has). Otherwise asked once per spot: on the grid
    // most frames of a drag land on the spot the last one did, and each
    // probe is a raycast over every triangle of the base. Only the centre
    // is asked, on purpose: a cutout may hang over the face's edge to
    // notch it, as one drilled near the edge or grown in the sidebar can.
    const spot = moved.point.join(",");
    if (changed && start.probe?.spot !== spot) start.probe = { spot, onFace: staysOnFace(hole, moved.point) };
    const onFace = !changed || start.probe.onFace;
    return {
      hole,
      patch: { point: moved.point },
      changed,
      onFace,
      label: "move hole",
      segments: [...holeOutline(at), ...holeCross(at, crossSize(hole))],
      text: onFace ? holeMoveText(moved.offset) : "Off the face",
      textPoint: moved.point,
      handlePoints: { [id]: moved.point },
    };
  }

  // A gesture's change, committed the way the sidebar commits an edit of
  // the selected hole: one undo step, and a new size is also what the
  // next click drills (setNextSpec()). Applied to the document as it is
  // now, then shown as a ghost until its render lands — at once for a
  // drag or a typed size, after the usual debounce for arrow steps.
  function commitGesture(g, { immediate, key = null }) {
    const current = getHolesSession().doc;
    const hole = current?.holes.find((h) => h.id === g.hole.id);
    if (!hole || !g.changed) return;
    let next = updateHole(current, hole.id, g.patch);
    if (g.patch.spec) next = setNextSpec(next, g.patch.spec, hole.presetId);
    setPending({
      holes: next.holes,
      doc: next,
      globalOverrides,
      immediate,
      ghost: { segments: g.segments, text: `${g.text} · rendering…`, textPoint: g.textPoint },
    });
    setDoc(next, { key, label: g.label });
  }

  const onHandleStart = (id) => {
    const handle = findHandle(id);
    dragStart.current = handle && selected ? { handle, hole: selected } : null;
    if (selected) guideToHole(selected);
    setHandleDrag(true);
  };
  const onHandlePreview = (id, point, modifiers) => {
    const g = dragGesture(id, point, modifiers);
    return g && { segments: g.segments, text: g.text, textPoint: g.textPoint, handlePoints: g.handlePoints };
  };
  const onHandleCommit = (id, point, modifiers) => {
    const g = dragGesture(id, point, modifiers);
    if (!g?.changed) return;
    if (g.onFace) commitGesture(g, { immediate: true });
    else setNotice({ text: "Off the face — the hole stays where it was." });
  };
  const onHandleEnd = () => {
    dragStart.current = null;
    setHandleDrag(false);
  };
  // An arrow key on a focused handle: a grid step of that side (Shift:
  // ten), from the opposite edge; a held key's run is one undo step.
  const onHandleStep = (id, steps, modifiers) => {
    const handle = findHandle(id);
    if (!handle || !selected) return;
    const gridMm = getGridSnap();
    const result = stepHoleSize({
      hole: selected,
      handle,
      steps: steps * (modifiers.shiftKey ? 10 : 1),
      gridMm,
    });
    if (result)
      commitGesture(resizeGesture(selected, handle, result), { immediate: false, key: `handle:${id}` });
  };
  const onHandleSet = (id, mm) => {
    const handle = findHandle(id);
    if (!handle || !selected) return;
    const result = typedHoleSize({ hole: selected, handle, mm });
    if (result) commitGesture(resizeGesture(selected, handle, result), { immediate: true });
  };

  // --- nudge ---------------------------------------------------------
  // An arrow key moves the selected holes one grid step along their
  // faces (nudgeHoles(); 0.5 mm with the Grid off, Shift ten), a held or
  // repeated key one undo step. Refused, saying why, when a hole would
  // leave its face (staysOnFace()), and while the mesh on screen is an older
  // base's (there is no knowing yet where the faces are).
  /**
   * @param {number[]} direction [across, up]: ±1 or 0 each
   * @param {boolean} big Shift: ten steps
   */
  function nudgeSelection([across, up], big) {
    if (!meshIsCurrent) return;
    const step = (getGridSnap() || NUDGE_OFF_MM) * (big ? 10 : 1);
    const current = getHolesSession().doc;
    const { doc: next, moved } = nudgeHoles(current, selectedIds, [across * step, up * step]);
    if (!moved.length) return;
    const was = new Map(current.holes.map((h) => [h.id, h]));
    if (moved.some((m) => !staysOnFace(was.get(m.id), m.point))) {
      setNotice({
        text: `Not moved: ${moved.length > 1 ? "a hole" : "the hole"} would leave its face.`,
      });
      return;
    }
    setNotice(null);
    const ids = moved.map((m) => m.id).sort();
    setDoc(next, { key: `nudge:${ids.join(",")}`, label: "nudge" });
  }
  // A notice clears itself after a moment; a new one restarts the clock.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // --- export --------------------------------------------------------
  const exportName = doc ? doc.name?.trim() || sourceStem(doc.source, catalogueById) : "";

  /** @param {AbortSignal} [signal] */
  async function holedBuffer(signal) {
    return (await renderHoled(doc, catalogueById, globalOverrides, signal)).stl;
  }

  // "Print with EasyPrint…" (components/PrintSheet.jsx): the holed mesh
  // as one file. Its render is the preview's own request, so a sheet
  // opened on a finished preview has the bytes at once; a stale preview
  // renders first and the sheet's button waits. Closing the sheet (or
  // leaving the tab) aborts its interest in the render, so an edit right
  // after can cancel a stale one instead of waiting behind it, and the
  // aborted sheet's late result is ignored.
  const [printSheet, setPrintSheet] = useState(
    /** @type {{ bytes: ArrayBuffer | Uint8Array | null, error?: string } | null} */ (null),
  );
  const printAbort = useRef(/** @type {AbortController | null} */ (null));
  function openPrintSheet() {
    printAbort.current?.abort();
    const controller = (printAbort.current = new AbortController());
    setPrintSheet({ bytes: null });
    holedBuffer(controller.signal).then(
      (bytes) => !controller.signal.aborted && setPrintSheet({ bytes }),
      (err) => !controller.signal.aborted && setPrintSheet({ bytes: null, error: err.message }),
    );
  }
  function closePrintSheet() {
    printAbort.current?.abort();
    printAbort.current = null;
    setPrintSheet(null);
  }
  useEffect(() => () => printAbort.current?.abort(), []);

  async function downloadStl() {
    try {
      downloadBlob(await holedBuffer(), exportFilename(exportName, "holes", ".stl"), "model/stl");
    } catch (err) {
      setRenderError(err.message);
    }
  }

  const layerling = useLayerlingCopy(setRenderError);
  function copyToLayerling() {
    layerling.copy(holedBuffer().then((stlBuffer) => [{ name: exportName || "Holes", stlBuffer }]));
  }

  // The extents come from the current base, as holedBuffer()'s do, not
  // from the last render that finished: that may be the previous model's
  // (or none yet), which would size the through holes for the wrong part.
  async function downloadScad() {
    try {
      const extents = meshExtents(await baseBuffer(doc.source, catalogueById, globalOverrides));
      downloadBlob(
        holesToScad(doc, catalogueById, { throughLength: Math.hypot(...extents) + 2, extents }),
        exportFilename(exportName, "holes", ".scad"),
        "text/plain",
      );
    } catch (err) {
      setRenderError(err.message);
    }
  }

  // --- markers -------------------------------------------------------
  // The guide face, analysed with the current inset and radius — so a
  // change to either redraws its lines and points at once, hovering or
  // not. (analyzeFace() refreshes the cached face in place.)
  const guideFace = useMemo(() => {
    if (guideFaceKey === null || !geometries) return null;
    return analyzeFace(geometries.topo, guideFaceKey, { inset, radius });
  }, [guideFaceKey, geometries, inset, radius]);

  // While measuring with a system spacing picked: that system's next
  // holes round the selected one, when it is on the guide face — snap
  // points to drill them at, so a pattern can be walked a hole at a time
  // (each new hole is selected, and the points move on with it). Round
  // the selected hole rather than the pointer: points that followed the
  // pointer could never be reached.
  const pitch = useMemo(() => {
    if (!measuring || !pitchSpacing || !guideFace || handleDrag || !selected) return null;
    if (!onFacePlane(guideFace, selected.point)) return null;
    const candidates = pitchCandidates(guideFace, selected.point, pitchSpacing);
    return { faceKey: guideFace.key, anchor: selected.point, candidates };
  }, [measuring, pitchSpacing, guideFace, handleDrag, selected]);
  // The guide face with those points among its snap points, first: what
  // the markers draw and a marker click looks up.
  const snapFace = useMemo(
    () => (pitch && guideFace ? withPitch(guideFace, pitch) : guideFace),
    [guideFace, pitch],
  );

  const markers = useMemo(
    () => holeMarkers({ doc, selectedIds, repeatResult, hover, guideFace: snapFace, snapOn, snapDot }),
    [doc, selectedIds, hover, snapFace, snapOn, snapDot, repeatResult],
  );

  // The lines across the guide face (with snapping on — they stay up
  // while a hole is dragged across it, to aim by), and every connector
  // slot's outline on its own face — its channel, its entry (dashed)
  // and an arrow the way the head travels to seat, since a ring says
  // nothing about which way a slot points. Each piece is lifted off
  // its face along the normal.
  const guides = useMemo(
    () => holeGuides({ holes: doc?.holes ?? [], selectedIds, guideFace, snapOn }),
    [guideFace, snapOn, doc?.holes, selectedIds],
  );

  const hoveredSnap = hover?.snapId
    ? { label: hover.snapLabel }
    : hover?.linePoint
      ? { label: hover.lineLabel, point: hover.linePoint }
      : null;

  // With Option held: the hovered point's (else the selected hole's, if
  // it lies on the guide face) distances to the guide face's edges and
  // center as dimension lines and labels, plus the face's size. Not
  // while a handle is dragged: there Option means "from the centre", and
  // the drag's own label says what matters.
  const measurements = useMemo(() => {
    if (!measuring || !guideFace || handleDrag) return NO_MEASUREMENTS;
    const point =
      measurePoint ?? (selected && onFacePlane(guideFace, selected.point) ? selected.point : null);
    const own = faceMeasurements(guideFace, point);
    if (!pitch?.candidates.length) return own;
    const next = pitchMeasurements(guideFace, pitch.anchor, pitch.candidates);
    return { guides: [...next.guides, ...own.guides], labels: [...own.labels, ...next.labels] };
  }, [measuring, guideFace, measurePoint, selected, handleDrag, pitch]);
  // One array for the viewer while neither changes: its guides effect
  // rebuilds the lines whenever the array is a new one.
  const viewerGuides = useMemo(
    () => (measurements.guides.length ? [...guides, ...measurements.guides] : guides),
    [guides, measurements],
  );

  // --- commands ------------------------------------------------------
  // The palette's Holes commands (hooks/useCommands.js): the sidebar's
  // buttons and the tab's keys, and every hole type — search-only at the
  // top level ("m4 counter" and Enter), and as the Hole type… list — which
  // goes to the selected holes, or the next ones, as a pick in the
  // sidebar's grid does (applyPreset()). Before the start screen's early
  // return, as every hook.
  const historyCommands = (section) => [
    builtin("holes.undo", {
      when: history.canUndo,
      section,
      title: history.undoLabel ? `Undo ${history.undoLabel}` : "Undo",
      run: undo,
    }),
    builtin("holes.redo", {
      when: history.canRedo,
      section,
      title: history.redoLabel ? `Redo ${history.redoLabel}` : "Redo",
      run: redo,
    }),
  ];

  // The start picker: a command palette page over the empty tab, open
  // unless Escape put it away for this session snapshot (a new one — Pick
  // another model, an undo back to no model — brings it back, as do the
  // empty state's button and Mod+K). It steps aside for the import flow.
  const hidden = useHiddenLibrary();
  const systemOrder = useSystemOrder();
  const [pickerDismissedFor, setPickerDismissedFor] = useState(null);
  const startPickerOpen = !doc && !importOpen && pickerDismissedFor !== session;
  const reopenStartPicker = () => setPickerDismissedFor(null);
  useCommandHome(!doc && !importOpen && !startPickerOpen ? reopenStartPicker : null);

  // A model file dropped on the empty tab (its picker put away) is the
  // model, as the picker's own drop makes it; one dropped on the global
  // palette replaces the model in use — after asking when it has holes,
  // and undoably, as "Pick another model" does.
  const emptyDrop = useFileDrop(!doc && !importOpen ? startImport : null);
  useCommandDrop({
    label: doc ? "Drop to drill holes in this model instead" : "Drop to drill holes in it",
    onFile: (file) => {
      const count = doc?.holes.length ?? 0;
      if (
        count &&
        !window.confirm(
          `Drill into "${file.name}" instead? The ${count} hole${count === 1 ? "" : "s"} on this model will be dropped.`,
        )
      )
        return;
      startImport(file);
    },
  });

  useCommands("holes", () => {
    const undoRedo = historyCommands();
    if (!doc) return undoRedo;
    const count = selectedHoles.length;
    const useFor =
      count > 1
        ? `Use for the ${count} selected holes`
        : count === 1
          ? "Use for the selected hole"
          : "Use for new holes";
    const presets = presetGroups().flatMap((g) => g.presets);
    const presetRow = (preset, extra) => ({
      id: `holes.preset:${preset.id}`,
      title: preset.name,
      subtitle: preset.group,
      section: "Hole types",
      keywords: preset.short ? [preset.short, preset.group] : [preset.group],
      icon: <ScrewIcon spec={preset.spec} screw={preset.screw} />,
      checked: editingPresetId === preset.id,
      actions: [{ title: useFor, run: () => pickPreset(preset) }],
      ...extra,
    });
    const editingName = editingPresetId ? getPreset(editingPresetId)?.name : null;
    return [
      builtin("holes.holeType", {
        subtitle: editingName ?? "Custom",
        page: () => ({
          id: "hole-types",
          title: count ? `Hole type for the selected hole${count > 1 ? "s" : ""}` : "Hole type for new holes",
          searchLabel: "Search hole types",
          items: () => presets.map((preset) => presetRow(preset, { section: preset.group })),
        }),
      }),
      ...presets.map((preset) => presetRow(preset, { searchOnly: true })),
      builtin("holes.selectAll", {
        when: doc.holes.length > 0 && count < doc.holes.length,
        run: () => setSelectedIds(doc.holes.map((h) => h.id)),
      }),
      builtin("holes.deselect", { when: count > 0, run: () => setSelectedIds([]) }),
      builtin("holes.delete", {
        when: count > 0,
        title: count > 1 ? `Delete the ${count} selected holes` : "Delete the selected hole",
        run: () => deleteHoles(selectedIds),
      }),
      builtin("holes.repeat", { when: Boolean(selected), run: () => setRepeatOpen(true) }),
      builtin("holes.snap", {
        checked: snapOn,
        subtitle: snapOn ? "On" : "Off",
        run: () => setSnapOn((on) => !on),
      }),
      builtin("holes.pitch", {
        subtitle: pitchSpacing ? pitchSpacing.label : "None",
        page: () => ({
          id: "measure-spacing",
          title: "Measure spacing",
          searchLabel: "Search spacings",
          note: "While measuring, the system's next holes round the selected one, as snap points.",
          items: () =>
            [null, ...STANDARD_SPACINGS].map((spacing) => ({
              id: `holes.pitch:${spacing?.id ?? "none"}`,
              title: spacing ? spacingLabel(spacing) : "None",
              section: "Measure spacing",
              checked: pitchId === (spacing?.id ?? null),
              actions: [{ title: "Use", run: () => setPitchId(spacing?.id ?? null) }],
            })),
        }),
      }),
      builtin("holes.measure", {
        checked: measureOn,
        // Holding Option shows the same while it is held; it is not this
        // toggle's key, so it is said here rather than as a key hint.
        subtitle: `${measureOn ? "On" : "Off"}${coarse ? "" : " · or hold Option"}`,
        run: toggleMeasure,
      }),
      builtin("holes.flip", {
        when: doc.source.kind === "mesh",
        checked: Boolean(doc.source.flip),
        run: () => setFlip(!doc.source.flip),
      }),
      builtin("holes.downloadStl", { run: downloadStl }),
      builtin("holes.print", { run: openPrintSheet }),
      builtin("holes.downloadScad", { run: downloadScad }),
      builtin("holes.layerling", { run: copyToLayerling }),
      builtin("holes.retry", { when: Boolean(renderError) && status !== "rendering", run: preview.retry }),
      builtin("holes.pickAnother", { run: changeBase }),
      ...undoRedo,
    ];
  });

  // --- start screen --------------------------------------------------
  if (!doc) {
    const benchReady = Boolean(bench.assembly);
    /** @type {import("./lib/commands.js").CommandPage} */
    const startPage = {
      id: "holes-start",
      title: "Drill screw holes",
      searchLabel: "Search parts",
      placeholder: "Search parts and commands…",
      note: 'Pick a model to put screw holes into — a catalogue part, the bench as it stands, or type "import" for a mesh of your own.',
      error: renderError,
      searchCommands: true,
      drop: () => ({ label: "Drop to drill holes in it", onFile: startImport }),
      items: () => [
        ...historyCommands("History"),
        librarySelection && {
          id: "holes.useLibraryPart",
          title: `Library's part: ${librarySelection.part.name}`,
          subtitle: "with its current parameters",
          section: "Start from",
          keywords: ["library", "selected"],
          actions: [
            {
              title: "Use",
              run: () => pickCataloguePart(librarySelection.part, librarySelection.params),
            },
          ],
        },
        benchReady && {
          id: "holes.useBench",
          title: "Use the current bench",
          subtitle: "rendered as one mesh",
          section: "Start from",
          keywords: ["bench", "assembly"],
          disabled: benchBusy && "Rendering the bench…",
          actions: [{ title: "Use", run: pickCurrentBench }],
        },
        ...[...partSections(parts, hidden, systemOrder)].flatMap(([system, systemParts]) =>
          systemParts.map((part) =>
            partCommand(part, {
              id: `holes.base:${part.id}`,
              section: system,
              actions: [{ title: "Drill holes in it", run: () => pickCataloguePart(part) }],
            }),
          ),
        ),
        {
          id: "holes.importMesh",
          title: "Import STL / STEP / 3MF…",
          section: "Import",
          keywords: ["mesh", "file", "own model"],
          actions: [{ title: "Import", run: () => startImport() }],
        },
      ],
    };
    // Behind the picker, and what Escape leaves: what this tab is for, and
    // the way back to the picker. "Pick another model" is undoable (the
    // model it dropped comes back with its holes), and an undone "pick a
    // model" lands here with only a redo to offer, so both are here too.
    return (
      <main
        className={emptyDrop.over ? "bench-empty holes-empty is-drop-over" : "bench-empty holes-empty"}
        {...emptyDrop.handlers}
      >
        {emptyDrop.over && (
          <div className="bench-empty-drop" aria-hidden="true">
            Drop to drill holes in it
          </div>
        )}
        <div className="bench-empty-card">
          <p className="bench-empty-lead">No model yet.</p>
          <p className="muted">
            Pick a model to put screw holes into — a catalogue part, a mesh of your own, or the bench as it
            stands. Then click its faces: a hole snaps to the face's center, the center of each quadrant,
            holes already in it, a set-in point at each corner, and the guide lines drawn across it — center
            and quarter lines, a radial to each corner, and a circle of the radius you choose.
          </p>
          <div className="bench-empty-actions">
            <button type="button" className="render-button" onClick={reopenStartPicker}>
              Choose a model… <kbd className="shortcut-hint">{chordText(["Mod", "K"])}</kbd>
            </button>
            <button type="button" className="render-button" onClick={() => startImport()}>
              Import STL / STEP / 3MF…
            </button>
          </div>
          <p className="muted">Or drop a model file here to drill into it.</p>
          {(history.canUndo || history.canRedo) && (
            <div className="bench-empty-history">
              <UndoRedoButtons
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={undo}
                onRedo={redo}
                undoLabel={history.undoLabel}
                redoLabel={history.redoLabel}
              />
              {history.undoLabel && <span className="muted">Undo {history.undoLabel}</span>}
            </div>
          )}
          {!startPickerOpen && renderError && (
            <p className="error-text bench-config-error" role="alert">
              {renderError}
            </p>
          )}
        </div>
        {startPickerOpen && (
          <CommandPalette
            page={startPage}
            undo={{ onUndo: undo, onRedo: redo }}
            onClose={(reason) => {
              // Its own items start a document (and so unmount it), open
              // the import or render the bench with it still up; anything
              // else puts it away for now.
              if (reason !== "run") setPickerDismissedFor(session);
            }}
          />
        )}
        {importOpen && (
          <ImportFlow
            mode="mesh"
            initialFile={importFile}
            onCancel={endImport}
            onConfirm={pickImportedMesh}
          />
        )}
      </main>
    );
  }

  const label = sourceLabel(doc.source, catalogueById);
  // Where the floating pill sits: below the selected hole's outline, clear
  // of its handles (holePillAnchor(); the pill hangs below the point), or
  // over the middle of several, which have none.
  const pillBelow = Boolean(selected && handles);
  const selectionAnchor = pillBelow
    ? holePillAnchor(selected)
    : selectedHoles.length
      ? [0, 1, 2].map((i) => selectedHoles.reduce((sum, h) => sum + h.point[i], 0) / selectedHoles.length)
      : null;
  // What the viewer frames: a new model gets the Home view, a change to
  // this one (a hole, a parameter, a flip) keeps the camera. A mesh is
  // told apart by its size as well as its name — two files called
  // "bracket", or the bench picked again after it changed, are other
  // models — and a flip (a half turn, re-grounded) keeps both.
  const fitKey =
    doc.source.kind === "catalogue"
      ? `catalogue:${doc.source.partId}`
      : `mesh:${doc.source.name}:${(doc.source.extents ?? []).map((n) => n.toFixed(3)).join(",")}`;
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
              {doc.source.kind === "catalogue" ? "Catalogue part." : "Imported mesh."}{" "}
              {coarse
                ? "Tap a face in the scene for its guides, again to drill a hole."
                : "Click a face in the scene to drill a hole."}
            </p>
            <label
              className="field bench-name-field"
              title="What the exports are called — <name>_holes.stl and <name>_holes.scad"
            >
              <span className="field-label">Name</span>
              <input
                type="text"
                placeholder={sourceStem(doc.source, catalogueById)}
                value={doc.name ?? ""}
                onChange={(e) =>
                  setDoc((d) => setDocName(d, e.target.value), { key: "name", label: "rename" })
                }
              />
            </label>
            <button type="button" className="render-button bench-reset" onClick={changeBase}>
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
                    onChange={(params) =>
                      setDoc((d) => ({ ...d, source: { ...d.source, params } }), baseStep(params))
                    }
                    emptyText="This part has no parameters."
                  />
                  {doc.holes.length > 0 && (
                    <p className="muted holes-params-note">
                      Holes stay where they are in the part's coordinates; a change that moves a face moves it
                      out from under them.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label
                    className="field field-checkbox bench-crop-field"
                    title="Turn the mesh over (a half turn about X) so the other side faces up — for a file saved the way it prints rather than the way it is used. Holes already placed go with it."
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(doc.source.flip)}
                      onChange={(e) => setFlip(e.target.checked)}
                    />
                    <span className="field-label">Flip upside down</span>
                  </label>
                  <p className="muted holes-params-note">
                    A mesh has no other parameters — change it in the file it came from, or in the Bench if it
                    is the bench.
                  </p>
                </>
              )}
            </details>

            <h3>Snapping</h3>
            <label
              className="field field-checkbox bench-crop-field"
              title="Clicks land on the face center, quadrant centers, existing holes, corner insets and the guide lines when one is within reach. Shift-click places freely."
            >
              <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
              <span className="field-label">Snap to face features and guide lines</span>
            </label>
            <GridField />
            <label
              className="field bench-offset-field holes-inset-field"
              title="How far in from each edge the corner snap points sit; a radial line runs from the face center through each of them"
            >
              <span className="field-label">Corner inset (mm)</span>
              <DecimalInput
                min="0"
                step="0.5"
                value={inset}
                onChange={(value) => setInset(Math.max(0, value))}
              />
            </label>
            <p className="muted holes-params-note">
              {coarse ? (
                <>
                  Measure, in the 3D view's toolbar, shows the tapped spot's distances to the face's edges and
                  center.
                </>
              ) : (
                <>
                  Hold <kbd className="holes-key">⌥ Option</kbd> (or turn on Measure in the 3D view's toolbar)
                  to see the pointed-at spot's distances to the face's edges and center.
                </>
              )}
            </p>
            <label
              className="field bench-offset-field holes-inset-field"
              title="While measuring, a system's next holes around the selected one: snap points one step away in every direction, to drill the next hole of a Gridfinity bin, a Skådis board or a MOD-GRID grid at once. Each new hole is selected, so the points move on with it."
            >
              <span className="field-label">Measure spacing</span>
              <select
                value={pitchId ?? ""}
                onChange={(e) => {
                  setPitchId(e.target.value || null);
                  // As the Grid menu does: the arrow keys pressed next nudge
                  // the selected hole, which a focused select would take.
                  e.target.blur();
                }}
              >
                <option value="">None</option>
                {STANDARD_SPACINGS.map((spacing) => (
                  <option key={spacing.id} value={spacing.id}>
                    {spacingLabel(spacing)}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="field bench-offset-field holes-inset-field"
              title="A circle of this radius around the face center — a bolt circle. Snap points where it crosses the center lines and the radials; a click near it lands on it. 0 draws none."
            >
              <span className="field-label">Center radius (mm)</span>
              <DecimalInput
                min="0"
                step="0.5"
                value={radius}
                onChange={(value) => setRadius(Math.max(0, value))}
              />
            </label>

            <h3>
              {multi
                ? `${selectedHoles.length} holes`
                : selected
                  ? `Hole ${doc.holes.indexOf(selected) + 1}`
                  : "New holes"}
            </h3>
            {multi ? (
              <p className="muted holes-editor-note">
                {shared.kind
                  ? "Changes apply to all of them; fields they don't share say mixed. Shift-click to add or remove a hole."
                  : "Holes of different kinds share no fields: pick a preset to make them one kind, or select one kind."}
              </p>
            ) : selected ? (
              <p className="muted holes-editor-note">
                {selectedPreset ? selectedPreset.name : "Custom"}
                {selectedPreset && !specMatchesPreset(selected.spec, selected.presetId) ? " (edited)" : ""} at
                [{formatPoint(selected.point)}]. Changes apply to this hole, and to the holes you place next.
              </p>
            ) : (
              <p className="muted holes-editor-note">
                The screw — or connector slot — every new hole is made for: the one picked or edited last.
                Select a hole to change it.
              </p>
            )}
            <PresetPicker value={editingPresetId} onPick={pickPreset} />
            {multi ? (
              shared.kind && (
                <HoleSpecFields
                  // A new set of holes is a new form: the "last blind depth"
                  // memory belongs to the holes it was typed for.
                  key={selectedIds.join(",")}
                  spec={shared.spec}
                  mixed={shared.mixed}
                  onChange={patchSelection}
                  onRotate={rotateSelection}
                  count={selectedHoles.length}
                />
              )
            ) : (
              <HoleSpecFields spec={editingSpec} onChange={patchSelection} onRotate={rotateSelection} />
            )}
            {/* Always there (disabled with nothing selected), so selecting a
                hole doesn't push the list below it down under the pointer
                mid Shift-click. */}
            <div className="holes-selected-actions">
              <button
                type="button"
                className="render-button holes-small-button"
                onClick={() => setRepeatOpen((open) => !open)}
                disabled={!selected}
                aria-expanded={Boolean(selected) && repeatOpen}
                title="Copies of this hole in a row, a grid or round a circle on its face"
              >
                Repeat…
              </button>
              <button
                type="button"
                className="render-button holes-small-button holes-delete-button"
                onClick={() => deleteHoles(selectedIds)}
                disabled={selectedHoles.length === 0}
              >
                {multi ? `Delete ${selectedHoles.length} holes` : "Delete hole"}
              </button>
            </div>
            {repeatResult && (
              <RepeatFields
                options={repeatOptions}
                onChange={(patch) => setRepeatOptions((o) => ({ ...o, ...patch }))}
                placed={repeatResult.ids.length - 1}
                skipped={repeatResult.skipped}
                onApply={applyRepeat}
                onCancel={() => setRepeatOpen(false)}
              />
            )}

            <div className="holes-list-heading">
              <h3>Holes ({doc.holes.length})</h3>
              <button
                type="button"
                className="holes-select-all"
                onClick={() => setSelectedIds(doc.holes.map((h) => h.id))}
                disabled={doc.holes.length === 0 || selectedHoles.length === doc.holes.length}
                title="Select every hole, to edit or delete them together"
              >
                Select all
              </button>
            </div>
            {doc.holes.length === 0 && <p className="muted">None yet — click a face in the scene.</p>}
            <ul className="holes-list">
              {doc.holes.map((h, i) => (
                <HoleRow
                  key={h.id}
                  hole={h}
                  number={i + 1}
                  selected={selectedIds.includes(h.id)}
                  onPick={pickRow}
                  onRemove={removeRow}
                />
              ))}
            </ul>

            <h3>Export</h3>
            <div className="bench-export">
              <button
                type="button"
                className="download-button bench-export-button"
                onClick={downloadStl}
                disabled={status === "error"}
              >
                Download STL
              </button>
              <button
                type="button"
                className="download-button bench-export-button layerling-button"
                onClick={copyToLayerling}
                disabled={status === "error" || layerling.copying}
                title={LAYERLING_COPY_TITLE}
              >
                {layerling.label}
              </button>
              <button
                type="button"
                className="download-button bench-export-button layerling-button print-button"
                onClick={openPrintSheet}
                disabled={status === "error"}
                title="Share or save the file and open Prusa's EasyPrint, which slices and prints it from a phone"
              >
                Print with EasyPrint…
              </button>
              {/* Rarely wanted, so a link under the buttons rather than one of them. */}
              <button
                type="button"
                className="bench-export-link"
                onClick={downloadScad}
                title="The base and the holes as OpenSCAD source"
              >
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
              <p
                className="outside-dimensions"
                aria-label={`Outside dimensions: width ${dimensions.width} millimetres, height ${dimensions.height} millimetres, depth ${dimensions.depth} millimetres`}
              >
                Outside: W {dimensions.width} × H {dimensions.height} × D {dimensions.depth} mm
              </p>
            )}
            {/* Fixed at two lines (styles.css .holes-note): a hint that
                changed height here would resize the viewer under the
                pointer and make the model jump. Each text, " Rendering…"
                included, fits two lines at the note's 60ch; a longer one
                is cut short there. So they leave out what is said
                elsewhere: the model's name (the sidebar's heading), and,
                once several are selected, that Shift-click adds or removes
                one (the sidebar's note, and this hint before it). The
                snap-point hint is a chip over the viewer for the same
                reason. */}
            <p className="print-note holes-note" aria-live="polite">
              {multi ? (
                <>
                  {selectedHoles.length} holes selected — edit them together in the sidebar; arrows nudge
                  them, Delete removes them, Esc deselects.
                </>
              ) : selected ? (
                <>
                  Hole {doc.holes.indexOf(selected) + 1} selected — drag its handles to resize or move it, or
                  edit it in the sidebar; arrows nudge it, Delete removes it, Esc deselects.
                </>
              ) : doc.holes.length === 0 ? (
                coarse ? (
                  <>
                    Tap a face for its guides, then tap again to drill a hole; a tap near a snap point lands
                    on it. Measure shows distances; Snapping off places freely.
                  </>
                ) : (
                  <>
                    Click a face to drill a hole. Hover for snap points and guides, hold Option for distances;
                    Shift-click places freely.
                  </>
                )
              ) : coarse ? (
                <>
                  {doc.holes.length} hole{doc.holes.length === 1 ? "" : "s"}. Tap a face to drill another (a
                  new face shows its guides first), a hole to select it; press and hold one in the list to
                  select several.
                </>
              ) : (
                <>
                  {doc.holes.length} hole{doc.holes.length === 1 ? "" : "s"}. Hover for snap points and
                  guides, hold Option for distances; Shift-click places freely, or on a hole selects several.
                </>
              )}
              {status === "rendering" && " Rendering…"}
            </p>
          </div>
        </header>
        <div className="viewer-panel bench-viewer">
          {/* A refused move or nudge says why where the snap hint goes,
              for a moment; the snap hint is only for the pointer. */}
          {notice ? (
            <div className="holes-snap-hint holes-notice" role="status">
              {notice.text}
            </div>
          ) : (
            hoveredSnap && (
              <div className="holes-snap-hint" aria-hidden="true">
                Snap: {hoveredSnap.label}
              </div>
            )
          )}
          {geometries ? (
            <StlViewer
              geometry={geometries.display}
              fitKey={fitKey}
              markers={markers}
              guides={viewerGuides}
              labels={measurements.labels}
              onMarkerClick={onMarkerClick}
              placingMode
              onSurfaceHit={onSurfaceHit}
              onSurfaceHover={onSurfaceHover}
              overlayAnchor={selectionAnchor}
              handles={handles}
              handleMode="anchored"
              ghost={pendingShown?.ghost ?? null}
              gridControl
              onHandleStart={onHandleStart}
              onHandlePreview={onHandlePreview}
              onHandleCommit={onHandleCommit}
              onHandleEnd={onHandleEnd}
              onHandleStep={onHandleStep}
              onHandleSet={onHandleSet}
              toolbar={
                <>
                  <UndoRedoButtons
                    canUndo={history.canUndo}
                    canRedo={history.canRedo}
                    onUndo={undo}
                    onRedo={redo}
                    undoLabel={history.undoLabel}
                    redoLabel={history.redoLabel}
                  />
                  <button
                    type="button"
                    className="viewer-tool viewer-measure"
                    aria-pressed={measureOn}
                    aria-label="Measure distances"
                    title="Show the pointed-at (or tapped) spot's distances to the face's edges and center — what holding Option does (M)"
                    onClick={toggleMeasure}
                  >
                    <RulerIcon />
                    <span className="viewer-tool-label">Measure</span>
                  </button>
                  {measureOn && (
                    <select
                      className="viewer-tool viewer-grid viewer-measure-spacing"
                      aria-label="Spacing"
                      title="A system's next holes round the selected one, as snap points to drill them on pitch. Picked for you when the selected hole is one of that system's."
                      value={pitchId ?? ""}
                      onChange={(e) => {
                        setPitchId(e.target.value || null);
                        e.target.blur();
                      }}
                    >
                      <option value="">Spacing: none</option>
                      {STANDARD_SPACINGS.map((spacing) => (
                        <option key={spacing.id} value={spacing.id}>
                          {spacing.short}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              }
            >
              {selectedHoles.length > 0 && (
                <div
                  className={
                    pillBelow
                      ? "bench-rotate-panel holes-pill holes-pill-below"
                      : "bench-rotate-panel holes-pill"
                  }
                >
                  <span className="bench-rotate-name">
                    {multi ? (
                      `${selectedHoles.length} holes`
                    ) : (
                      <>
                        Hole {doc.holes.indexOf(selected) + 1}
                        <span className="muted">
                          {" "}
                          · {selectedPreset ? selectedPreset.name : holeLabel(selected)}
                        </span>
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="bench-rotate-delete"
                    onClick={() => deleteHoles(selectedIds)}
                    aria-label={
                      multi
                        ? `Remove the ${selectedHoles.length} selected holes`
                        : `Remove hole ${doc.holes.indexOf(selected) + 1}`
                    }
                    title="Remove (Delete)"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                      <path
                        fill="currentColor"
                        d="M6 1.5h4a1 1 0 0 1 1 1V3h3v1.5h-1.1l-.7 9.1A1.5 1.5 0 0 1 10.7 15H5.3a1.5 1.5 0 0 1-1.5-1.4L3.1 4.5H2V3h3v-.5a1 1 0 0 1 1-1Zm.5 1.5h3v-.5h-3V3Zm-1.9 1.5.7 9h5.4l.7-9H4.6Zm1.7 1.5h1.2v6H6.3v-6Zm2.2 0h1.2v6H8.5v-6Z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="bench-rotate-close"
                    onClick={() => setSelectedIds([])}
                    aria-label="Deselect"
                    title="Deselect (Esc)"
                  >
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
          {/* On a phone the Export section is far down the page: the
              sheet is a tap away over the viewer there (styles.css shows
              this row under 900 px only). Not while an error is up: the
              error sits where the row does, and the sheet would only run
              the failing render again (the palette and Export keep it). */}
          {geometries && !(renderError || handleFailed) && (
            <div className="viewer-actions viewer-actions-mobile">
              <button type="button" className="download-button print-button" onClick={openPrintSheet}>
                Print…
              </button>
            </div>
          )}
          {(renderError || handleFailed) && (
            <p className="error-text bench-error" role="alert">
              {handleFailed && "Couldn't render that change. "}
              {renderError}
              {/* The change a handle made didn't render (a size the WASM
                  renderer can't cut, say): the way back is by the message,
                  as in the Bench, rather than a retry of the same change. */}
              {handleFailed && (
                <button type="button" className="viewer-error-undo holes-error-undo" onClick={undo}>
                  Undo {history.undoLabel ?? "it"}
                </button>
              )}
            </p>
          )}
          {renderError && status !== "rendering" && (
            <button type="button" className="render-button" onClick={preview.retry}>
              Retry preview
            </button>
          )}
        </div>
      </main>

      {printSheet && (
        <PrintSheet
          title={exportName || "Holes"}
          bodies={[
            {
              name: exportFilename(exportName, "holes", ".stl"),
              bytes: printSheet.bytes,
              error: printSheet.error,
            },
          ]}
          onClose={closePrintSheet}
        />
      )}
      {importOpen && (
        <ImportFlow mode="mesh" initialFile={importFile} onCancel={endImport} onConfirm={pickImportedMesh} />
      )}
    </div>
  );
}

// `face` with a system spacing's points (the Holes tab's `pitch`) first
// among its snap points, so one that coincides with a quadrant center or
// a corner inset reads as the system's.
function withPitch(face, pitch) {
  return { ...face, candidates: [...pitch.candidates, ...face.candidates] };
}

// Two hover records that would draw the same thing.
function sameHover(a, b) {
  if (!a || !b) return a === b;
  if (a.faceKey !== b.faceKey || a.snapId !== b.snapId) return false;
  if (!a.linePoint || !b.linePoint) return a.linePoint === b.linePoint;
  return a.linePoint.every((n, i) => n === b.linePoint[i]);
}

// The undo label of a resize: which size it changed.
function resizeLabel(hole, handle) {
  if (hole.spec.kind !== "rectangle") return "resize Ø";
  if (handle.kind === "corner") return "resize W and H";
  return handle.signs[0] ? "resize W" : "resize H";
}

// The move ghost's centre cross: a few mm, never wider than the hole.
function crossSize(hole) {
  return Math.max(1, Math.min(4, holeFootprintRadius(hole.spec)));
}

// A callback whose identity never changes and which always calls the
// latest `fn`: for the memoised sidebar rows and preset grid, which a
// pointer moving over the model (a hover state change) must not re-render.
/**
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @returns {F}
 */
function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return /** @type {any} */ (useCallback((...args) => ref.current(...args), []));
}

// The Measure toggle's ruler.
function RulerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect
        x="1.5"
        y="5.5"
        width="13"
        height="5"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M4.5 5.5v2.5M7.5 5.5v2M10.5 5.5v2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
