import { useEffect, useMemo, useRef, useState } from "react";
import ImportFlow from "./components/bench/ImportFlow.jsx";
import JointSelect from "./components/bench/JointSelect.jsx";
import NameBenchModal from "./components/bench/NameBenchModal.jsx";
import NodeTree from "./components/bench/NodeTree.jsx";
import PresetsPanel from "./components/bench/PresetsPanel.jsx";
import SpinButtons from "./components/SpinButtons.jsx";
import ParamsEditor from "./components/ParamsEditor.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import SidebarResizer from "./components/SidebarResizer.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import UndoRedoButtons from "./components/UndoRedoButtons.jsx";
import {
  MAX_ATTACHED,
  ROOT_ID,
  addChild,
  benchName,
  bodyTags,
  canAttach,
  childrenOf,
  compileToScad,
  createAssembly,
  descendantIds,
  getNode,
  moveChild,
  occupiedSlotNames,
  removeChild,
  rotateChild,
  screwedApplies,
  setAssemblyName,
  setCropTo,
  updateChildJoint,
  updateChildOverlap,
  updateChildShift,
  updateChildSpin,
  updateNodeParams,
} from "./lib/assembly.js";
import { useGlobalOverrides } from "./hooks/useGlobalOverrides.js";
import { useRender } from "./hooks/useRender.js";
import { useBenchHistory } from "./hooks/useBenchHistory.js";
import { useBenchPresets } from "./hooks/useBenchPresets.js";
import { useBenchSession } from "./hooks/useBenchSession.js";
import { useUndoShortcuts } from "./hooks/useUndoShortcuts.js";
import { useCommandDrop, useCommandHome, useCommands } from "./hooks/useCommands.js";
import { useFileDrop } from "./hooks/useFileDrop.js";
import { useHiddenLibrary } from "./hooks/useHiddenLibrary.js";
import { useSystemOrder } from "./hooks/useSystemOrder.js";
import { partSections } from "./lib/catalogueUtils.js";
import { LAYERLING_COPY_TITLE, useLayerlingCopy } from "./hooks/useLayerlingCopy.js";
import { CONFIG_EXTENSION, configToJson, parseBenchConfig, serializeBenchConfig } from "./lib/benchConfig.js";
import {
  centeredToWorld,
  parseMarkerId,
  rootSlots,
  sceneMarkers,
  slotFootprint,
  slotInDirection,
} from "./lib/benchLayout.js";
import { defaultBenchName, exportFilename } from "./lib/benchName.js";
import { builtin, partCommand } from "./lib/commandCatalog.js";
import { chordText } from "./lib/shortcuts.js";
import { boxTopCenter, nodeWorldBoxes, pickNodeAt } from "./lib/benchPick.js";
import { deletePreset, savePreset } from "./lib/benchPresets.js";
import {
  NO_EXTENTS,
  guardNote,
  guardResize,
  mergeExtents,
  resizeGhost,
  rootBoxFor,
  sameParams,
} from "./lib/benchResize.js";
import {
  getBenchSession,
  loadBenchConfig,
  redoBench,
  replaceBenchSession,
  setBenchAssembly,
  setBenchImportedParts,
  undoBench,
} from "./lib/benchSession.js";
import { downloadBlob } from "./lib/download.js";
import { ignoresShortcut, isBehindOpenDialog } from "./lib/isEditableTarget.js";
import { meshExtents } from "./lib/meshExtents.js";
import { outsideDimensions } from "./lib/outsideDimensions.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { friendlyRenderError } from "./lib/renderError.js";
import {
  axisLetter,
  dragResize,
  handlesForBox,
  mirrorHandleId,
  resizeAxes,
  resizeText,
  stepResize,
  typedResize,
  viewerHandles,
} from "./lib/resize.js";
import { fitGridCounts } from "./lib/slots.js";
import { getGridSnap } from "./lib/uiPrefs.js";
import { getOverrides, resolveAttachedParams, resolveParams } from "./lib/userOverrides.js";
import { uprightSpin } from "./lib/benchOrientation.js";

// Debounce between the last assembly edit and the re-render it triggers,
// so typing a parameter value doesn't compile once per keystroke.
const RENDER_DEBOUNCE_MS = 250;

// A root part without resize axes: one array for every render, so the
// memos that follow the axes don't rebuild on each of them.
/** @type {import("./lib/resize.js").ResizeAxis[]} */
const NO_AXES = [];

// Arrow keys step the selected part to the next open slot that way,
// in root's own x/y frame (see nudgeSelected()).
const ARROW_DIRECTIONS = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

// compileToScad() for one tree and parts map, memoised on both (each is
// immutable: every edit makes a new tree, every import a new Map). The
// preview looks its result up in the render cache on every edit before
// any render starts, and the render itself, or an export, would otherwise
// compile the same tree again. A throw (a part missing from the
// catalogue, a pin joint without the pin) is kept as well and handed back
// where the render runs, so it still becomes that render's error rather
// than an exception in the middle of React's commit.
const compiledTrees = new WeakMap();
function compiledTree(assembly, partsById) {
  const hit = compiledTrees.get(assembly);
  if (hit?.partsById === partsById) return hit;
  const importedFiles = new Map();
  let entry;
  try {
    const scadSource = compileToScad(assembly, partsById, importedFiles);
    entry = { partsById, scadSource, importedFiles, error: null };
  } catch (error) {
    entry = { partsById, scadSource: null, importedFiles, error };
  }
  compiledTrees.set(assembly, entry);
  return entry;
}

// One body of an assembly as STL — `tag` picks it ("all", "root", or a
// joint child's own id; see assembly.js's bodyTags()). The generated
// source is the same for every tag; only the -D part= selector differs.
function renderBody(assembly, partsById, globalOverrides, tag, options) {
  const { scadSource, importedFiles, error } = compiledTree(assembly, partsById);
  if (error) return Promise.reject(error);
  return renderPart({ scadSource, part: tag, importedFiles, globalOverrides }, options);
}

// The whole assembly's render if the cache still has it (an undo back to
// a bench rendered before, the bench's name typed — the name isn't in the
// source), so it shows at once with no "rendering" state; null for a tree
// that doesn't compile, whose render then reports why.
function cachedPreview({ assembly, partsById, globalOverrides }) {
  const { scadSource, importedFiles, error } = compiledTree(assembly, partsById);
  if (error) return null;
  return getCachedRender({ scadSource, part: "all", importedFiles, globalOverrides });
}

// The Bench: a root part, parts attached to its slots (and theirs), one
// preview of the whole assembly. Any part, the root too, is selected by
// clicking it in the scene (where its place is known: benchPick.js) or
// its name in the sidebar ("Select root" for the root). A selected root
// whose catalogue entry has `resize` gets TinkerCAD's handles
// (lib/resize.js, as in the Library): a drag shows a ghost of the new size
// and commits one parameter change on release, which never takes a slot
// out from under an attached part (lib/benchResize.js's guard). Attached
// parts are resized in the sidebar for now — their boxes are padded, not
// exact, so handles on them would sit off their faces. Every change to
// the bench, Start over and a loaded config included, is a step in its
// undo history (lib/benchSession.js, which outlives this component).
/**
 * @param {{ parts: any[], sidebarCollapsed: boolean, onToggleSidebar: () => void }} props
 */
export default function Bench({ parts, sidebarCollapsed, onToggleSidebar }) {
  const globalOverrides = useGlobalOverrides();
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  // The tree and the imported meshes live in lib/benchSession.js, not
  // here: this component unmounts whenever the Library tab is up, and the
  // bench has to survive that (and App.jsx mirrors it into the URL). The
  // setters take a value or an updater, so the edits below read as before.
  // `assembly` is null until a root is chosen; `notice` is App's message
  // when a bench in the URL couldn't be restored (shown like a config
  // error, below).
  const session = useBenchSession();
  const { assembly, importedParts, notice } = session;
  const setAssembly = setBenchAssembly;
  const setImportedParts = setBenchImportedParts;
  const partsById = useMemo(
    () => new Map([...catalogueById, ...importedParts]),
    [catalogueById, importedParts],
  );

  // Each node's own measured extents (node id, "root" or a child's ->
  // [x,y,z]) and the parameters they were measured with — benchResize.js's
  // NodeExtents. The parameters say whether a node's extents are still its
  // own: after a resize they are the old size until the new render lands.
  const [measured, setMeasured] = useState(NO_EXTENTS);
  const nodeExtents = measured.extents;
  const [pendingSlot, setPendingSlot] = useState(null); // { parentId, slotName } awaiting a part choice
  const [pendingJoint, setPendingJoint] = useState("fused");
  const [importMode, setImportMode] = useState(null); // null | "root" | "child"
  // A model file the user already gave the import flow — dropped on a part
  // picker, the empty tab or the palette — which it reads as it opens.
  const [importFile, setImportFile] = useState(null);
  // An export waiting for the bench to be named: the function to run with
  // the name, once NameBenchModal has one (see withName()). Null otherwise.
  const [pendingExport, setPendingExport] = useState(null);
  // The selected node — picked by clicking the part in the scene or its
  // name in the sidebar ("Select root" for the root). An attached part
  // gets its rotate, move and delete controls; the root its handles and
  // Crop only: there's nothing to spin it against or move it to, and
  // removing it would remove everything.
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  // "Move" is armed for the selected part: the next open marker clicked
  // re-seats it there instead of opening the attach picker. Only
  // meaningful while something is selected; every selection change
  // (selectNode()) disarms it.
  const [moveMode, setMoveMode] = useState(false);
  // Bumped by "Retry preview", so the nodes' own extents are tried again
  // along with the assembly render (useRender's retry()).
  const [extentsRetry, setExtentsRetry] = useState(0);
  // Saved setups (lib/benchPresets.js) and whatever the last config
  // load/save had to complain about — shown in the presets panel, on the
  // start screen or in the sidebar, whichever is up, with the session's
  // own restore `notice` as the fallback.
  const presets = useBenchPresets();
  const [configError, setConfigError] = useState(null);
  const shownError = configError ?? notice;
  // The last handle commit on the root: the root parameters it set (the
  // very object, so any other change to them — a sidebar edit, an undo —
  // no longer matches), the tree it made and the printer settings it
  // rendered with (an edit to a child keeps the root's parameters, a
  // Settings change the whole tree, and neither render is the commit's),
  // the box it predicts, and the ghost shown until the assembly's render
  // for it lands. `key` is its
  // undo step's coalescing key (a run of arrow presses shares one) and
  // `from` the box its label counts from (see onHandleStep()).
  const [pending, setPending] = useState(null);
  // Why the guard changed or refused the last arrow step or typed size on
  // a handle ("3 would move attached parts"), for the handles'
  // aria-valuetext and hover readout: { params (the root parameters it is
  // about, as `pending`), axes, text }. It explains that one gesture, so
  // it goes when the handle loses focus, another gesture starts, the
  // selection changes or the parameters do. A drag sets none: its label
  // said so while it ran, and a mouse user's handle has no focus to lose,
  // so the note would hang on until the next edit.
  const [guardStep, setGuardStep] = useState(null);
  // The tree a handle drag or a typed size committed: it renders at once,
  // its root's own extents first, instead of waiting out the typing
  // debounce. Read by the effects that schedule those renders.
  const immediateTree = useRef(null);
  // The sidebar, for revealing a node's parameters (revealParams()).
  const sidebarRef = useRef(null);

  // Undo and redo (lib/benchSession.js). A step can take away the
  // selected part, so the selection (and an armed Move) goes with it.
  const history = useBenchHistory();
  function afterHistoryStep(took) {
    if (!took) return;
    setPending(null);
    setGuardStep(null);
    const restored = getBenchSession().assembly;
    if (selectedNodeId && !(restored && getNode(restored, selectedNodeId))) selectNode(null);
  }
  const undo = () => afterHistoryStep(undoBench());
  const redo = () => afterHistoryStep(redoBench());
  useUndoShortcuts({ onUndo: undo, onRedo: redo });

  // The Bench's own keys, one listener for the component's lifetime that
  // reads the latest handler through a ref (the handler closes over this
  // render's state and helpers). App.jsx's own keydown handler covers
  // Settings and mode-switching; this one is local because the state it
  // acts on is local too.
  //
  // Escape backs out of whichever is up — the import flow first (it's on
  // top when both are technically "open"), then the attach-a-part picker,
  // then the name-before-export ask, then move mode, then the selection.
  // The rest act on the selected part, and only with no modal up (the
  // Bench's own or anyone else's), no Cmd/Ctrl/Alt held and the key not
  // meant for a field (lib/isEditableTarget.js's ignoresShortcut()):
  // Delete/Backspace removes it (subtree and all, like the sidebar's ✕),
  // M arms/disarms move mode, an arrow key steps it to the next open slot
  // that way — none of them for the root, which is never removed, moved
  // or stepped. Escape with someone else's dialog up (Settings) is left to
  // that dialog. A key something nearer its target already took (a
  // focused resize handle's arrows, the View menu's Esc) is theirs.
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      if (importMode) endImport();
      else if (pendingSlot) setPendingSlot(null);
      else if (pendingExport) setPendingExport(null);
      // Someone else's dialog (Settings) is up: Escape is for closing that.
      else if (isBehindOpenDialog()) return;
      else if (moveMode) setMoveMode(false);
      else if (selectedNodeId) selectNode(null);
      return;
    }
    if (importMode || pendingSlot || pendingExport || !assembly || ignoresShortcut(e)) return;
    if (!selectedNodeId || !getNode(assembly, selectedNodeId)) return;
    // removeChild(root) would take every node with it, and the root has
    // no slot to move or step to.
    if (selectedNodeId === ROOT_ID) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault(); // Backspace is "back" in some browsers
      removeSelected();
    } else if (e.key === "m" || e.key === "M") {
      setMoveMode((armed) => !armed);
    } else if (e.key in ARROW_DIRECTIONS) {
      e.preventDefault(); // not a page scroll
      nudgeSelected(ARROW_DIRECTIONS[e.key]);
    }
  };
  useEffect(() => {
    const onKeyDown = (e) => keyHandlerRef.current?.(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const rootPart = assembly ? partsById.get(assembly.root.partId) : null;
  // Whether another part may be attached (assembly.js's MAX_ATTACHED).
  // When not, nothing that would attach one is offered: no markers
  // outside move mode, no "+ Attach" buttons in the tree, and the header
  // says why.
  const roomToAttach = assembly ? canAttach(assembly) : false;

  // Every node's own standalone bounding box (its part rendered alone,
  // with its own params, no attach() context) — needed to enumerate
  // that node's own slots. A node's position elsewhere in the tree
  // never changes its own size, so this is exactly the same computation
  // for root and for any descendant. Cached by (file, module, params)
  // in openscad-client, and the parse of the result is memoised per
  // buffer in meshExtents(), so re-deriving nodes nothing changed about
  // on every assembly edit is two lookups, not a compile and a parse.
  //
  // A parameter being typed is the exception: each keystroke gives the
  // edited node params nobody has rendered yet, and its standalone
  // render is a full compile — queued, in the worker's FIFO, ahead of
  // the assembly render the edit is really for. So when any node needs
  // a real render, wait out the same debounce the assembly render uses
  // (typing "20" then costs one render of 20, not one of 2 and one of
  // 20); when every node is already in the cache — a rotate, a joint or
  // offset change, a move, a crop — resolve at once, as before. A handle
  // commit (immediateTree) is a finished change, not typing: its renders
  // start at once too, the root's own first, so the handles move onto its
  // measured box before the assembly lands.
  //
  // Each entry keeps the parameters it was measured with, and a round that
  // measures every node as before keeps the old state object
  // (benchResize.js's mergeExtents()), so the markers, boxes and slot
  // lists built from it don't rebuild on an edit that resized nothing.
  useEffect(() => {
    if (!assembly) {
      setMeasured(NO_EXTENTS);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let timer = null;
    const allNodes = [
      { id: ROOT_ID, partId: assembly.root.partId, params: assembly.root.params },
      ...assembly.nodes,
    ];
    const requestFor = (part, node) => ({
      scadFile: part.file,
      module: part.module,
      params: node.params,
      globalOverrides,
    });
    const compute = async () => {
      // allSettled, not all: one node's own standalone render hitting
      // the known openscad-wasm resource limit (see renderError.js
      // — the same WASM build the main assembly render already works
      // around) shouldn't cost every OTHER node its markers too, and
      // shouldn't surface as an unhandled rejection either.
      const results = await Promise.allSettled(
        allNodes.map(async (n) => {
          const part = partsById.get(n.partId);
          if (part.kind === "imported") return [n.id, part.extents, n.params];
          const stl = await renderPart(requestFor(part, n), { signal: controller.signal });
          return [n.id, meshExtents(stl), n.params];
        }),
      );
      if (cancelled) return;
      const entries = [];
      for (const result of results) {
        if (result.status === "fulfilled") entries.push(result.value);
        else if (result.reason?.name !== "AbortError")
          console.warn("Bench: couldn't get this node's own extents (its slots won't show):", result.reason);
      }
      setMeasured((prev) => mergeExtents(prev, entries));
    };
    const allCached = allNodes.every((n) => {
      const part = partsById.get(n.partId);
      return part.kind === "imported" || getCachedRender(requestFor(part, n)) !== null;
    });
    if (allCached || immediateTree.current === assembly) compute();
    else timer = setTimeout(compute, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [assembly, partsById, globalOverrides, extentsRetry]);

  // Re-render the whole assembly (debounced) whenever it changes. No
  // assembly ("Start over") drops the old bench's mesh and outside
  // dimensions now, not when (or if) the next root's render replaces them.
  const renderKey = useMemo(
    () => (assembly ? { assembly, partsById, globalOverrides } : null),
    [assembly, partsById, globalOverrides],
  );
  const preview = useRender(
    renderKey,
    (key, signal) => renderBody(key.assembly, key.partsById, key.globalOverrides, "all", { signal }),
    {
      delay: (key) => (key.assembly === immediateTree.current ? 0 : RENDER_DEBOUNCE_MS),
      cached: cachedPreview,
      formatError: (err) =>
        err.name === "AbortError" ? "Render cancelled." : friendlyRenderError(err.message),
    },
  );
  const stlBuffer = preview.result;
  const { status, error: renderError, setError: setRenderError } = preview;

  const rootExtents = nodeExtents.get(ROOT_ID) ?? null;
  const dimensions = useMemo(
    () => (stlBuffer ? outsideDimensions(meshExtents(stlBuffer)) : null),
    [stlBuffer],
  );

  const allSlots = useMemo(
    () => rootSlots(rootPart, assembly?.root.params, rootExtents),
    [rootPart, rootExtents, assembly?.root.params],
  );

  const occupied = useMemo(() => (assembly ? occupiedSlotNames(assembly, ROOT_ID) : new Set()), [assembly]);
  const openSlots = useMemo(() => allSlots.filter((s) => !occupied.has(s.name)), [allSlots, occupied]);

  // Every root slot's world position, occupied or not — a deeper node's
  // own exposed "bot" marker needs this even when the root slot it (or
  // an ancestor of it) attaches through is already taken.
  const rootSlotWorldPositions = useMemo(() => {
    const m = new Map();
    if (!rootExtents) return m;
    for (const s of allSlots) m.set(s.name, centeredToWorld(s.point, rootExtents));
    return m;
  }, [allSlots, rootExtents]);

  const markers = useMemo(
    () =>
      sceneMarkers({
        assembly,
        partsById,
        openRootSlots: openSlots,
        rootExtents,
        rootSlotWorldPositions,
        nodeExtents,
      }),
    [assembly, partsById, openSlots, rootExtents, rootSlotWorldPositions, nodeExtents],
  );

  // In move mode the markers are the places the selected part can go, so
  // the ones standing on the part itself or anything attached to it
  // (its own open "bot", a stacked child's) are left out — moveChild()
  // would refuse those anyway, but a marker that does nothing is worse
  // than no marker. Outside move mode a marker means "attach here", so
  // a full bench shows none at all.
  const shownMarkers = useMemo(() => {
    if (!assembly) return markers;
    if (!moveMode || !selectedNodeId) return roomToAttach ? markers : [];
    const subtree = descendantIds(assembly, selectedNodeId).add(selectedNodeId);
    return markers.filter((m) => !subtree.has(parseMarkerId(m.id).parentId));
  }, [markers, moveMode, selectedNodeId, assembly, roomToAttach]);

  // Where each node's body is, for click-to-select and the selection
  // outline — only the nodes whose place can be known without redoing
  // BOSL2's rotation (see benchPick.js); the rest select from the sidebar.
  const nodeBoxes = useMemo(
    () => nodeWorldBoxes({ assembly, partsById, rootSlotWorldPositions, nodeExtents }),
    [assembly, partsById, rootSlotWorldPositions, nodeExtents],
  );

  // --- The root's resize handles ---------------------------------------------
  // Only the root's for now: it is placed exactly (centred, unrotated), so
  // its box is its faces. An attached part's box is padded for spin,
  // shift and mount offsets (benchPick.js), and handles on it would sit off
  // the faces they stand for.
  const rootSelected = !!assembly && selectedNodeId === ROOT_ID;
  const rootParams = assembly?.root.params ?? null;
  const rootFullParams = useMemo(
    () => (rootPart ? { ...(rootPart.defaults ?? {}), ...rootParams } : null),
    [rootPart, rootParams],
  );
  const rootAxes = useMemo(() => {
    const axes = rootPart && rootPart.kind !== "imported" ? resizeAxes(rootPart, rootFullParams) : [];
    return axes.length ? axes : NO_AXES;
  }, [rootPart, rootFullParams]);
  const pendingCurrent = pending && rootParams === pending.params ? pending : null;
  // The box the handles stand on, for the root's current parameters only
  // — a box from older ones would start a drag from the wrong size and run
  // the children guard against the wrong slots. Measured (the root's own
  // render, as the markers use) when that was rendered for these
  // parameters; else that render straight from the cache when it exists
  // but the measurement hasn't caught up (an undo back to a size rendered
  // before: read now, so a focused handle survives the undo); else, while
  // a handle commit renders, the box it predicted. None on a failed
  // render: the error and its Undo take the handles' place. (The render
  // status is applied outside the memo, so the box — and the handles,
  // outline and fit box built on it — keep their identity as renders
  // start and land.)
  const rootBox = useMemo(() => {
    if (!rootSelected || !rootAxes.length) return null;
    const extents = measured.extents.get(ROOT_ID);
    if (extents && sameParams(measured.params.get(ROOT_ID), rootParams)) return rootBoxFor(extents);
    const cached = getCachedRender({
      scadFile: rootPart.file,
      module: rootPart.module,
      params: rootParams,
      globalOverrides,
    });
    if (cached) return rootBoxFor(meshExtents(cached));
    return pendingCurrent?.box ?? null;
  }, [rootSelected, rootAxes, measured, rootParams, rootPart, globalOverrides, pendingCurrent]);
  const handleBox = status === "error" ? null : rootBox;
  // A guard note about these root parameters goes on the handles of the
  // axes it is about, so a screen reader hears why a step jumped or didn't
  // move ("… — 3 would move attached parts").
  const guardShown = guardStep && guardStep.params === rootParams ? guardStep : null;
  const rootHandles = useMemo(() => {
    if (!handleBox) return undefined;
    const handles = viewerHandles(handleBox, rootAxes, rootFullParams);
    if (!guardShown) return handles;
    return handles.map((h) =>
      h.axes.some((key) => guardShown.axes.includes(key))
        ? { ...h, valueText: `${h.valueText} — ${guardShown.text}` }
        : h,
    );
  }, [handleBox, rootAxes, rootFullParams, guardShown]);
  // The pending ghost stays while the assembly renders for the committed
  // size; a landed render, a cancel (idle), an error or any other change —
  // to the root's parameters, elsewhere in the tree (a child's offset) or
  // to the printer settings — ends it. A failed one offers its Undo only
  // under the same terms: after a later edit elsewhere the Undo would take
  // back that edit, not the size, and the error may be that edit's.
  const pendingRendered =
    !!pendingCurrent &&
    pendingCurrent.tree === assembly &&
    pendingCurrent.globalOverrides === globalOverrides;
  const pendingShown = pendingRendered && status === "rendering" ? pendingCurrent : null;
  const handleFailed = pendingRendered && status === "error";
  // The viewer's Grid select, for a selected root with a free length to
  // drag. It follows the selection, not the handles: they drop out for a
  // moment after a sidebar edit (until the root's new size is measured)
  // or on a failed render, and the select would jump the toolbar, or close
  // under the pointer, with them.
  const gridShown = rootSelected && rootAxes.some((a) => !a.step);

  // What a drag started from, for its previews and its commit: the box
  // and full parameters at pointerdown and the slots the root's children
  // sit on, whatever renders land meanwhile.
  const dragStart = useRef(null);
  const findHandle = (id) => rootHandles?.find((h) => h.id === id) ?? null;
  const gestureFrom = (handle) => ({
    handle,
    box: handleBox,
    params: rootFullParams,
    axes: rootAxes,
    occupied,
  });

  // A resize through the children guard, with the label that says what it
  // will commit and, when the guard stepped in, why. The label's change
  // counts from `from`: the gesture's start box, or where a run of arrow
  // presses started. Null for no change.
  function guarded(start, result, gridMm, from = start.box) {
    const out = guardResize({
      part: rootPart,
      axes: start.axes,
      handle: start.handle,
      box: start.box,
      startParams: start.params,
      occupied: start.occupied,
      result,
      gridMm,
    });
    if (!out.result) return null;
    const note = guardNote(out.refused);
    const text = resizeText(start.handle, start.axes, from, out.result);
    return { result: out.result, note, text: note ? `${text} — ${note}` : text };
  }

  // One handle change, from a drag, a key or a typed size: an undo step
  // (a run of arrow presses on one handle is one), the changed values
  // merged into the root's current parameters, and the ghost of the new
  // size until its render lands. A change the guard kept at the start
  // value commits nothing; for a key or a typed size the handle's readout
  // says why (`noted`), a drag's label already did.
  function commitResize(start, change, { immediate, key = null, from = start.box, noted = true }) {
    if (!change) return;
    const noteFor = (params) =>
      noted && change.note ? { params, axes: start.handle.axes, text: change.note } : null;
    if (!Object.keys(change.result.params).length) {
      setGuardStep(noteFor(rootParams));
      return;
    }
    nodeActions.setParams(
      ROOT_ID,
      { ...rootParams, ...change.result.params },
      { key, label: `resize ${start.handle.axes.map(axisLetter).join(" and ")}` },
    );
    const next = getBenchSession().assembly;
    if (!next || next === assembly) return;
    immediateTree.current = immediate ? next : null;
    setGuardStep(noteFor(next.root.params));
    setPending({
      params: next.root.params,
      tree: next,
      globalOverrides,
      box: change.result.box,
      key,
      from,
      ghost: {
        ...resizeGhost(start.handle, start.axes, change.result.box),
        text: `${change.text} · rendering…`,
      },
    });
  }

  const onHandleStart = (id) => {
    const handle = findHandle(id);
    dragStart.current = handle && handleBox ? gestureFrom(handle) : null;
    setGuardStep(null);
  };
  const dragChange = (id, point) => {
    const start = dragStart.current;
    if (!start || start.handle.id !== id) return null;
    const gridMm = getGridSnap();
    const result = dragResize({
      handle: start.handle,
      axes: start.axes,
      box: start.box,
      startParams: start.params,
      point,
      gridMm,
    });
    const change = guarded(start, result, gridMm);
    return change && { start, change };
  };
  const onHandlePreview = (id, point) => {
    const drag = dragChange(id, point);
    if (!drag) return null;
    const { start, change } = drag;
    // The dragged handle and its mirror ride on the ghost.
    /** @type {Record<string, number[]>} */
    const handlePoints = {};
    for (const h of handlesForBox(change.result.box, start.axes)) {
      if (h.id === id || h.id === mirrorHandleId(id)) handlePoints[h.id] = h.point;
    }
    return { ...resizeGhost(start.handle, start.axes, change.result.box), text: change.text, handlePoints };
  };
  const onHandleCommit = (id, point) => {
    const drag = dragChange(id, point);
    if (drag) commitResize(drag.start, drag.change, { immediate: true, noted: false });
  };
  const onHandleStep = (id, steps, modifiers) => {
    const handle = findHandle(id);
    if (!handle || !handleBox) return;
    const start = gestureFrom(handle);
    // Shift is ten steps of a length; ten Gridfinity units would be 420 mm.
    const free = handle.axes.every((key) => !rootAxes.find((a) => a.axis === key)?.step);
    const gridMm = getGridSnap();
    const result = stepResize({
      handle,
      axes: rootAxes,
      box: handleBox,
      startParams: rootFullParams,
      steps: steps * (modifiers.shiftKey && free ? 10 : 1),
      gridMm,
    });
    // Held or repeated presses wait for the usual debounce and make one
    // undo step, keyed like typing into the same parameter's field.
    const param = rootAxes.find((a) => a.axis === handle.axes[0])?.param;
    const key = `params:${ROOT_ID}:${param}`;
    // ...and one render, so the pending label counts the run's change, not
    // the last press's: while the handles still stand on the box the run's
    // previous press predicted (nothing rendered since), from the box the
    // run started on ("+0.75 each side" after three presses, not "+0.25").
    const runFrom =
      pendingCurrent && pendingCurrent.key === key && rootBox === pendingCurrent.box
        ? pendingCurrent.from
        : handleBox;
    commitResize(start, guarded(start, result, gridMm, runFrom), {
      immediate: false,
      key,
      from: runFrom,
    });
  };
  const onHandleSet = (id, mm) => {
    const handle = findHandle(id);
    if (!handle || !handleBox) return;
    const start = gestureFrom(handle);
    const result = typedResize({ handle, axes: rootAxes, box: handleBox, startParams: rootFullParams, mm });
    commitResize(start, guarded(start, result, 0), { immediate: true });
  };

  // The current assembly's body `tag` as one STL (renderBody()).
  function renderAssembly(tag, options) {
    return renderBody(assembly, partsById, globalOverrides, tag, options);
  }

  function pickRoot(part) {
    // catalogue default -> saved user override -> (no instance value yet) —
    // same resolution as Library mode, so "gridfinity should always have
    // magnet holes on" applies here too. A no-op for an imported part
    // (no catalogue defaults, no saved override under a fresh uuid id).
    setAssembly(createAssembly(part.id, resolveParams(part, {})), { label: "choose base part" });
  }

  // Finish the pending "attach to this slot" with `partId`: a catalogue
  // part attaches via its own "mount"; an imported one via the anchor
  // the user picked in the import flow.
  function attachPending(partId, params, childAnchor, spin = 0) {
    setAssembly(
      (a) =>
        addChild(a, {
          parentId: pendingSlot.parentId,
          partId,
          params,
          slotName: pendingSlot.slotName,
          joint: pendingJoint,
          childAnchor,
          spin,
        }),
      { label: "attach part" },
    );
    setPendingSlot(null);
    setPendingJoint("fused");
  }

  function attachChild(part) {
    // ...plus the catalogue's `attached_defaults`: a part on something
    // else may be a different thing from the part on its own (an
    // openGrid connector here is just its head).
    const params = resolveAttachedParams(part, {});
    // Size a grid part to the surface it lands on (a 5x5 BitBeam plate on
    // a single Gridfinity base, 3x3 on an openGrid snap) — except for a
    // count the user's saved default for this part already pins.
    const available = slotFootprint(
      assembly,
      partsById,
      nodeExtents,
      pendingSlot.parentId,
      pendingSlot.slotName,
    );
    const fitted = fitGridCounts(part, available);
    if (fitted) {
      const pinned = getOverrides(part.id);
      for (const [key, value] of Object.entries(fitted)) {
        if (!(key in pinned)) params[key] = value;
      }
    }
    // A part with an `attached_up` axis (the openConnect head's slide
    // direction) starts turned so that axis points up when it lands on
    // a side face — the way it hangs on a wall — instead of wherever
    // BOSL2's attach() happens to leave it.
    const spin = part.attached_up
      ? (uprightSpin(assembly, partsById, pendingSlot.parentId, pendingSlot.slotName, part.attached_up) ?? 0)
      : 0;
    attachPending(part.id, params, "mount", spin);
  }

  function registerImport(importedPart) {
    setImportedParts((m) => new Map(m).set(importedPart.id, importedPart));
  }

  // The import flow, for a base part ("root") or a part on the pending
  // slot ("child"), opened on a file the user dropped, or on its own
  // chooser.
  /** @param {"root" | "child"} mode @param {File | null} [file] */
  function startImport(mode, file = null) {
    setImportFile(file);
    setImportMode(mode);
  }

  function endImport() {
    setImportMode(null);
    setImportFile(null);
  }

  function confirmRootImport(importedPart) {
    registerImport(importedPart);
    pickRoot(importedPart);
    // A bench replaced by one on a dropped model: nothing of the old one
    // stays selected.
    selectNode(null);
    endImport();
  }

  function confirmChildImport(importedPart, anchorName) {
    registerImport(importedPart);
    attachPending(importedPart.id, {}, anchorName);
    endImport();
  }

  // Every selection change goes through here so an armed "Move" never
  // outlives the part it was armed for, nor a guard note the gesture it
  // explained.
  function selectNode(id) {
    setSelectedNodeId(id);
    setMoveMode(false);
    setGuardStep(null);
  }

  // Re-seat `id` on `target` ({ parentId, slotName }) — see assembly.js's
  // moveChild() for what it refuses (the assembly comes back as it was).
  // A "screwed" joint the new parent can't take (no screw pattern on
  // either side of the seam) falls back to fused, the same rule
  // jointsFor() applies when the joint is chosen. The part stays
  // selected, so its outline and controls follow it to the new slot.
  function moveNode(id, target) {
    setAssembly(
      (a) => {
        const moved = moveChild(a, id, target);
        if (moved === a) return a;
        const node = getNode(moved, id);
        const parentPart = partsById.get(getNode(moved, target.parentId).partId);
        if (node.joint === "screwed" && !screwedApplies(parentPart, partsById.get(node.partId))) {
          return updateChildJoint(moved, id, "fused");
        }
        return moved;
      },
      { label: "move part" },
    );
    setMoveMode(false);
  }

  function removeSelected() {
    if (!selectedNodeId || selectedNodeId === ROOT_ID) return;
    nodeActions.remove(selectedNodeId);
    selectNode(null);
  }

  // Arrow keys: the selected part steps to the next open slot that way
  // on its parent. Root's slots only — those are the ones enumerated with
  // positions (a part stacked on another has exactly one slot to be on).
  // Directions are root's own x/y axes, not the screen's: with the
  // default camera, → is roughly rightwards and ↑ roughly away.
  function nudgeSelected(direction) {
    const node = getNode(assembly, selectedNodeId);
    if (!node || node.parentId !== ROOT_ID) return;
    const open = new Set(openSlots.map((s) => s.name));
    const target = slotInDirection(allSlots, node.slotName, open, direction);
    if (target) moveNode(selectedNodeId, { parentId: ROOT_ID, slotName: target });
  }

  // A marker click: the destination of an armed move, otherwise "attach
  // something here".
  function handleMarkerClick(id) {
    const target = parseMarkerId(id);
    if (moveMode && selectedNodeId) moveNode(selectedNodeId, target);
    else if (roomToAttach) setPendingSlot(target);
  }

  // Which undo step a parameter edit is: a field being typed into reports
  // every keystroke, so a run of edits to one parameter of one node
  // coalesces into one step (history.js, by key); an edit of several at
  // once (a reset) is a step of its own.
  function paramsStep(id, params) {
    const before = getNode(assembly, id)?.params ?? {};
    const changed = Object.keys({ ...before, ...params }).filter((key) => before[key] !== params[key]);
    const one = changed.length === 1 ? changed[0] : null;
    return { key: one && `params:${id}:${one}`, label: one ? `edit ${one}` : "edit parameters" };
  }

  // Everything NodeTree can do to a node, bundled once here instead of
  // threaded through every level of the recursion as five props. Each is
  // one undo step, named for the Undo button's tooltip; the fields that
  // report every keystroke (offset, shift, a typed rotation, parameters)
  // pass a key, so typing "120" is one step, not three.
  const nodeActions = {
    attachAt: (parentId, slotName) => setPendingSlot({ parentId, slotName }),
    // Never the root: removeChild(root) would take every node with it.
    remove: (id) => {
      if (id !== ROOT_ID) setAssembly((a) => removeChild(a, id), { label: "delete part" });
    },
    setJoint: (id, joint) => setAssembly((a) => updateChildJoint(a, id, joint), { label: "change joint" }),
    setOverlap: (id, overlap) =>
      setAssembly((a) => updateChildOverlap(a, id, overlap), {
        key: `overlap:${id}`,
        label: "change offset",
      }),
    setShift: (id, shift) =>
      setAssembly((a) => updateChildShift(a, id, shift), { key: `shift:${id}`, label: "shift part" }),
    setSpin: (id, spin) =>
      setAssembly((a) => updateChildSpin(a, id, spin), { key: `spin:${id}`, label: "rotate part" }),
    rotate: (id, delta) => setAssembly((a) => rotateChild(a, id, delta), { label: "rotate part" }),
    // `step` names the undo step when the caller knows better than a diff
    // (a handle's "resize W"); else it comes from what changed.
    setParams: (id, params, step = paramsStep(id, params)) =>
      setAssembly((a) => updateNodeParams(a, id, params), step),
    // `on` false only clears the crop if it's this node's — unticking one
    // part never drops a crop that belongs to another.
    setCrop: (id, on) =>
      setAssembly((a) => (on ? setCropTo(a, id) : a.cropTo === id ? setCropTo(a, null) : a), {
        label: on ? "crop" : "stop cropping",
      }),
    select: selectNode,
  };

  // Selecting a part in the scene shows its parameters, as TinkerCAD's
  // inspector does: its <details> in the sidebar opens and scrolls into
  // view. Done on the DOM, because the <details> stay uncontrolled — the
  // user (and the browser tests) open and close them by their summaries.
  // Only the sidebar scrolls: in the stacked phone layout it doesn't, and
  // scrolling the page would take the viewer away from the tap.
  function revealParams(id) {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const details = /** @type {HTMLDetailsElement | undefined} */ (
      [...sidebar.querySelectorAll("details[data-node-params]")].find(
        (el) => el.getAttribute("data-node-params") === id,
      )
    );
    if (!details) return;
    details.open = true;
    const box = sidebar.getBoundingClientRect();
    const at = details.getBoundingClientRect();
    if (at.top < box.top) sidebar.scrollTop += at.top - box.top;
    else if (at.bottom > box.bottom) sidebar.scrollTop += Math.min(at.bottom - box.bottom, at.top - box.top);
  }

  // A click on the rendered assembly: the smallest known box under the
  // clicked point is the part meant — the root when nothing on it is. A
  // spot no box claims (an imported part, a side-mounted one, empty
  // space) clears the selection: a wrong guess would be worse than none.
  function handleModelClick(point) {
    const id = point ? pickNodeAt(nodeBoxes, point) : null;
    selectNode(id);
    if (id) revealParams(id);
  }

  // --- Export ---
  // Every exported file is named after the bench (lib/benchName.js's
  // exportFilename()), so a downloads folder full of them says what each
  // one is. A bench that has no name yet is asked for one first — the
  // export is parked in `pendingExport` and NameBenchModal proposes a
  // name built from the parts; confirming names the bench (the sidebar
  // field shows it from then on) and runs the export. Cancelling exports
  // nothing.
  function withName(exportFn) {
    const name = benchName(assembly);
    if (name) exportFn(name);
    else setPendingExport(() => exportFn);
  }

  function confirmBenchName(name) {
    const run = pendingExport;
    setPendingExport(null);
    setAssembly((a) => setAssemblyName(a, name), { key: "name", label: "rename bench" });
    run?.(name);
  }

  function downloadBody(tag) {
    withName(async (name) => {
      try {
        const buf = await renderAssembly(tag);
        downloadBlob(buf, exportFilename(name, tag, ".stl"), "model/stl");
      } catch (err) {
        setRenderError(friendlyRenderError(err.message));
      }
    });
  }

  // Every body in one copy, each its own mesh in Layerling, placed as on
  // the bench. Needs no bench name: nothing lands in a downloads folder.
  const layerling = useLayerlingCopy((message) => setRenderError(friendlyRenderError(message)));
  function copyToLayerling() {
    const nodesById = new Map(assembly.nodes.map((n) => [n.id, n]));
    const bodyName = (tag) => {
      if (tag === ROOT_ID) return benchName(assembly) ?? rootPart.name;
      const node = nodesById.get(tag.replace(/_pin$/, ""));
      const name = partsById.get(node?.partId)?.name ?? tag;
      return tag.endsWith("_pin") ? `${name} pin` : name;
    };
    const tags = bodyTags(assembly);
    layerling.copy(
      Promise.all(tags.map(async (tag) => ({ name: bodyName(tag), stlBuffer: await renderAssembly(tag) }))),
    );
  }

  // compileToScad() throws on a tree it can't express (a part missing
  // from the catalogue, say); shown where the STL exports show theirs,
  // rather than lost as an uncaught error in an event handler.
  function downloadScad() {
    withName((name) => {
      try {
        downloadBlob(compileToScad(assembly, partsById), exportFilename(name, null, ".scad"), "text/plain");
      } catch (err) {
        setRenderError(friendlyRenderError(err.message));
      }
    });
  }

  // --- Configs and presets (lib/benchConfig.js, lib/benchPresets.js) ---
  // One document serves both: "Download config" writes it to a file,
  // "Save" keeps it in the browser under a name, and loading either goes
  // through the same applyConfig().

  function downloadConfig() {
    withName((name) => {
      const doc = serializeBenchConfig(assembly, partsById, name);
      downloadBlob(configToJson(doc), exportFilename(name, null, CONFIG_EXTENSION), "application/json");
    });
  }

  // Replaces the whole bench (root, tree, imported meshes) with a checked
  // document — after asking, when there is a bench to lose. Nothing
  // changes unless hydration succeeds, so a bad file leaves the current
  // bench exactly as it was; one that loads is an undo step (`label`
  // names it), so the bench it replaced can be had back.
  function applyConfig(doc, what, label) {
    if (assembly && !window.confirm(`Replace the current bench with ${what}?`)) return;
    try {
      loadBenchConfig(doc, catalogueById, label);
      selectNode(null);
      setPendingSlot(null);
      endImport();
      setConfigError(null);
    } catch (err) {
      setConfigError(`Couldn't load ${what}: ${err.message}`);
    }
  }

  async function importConfigFile(file) {
    let doc;
    try {
      doc = parseBenchConfig(await file.text());
    } catch (err) {
      setConfigError(`Couldn't load "${file.name}": ${err.message}`);
      return;
    }
    applyConfig(doc, `"${file.name}"`, "load config");
  }

  function loadPreset(preset) {
    applyConfig(preset.config, `the preset "${preset.name}"`, "load preset");
  }

  function saveCurrentAsPreset(name) {
    const problem = savePreset(name, serializeBenchConfig(assembly, partsById, name));
    setConfigError(problem);
    return !problem;
  }

  function removePreset(name) {
    if (!window.confirm(`Delete the preset "${name}"?`)) return;
    setConfigError(deletePreset(name));
  }

  // Drops the imported meshes too: nothing can reference them without the
  // tree. Undoable: the step keeps the tree and its meshes, and the start
  // screen offers Undo.
  function startOver() {
    replaceBenchSession({ assembly: null, importedParts: new Map() }, { label: "start over" });
    selectNode(null);
  }

  // The saved presets as palette rows: Enter loads one, its Actions page
  // also deletes it (after asking, as the ✕ beside it does).
  function presetCommands() {
    return presets.map((preset) => ({
      id: `bench.preset:${preset.name}`,
      title: preset.name,
      section: "Saved presets",
      keywords: ["preset"],
      actions: [
        { title: "Load", run: () => loadPreset(preset) },
        { title: "Delete", run: () => removePreset(preset.name) },
      ],
    }));
  }

  const configFile = {
    accept: `${CONFIG_EXTENSION},.json,application/json`,
    onFile: importConfigFile,
  };
  const historyCommands = (section) => [
    builtin("bench.undo", {
      when: history.canUndo,
      section,
      title: history.undoLabel ? `Undo ${history.undoLabel}` : "Undo",
      run: undo,
    }),
    builtin("bench.redo", {
      when: history.canRedo,
      section,
      title: history.redoLabel ? `Redo ${history.redoLabel}` : "Redo",
      run: redo,
    }),
  ];

  // The part pickers — the start one over an empty bench, the attach one
  // over the scene — are command palette pages (CommandPalette.jsx): the
  // parts under their systems as the Library lists them (Settings' order,
  // its hidden parts left out), with thumbnails.
  const hidden = useHiddenLibrary();
  const systemOrder = useSystemOrder();
  /**
   * @param {any[]} list
   * @param {string} idPrefix
   * @param {string} actionTitle
   * @param {(part: any) => void} pick
   */
  const partRows = (list, idPrefix, actionTitle, pick) =>
    [...partSections(list, hidden, systemOrder)].flatMap(([system, systemParts]) =>
      systemParts.map((part) =>
        partCommand(part, {
          id: `${idPrefix}:${part.id}`,
          section: system,
          actions: [{ title: actionTitle, run: () => pick(part) }],
        }),
      ),
    );

  // The start picker is open over an empty bench unless the user put it
  // away (Escape) — for this session snapshot only: a new one (Start over,
  // an undo back to empty, a link to no bench) brings it back, and so do
  // the empty state's button and Mod+K (useCommandHome()). It steps aside
  // for the import flow it opens, and comes back if that is cancelled.
  const [pickerDismissedFor, setPickerDismissedFor] = useState(null);
  const startPickerOpen = !assembly && !importMode && pickerDismissedFor !== session;
  const reopenStartPicker = () => setPickerDismissedFor(null);
  useCommandHome(!assembly && !importMode && !startPickerOpen ? reopenStartPicker : null);

  // A model file dropped on the empty tab (its picker put away) starts a
  // bench on it, as the picker's own drop does; one dropped on the global
  // palette starts a new bench on it over a running one — after asking,
  // and undoably, as Open in Bench replaces one.
  const emptyDrop = useFileDrop(!assembly && !importMode ? (file) => startImport("root", file) : null);
  useCommandDrop({
    label: assembly ? "Drop to start a new bench on this model" : "Drop to import it as the base part",
    onFile: (file) => {
      if (assembly && !window.confirm(`Replace the current bench with a new one on "${file.name}"?`)) return;
      startImport("root", file);
    },
  });

  // The palette's Bench commands (hooks/useCommands.js): what the
  // sidebar's buttons, the scene's pills and the Bench's keys do, for the
  // bench as it is now. Before the start screen's early return, as every
  // hook; with no bench there is only the history, the import and the
  // presets — the part picker itself is the start screen.
  useCommands("bench", () => {
    const undoRedo = historyCommands();
    const loadPresets = builtin("bench.loadPreset", {
      when: presets.length > 0,
      page: () => ({
        id: "bench-presets",
        title: "Saved presets",
        searchLabel: "Search presets",
        items: presetCommands,
      }),
    });
    const importConfig = builtin("bench.importConfig", {
      actions: [{ title: "Choose a file", file: configFile }],
    });
    if (!assembly) return [...undoRedo, loadPresets, importConfig];

    const node = selectedNodeId ? getNode(assembly, selectedNodeId) : null;
    const part = node ? partsById.get(node.partId) : null;
    const attached = Boolean(node) && node.id !== ROOT_ID;
    const nodeName = (id) => partsById.get(getNode(assembly, id)?.partId)?.name ?? id;
    return [
      builtin("bench.attach", {
        when: roomToAttach && markers.length > 0,
        page: () => ({
          id: "bench-attach",
          title: "Attach a part to…",
          searchLabel: "Search slots",
          placeholder: "Search slots…",
          note: "Pick the slot, then the part to put on it.",
          items: () =>
            markers.map((marker) => {
              const target = parseMarkerId(marker.id);
              return {
                id: `bench.attachAt:${marker.id}`,
                title: target.slotName,
                subtitle: target.parentId === ROOT_ID ? rootPart?.name : `on ${nodeName(target.parentId)}`,
                section: "Open slots",
                actions: [
                  {
                    title: "Choose a part",
                    run: () => nodeActions.attachAt(target.parentId, target.slotName),
                  },
                ],
              };
            }),
        }),
      }),
      builtin("bench.selectRoot", {
        when: selectedNodeId !== ROOT_ID,
        subtitle: rootPart?.name,
        run: () => selectNode(ROOT_ID),
      }),
      builtin("bench.deselect", { when: Boolean(node), subtitle: part?.name, run: () => selectNode(null) }),
      builtin("bench.move", {
        when: attached,
        subtitle: part?.name,
        title: moveMode ? "Stop moving the selected part" : undefined,
        run: () => setMoveMode((armed) => !armed),
      }),
      builtin("bench.remove", { when: attached, subtitle: part?.name, run: removeSelected }),
      builtin("bench.turnLeft", {
        when: attached,
        subtitle: part?.name,
        run: () => nodeActions.rotate(node.id, 90),
      }),
      builtin("bench.turnRight", {
        when: attached,
        subtitle: part?.name,
        run: () => nodeActions.rotate(node.id, -90),
      }),
      builtin("bench.crop", {
        when: Boolean(node),
        subtitle: part?.name,
        checked: Boolean(node) && assembly.cropTo === node.id,
        run: () => nodeActions.setCrop(node.id, assembly.cropTo !== node.id),
      }),
      ...bodyTags(assembly).map((tag) =>
        builtin("bench.downloadStl", {
          id: `bench.downloadStl:${tag}`,
          title: `Download STL: ${tag}`,
          subtitle: tag === ROOT_ID ? rootPart?.name : nodeName(tag.replace(/_pin$/, "")),
          run: () => downloadBody(tag),
        }),
      ),
      builtin("bench.downloadScad", { run: downloadScad }),
      builtin("bench.downloadConfig", { run: downloadConfig }),
      builtin("bench.layerling", { run: copyToLayerling }),
      builtin("bench.retry", {
        when: Boolean(renderError) && status !== "rendering",
        run: () => {
          preview.retry();
          setExtentsRetry((n) => n + 1);
        },
      }),
      builtin("bench.startOver", { run: startOver }),
      ...undoRedo,
      loadPresets,
      importConfig,
    ];
  });

  if (!assembly) {
    /** @type {import("./lib/commands.js").CommandPage} */
    const startPage = {
      id: "bench-start",
      title: "Start a bench",
      searchLabel: "Search parts",
      placeholder: "Search parts, presets and commands…",
      note: 'Pick a base part with slots — a Gridfinity base or an openGrid board are good starting points — or type "import" for a model or a config of your own.',
      error: shownError,
      searchCommands: true,
      drop: () => ({
        label: "Drop to import it as the base part",
        onFile: (file) => startImport("root", file),
      }),
      items: () => [
        ...historyCommands("History"),
        ...presetCommands(),
        ...partRows(parts, "bench.base", "Use as base part", pickRoot),
        {
          id: "bench.importMesh",
          title: "Import STL / STEP / 3MF…",
          section: "Import",
          keywords: ["mesh", "file", "own model"],
          actions: [{ title: "Import", run: () => startImport("root") }],
        },
        builtin("bench.importConfig", {
          section: "Import",
          actions: [{ title: "Choose a file", file: configFile }],
        }),
      ],
    };
    // Behind the picker, and what Escape leaves: the way back to it, and
    // the way back from Start over (an undone first part too) where the
    // user is looking, not only behind Cmd/Ctrl+Z.
    return (
      <main className={emptyDrop.over ? "bench-empty is-drop-over" : "bench-empty"} {...emptyDrop.handlers}>
        {emptyDrop.over && (
          <div className="bench-empty-drop" aria-hidden="true">
            Drop to import it as the base part
          </div>
        )}
        <div className="bench-empty-card">
          <p className="bench-empty-lead">No base part yet.</p>
          <div className="bench-empty-actions">
            <button type="button" className="render-button" onClick={reopenStartPicker}>
              Choose a base part… <kbd className="shortcut-hint">{chordText(["Mod", "K"])}</kbd>
            </button>
            <button type="button" className="render-button" onClick={() => startImport("root")}>
              Import STL / STEP / 3MF…
            </button>
          </div>
          <p className="muted">Or drop a model file here to start a bench on it.</p>
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
          {!startPickerOpen && shownError && (
            <p className="error-text bench-config-error" role="alert">
              {shownError}
            </p>
          )}
        </div>
        {startPickerOpen && (
          <CommandPalette
            page={startPage}
            undo={{ onUndo: undo, onRedo: redo }}
            onClose={(reason) => {
              // Its own items change the bench (and so unmount it), or open
              // the import; anything else puts it away for now.
              if (reason !== "run") setPickerDismissedFor(session);
            }}
          />
        )}
        {importMode === "root" && (
          <ImportFlow
            mode="root"
            initialFile={importFile}
            onCancel={endImport}
            onConfirm={confirmRootImport}
          />
        )}
      </main>
    );
  }

  const pendingParentPart = pendingSlot && partsById.get(getNode(assembly, pendingSlot.parentId).partId);
  // "screwed" needs a screw pattern on one side of the seam: if the
  // parent has none, only parts that do are offered for that joint.
  const screwedNeedsPatternedChild =
    pendingJoint === "screwed" && pendingParentPart && !screwedApplies(pendingParentPart, null);
  const attachableParts = screwedNeedsPatternedChild
    ? parts.filter((p) => screwedApplies(pendingParentPart, p))
    : parts;

  // Resolved fresh each render so removing the selected node (or its
  // ancestor) simply drops the controls — no separate cleanup to forget.
  const selectedNode = selectedNodeId ? getNode(assembly, selectedNodeId) : null;
  const selectedPart = selectedNode ? partsById.get(selectedNode.partId) : null;
  // The root's outline follows its handles (on the predicted box while a
  // resize renders), so the two never disagree.
  const selectedBox = selectedNode
    ? ((rootSelected ? handleBox : null) ?? nodeBoxes.get(selectedNode.id) ?? null)
    : null;
  const moving = moveMode && Boolean(selectedNode) && !rootSelected;
  const cropping = Boolean(selectedNode) && assembly.cropTo === selectedNode.id;
  // A part that is resized in the sidebar, not by handles, says so in its
  // scene controls: an attached part (handles on attached parts would need
  // their exact rotated frames), or a root without resize axes. Not an
  // imported part, which has no size parameters at all.
  const resizeHint =
    selectedPart && selectedPart.kind !== "imported" && !(rootSelected && rootAxes.length > 0);

  // The selected part's scene controls: its name, Crop and Deselect, and
  // for an attached part its turn, move and remove buttons. The root has
  // nothing to turn against, no slot to move to, and isn't removable
  // (everything is on it).
  //
  // An attached part's float over it (the viewer's overlay, pinned above
  // its box). The root's sit in the viewer's toolbar instead, as
  // TinkerCAD's inspector does: its top face carries the attach markers
  // and its handles ring it, and a pill over its centre covered both — a
  // marker under it couldn't be clicked, and in Top view the far edge's
  // handle landed on it. Up there they are chrome, which StlViewer keeps
  // the handles clear of when they grow.
  const selectionControls = selectedNode && (
    <>
      <div className="bench-rotate-panel">
        <span className="bench-rotate-name">
          {selectedPart.name}
          <span className="muted">{rootSelected ? " · root" : ` · ${selectedNode.spin ?? 0}°`}</span>
        </span>
        {!rootSelected && (
          <>
            <SpinButtons
              name={selectedPart.name}
              onRotate={(delta) => nodeActions.rotate(selectedNode.id, delta)}
            />
            <button
              type="button"
              className="bench-rotate-pill bench-rotate-move"
              onClick={() => setMoveMode((armed) => !armed)}
              aria-pressed={moving}
              aria-label={
                moving ? `Stop moving ${selectedPart.name}` : `Move ${selectedPart.name} to another slot`
              }
              title="Move to another slot: then click an open marker, or use the arrow keys (M)"
            >
              {moving ? "Pick a slot…" : "Move"}
            </button>
          </>
        )}
        <button
          type="button"
          className="bench-rotate-pill bench-rotate-crop"
          onClick={() => nodeActions.setCrop(selectedNode.id, !cropping)}
          aria-pressed={cropping}
          aria-label={
            cropping
              ? `Stop cropping to ${selectedPart.name}`
              : `Crop everything else to ${selectedPart.name}'s outline`
          }
          title="Crop everything else to this part's vertical outline — edges that stick out past it are cut away"
        >
          Crop
        </button>
        {!rootSelected && (
          <button
            type="button"
            className="bench-rotate-delete"
            onClick={removeSelected}
            aria-label={`Remove ${selectedPart.name} and anything attached to it`}
            title="Remove, and anything attached to it (Delete)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M6 1.5h4a1 1 0 0 1 1 1V3h3v1.5h-1.1l-.7 9.1A1.5 1.5 0 0 1 10.7 15H5.3a1.5 1.5 0 0 1-1.5-1.4L3.1 4.5H2V3h3v-.5a1 1 0 0 1 1-1Zm.5 1.5h3v-.5h-3V3Zm-1.9 1.5.7 9h5.4l.7-9H4.6Zm1.7 1.5h1.2v6H6.3v-6Zm2.2 0h1.2v6H8.5v-6Z"
              />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="bench-rotate-close"
          onClick={() => selectNode(null)}
          aria-label="Deselect"
          title="Deselect (Esc)"
        >
          ✕
        </button>
      </div>
      {resizeHint && <p className="bench-overlay-hint">Resize in the sidebar</p>}
    </>
  );

  return (
    <div className={sidebarCollapsed ? "bench sidebar-collapsed" : "bench"}>
      <aside ref={sidebarRef} className="sidebar bench-sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && (
          <>
            <div className="bench-root-heading">
              <h2>{rootPart.name}</h2>
              {/* Outside the "Root parameters" summary on purpose: a
                  button in a <summary> toggles its <details> too. */}
              <button
                type="button"
                className="bench-root-select"
                onClick={() => selectNode(rootSelected ? null : ROOT_ID)}
                aria-pressed={rootSelected}
                title={
                  rootSelected
                    ? "Deselect (Esc)"
                    : rootAxes.length
                      ? "Select the root part: its outline, Crop, and handles to resize it in the scene"
                      : "Select the root part: its outline and Crop in the scene"
                }
              >
                Select root
              </button>
            </div>
            <p className="muted">Root part. Click an open slot in the scene to attach something to it.</p>
            <label
              className="field bench-name-field"
              title="What this bench's exports are called — <name>_<body>.stl, <name>.scad, <name>.bench.json. Left empty, you're asked before the first export."
            >
              <span className="field-label">Name</span>
              <input
                type="text"
                placeholder={defaultBenchName(assembly, partsById)}
                value={assembly.name ?? ""}
                onChange={(e) =>
                  setAssembly((a) => setAssemblyName(a, e.target.value), {
                    key: "name",
                    label: "rename bench",
                  })
                }
              />
            </label>
            <button type="button" className="render-button bench-reset" onClick={startOver}>
              Start over
            </button>

            <label
              className="field field-checkbox bench-crop-field"
              title="Everything attached is trimmed to this part's vertical outline — edges that stick out past it are cut away"
            >
              <input
                type="checkbox"
                checked={assembly.cropTo === ROOT_ID}
                onChange={(e) => nodeActions.setCrop(ROOT_ID, e.target.checked)}
              />
              <span className="field-label">Crop everything else to this outline</span>
            </label>

            <details className="bench-node-params-details" data-node-params={ROOT_ID}>
              <summary>Root parameters</summary>
              <ParamsEditor
                className="bench-node-params"
                part={rootPart}
                params={assembly.root.params}
                onChange={(params) => nodeActions.setParams(ROOT_ID, params)}
                allowSavedDefaults={rootPart.kind !== "imported"}
              />
            </details>

            <h3>
              Attached ({assembly.nodes.length} of {MAX_ATTACHED})
            </h3>
            {assembly.nodes.length === 0 && <p className="muted">Nothing attached yet.</p>}
            <ul className="bench-child-list">
              {childrenOf(assembly, ROOT_ID).map((child) => (
                <NodeTree
                  key={child.id}
                  assembly={assembly}
                  partsById={partsById}
                  nodeExtents={nodeExtents}
                  nodeId={child.id}
                  actions={nodeActions}
                  selectedId={selectedNodeId}
                  canAttach={roomToAttach}
                />
              ))}
            </ul>

            <h3>Export</h3>
            <div className="bench-export">
              {bodyTags(assembly).map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className="download-button bench-export-button"
                  onClick={() => downloadBody(tag)}
                >
                  STL: {tag}
                </button>
              ))}
              <button type="button" className="download-button bench-export-button" onClick={downloadScad}>
                Download .scad
              </button>
              <button
                type="button"
                className="download-button bench-export-button"
                onClick={downloadConfig}
                title="The bench setup as a file — parts, parameters, joints, rotations, and any imported meshes — to import again later"
              >
                Download config
              </button>
              <button
                type="button"
                className="download-button bench-export-button layerling-button"
                onClick={copyToLayerling}
                disabled={layerling.copying}
                title={LAYERLING_COPY_TITLE}
              >
                {layerling.label}
              </button>
            </div>

            <h3>Presets</h3>
            <PresetsPanel
              key={assembly.root.partId}
              presets={presets}
              defaultName={benchName(assembly) ?? rootPart.name}
              onSave={saveCurrentAsPreset}
              onLoad={loadPreset}
              onDelete={removePreset}
              onImportFile={importConfigFile}
              error={shownError}
            />
          </>
        )}
      </aside>
      {!sidebarCollapsed && <SidebarResizer />}

      <main className="workspace">
        <header className="part-header">
          <div>
            <h2>Bench</h2>
            {dimensions && (
              <p
                className="outside-dimensions"
                aria-label={`Outside dimensions: width ${dimensions.width} millimetres, height ${dimensions.height} millimetres, depth ${dimensions.depth} millimetres`}
              >
                Outside: W {dimensions.width} × H {dimensions.height} × D {dimensions.depth} mm
              </p>
            )}
            <p className="print-note" aria-live="polite">
              {moving ? (
                <>
                  Moving {selectedPart.name}: click an open slot marker to put it there, or step it with the
                  arrow keys. Esc cancels.
                </>
              ) : roomToAttach ? (
                <>
                  {openSlots.length} open slot{openSlots.length === 1 ? "" : "s"} on {rootPart.name}. Click a
                  marker to attach a part there; click an attached part to select it, then turn, move, or
                  delete it.
                </>
              ) : (
                <>
                  {MAX_ATTACHED} parts attached — the most a bench takes. Remove one to attach another; click
                  an attached part to select it, then turn, move, or delete it.
                </>
              )}
              {/* No " Rendering…" appended here: the extra word wrapped the
                  sentence onto another line and pushed the viewer down
                  while a render ran. The header's render indicator (a
                  status live region, App.jsx) already says it. */}
            </p>
          </div>
        </header>
        {/* A focused handle that loses focus drops the guard note its
            arrow step or typed size left (see guardStep): the handles are
            the viewer's sliders, and focusout bubbles. */}
        <div
          className="viewer-panel bench-viewer"
          onBlur={(e) => {
            if (e.target.getAttribute?.("role") === "slider") setGuardStep(null);
          }}
        >
          {stlBuffer ? (
            <StlViewer
              stlBuffer={stlBuffer}
              fitKey={assembly.root.partId}
              fitBox={selectedBox}
              markers={shownMarkers}
              onMarkerClick={handleMarkerClick}
              onModelClick={handleModelClick}
              highlightBox={selectedBox}
              overlayAnchor={selectedBox && !rootSelected ? boxTopCenter(selectedBox) : null}
              handles={rootHandles}
              ghost={pendingShown?.ghost ?? null}
              gridControl={gridShown}
              onHandleStart={onHandleStart}
              onHandlePreview={onHandlePreview}
              onHandleCommit={onHandleCommit}
              onHandleEnd={() => {
                dragStart.current = null;
              }}
              onHandleStep={onHandleStep}
              onHandleSet={onHandleSet}
              toolbar={
                <>
                  {rootSelected && <div className="bench-root-chip">{selectionControls}</div>}
                  <UndoRedoButtons
                    canUndo={history.canUndo}
                    canRedo={history.canRedo}
                    onUndo={undo}
                    onRedo={redo}
                    undoLabel={history.undoLabel}
                    redoLabel={history.redoLabel}
                  />
                </>
              }
            >
              {selectedNode && !rootSelected && <div className="bench-overlay">{selectionControls}</div>}
            </StlViewer>
          ) : (
            <div className="viewer-placeholder" role="status">
              {status === "rendering" ? "Rendering…" : "No preview yet."}
            </div>
          )}
          {renderError && (
            <p className="error-text bench-error" role="alert">
              {handleFailed && "Couldn't render that size. "}
              {renderError}
              {/* The size a handle asked for didn't render (a floor the
                  module asserts, a WASM limit): the way back is here, by
                  the message, rather than a retry of the same size. */}
              {handleFailed && (
                <button type="button" className="viewer-error-undo bench-error-undo" onClick={undo}>
                  Undo
                </button>
              )}
            </p>
          )}
          {renderError && status !== "rendering" && (
            <button
              type="button"
              className="render-button"
              onClick={() => {
                preview.retry();
                setExtentsRetry((n) => n + 1);
              }}
            >
              Retry preview
            </button>
          )}
        </div>
      </main>

      {pendingSlot && !importMode && (
        <CommandPalette
          className="command-palette-side"
          page={{
            id: "bench-attach",
            title: `Attach to ${pendingSlot.slotName}${pendingSlot.parentId !== ROOT_ID ? ` on ${pendingParentPart.name}` : ""}`,
            searchLabel: "Search parts",
            placeholder: "Search parts…",
            accessory: (
              <label className="command-palette-joint">
                Joint
                <JointSelect value={pendingJoint} onChange={setPendingJoint} />
              </label>
            ),
            drop: () => ({
              label: "Drop to import it and attach it here",
              onFile: (file) => startImport("child", file),
            }),
            note: screwedNeedsPatternedChild
              ? `Screwed joins through a part's own screw holes, so only parts that carry a pattern are listed here — a flange with matching heat-set insert bores is generated on the ${pendingParentPart.name} side.`
              : null,
            items: () => [
              ...partRows(attachableParts, "bench.attachPart", "Attach", attachChild),
              {
                id: "bench.attachImport",
                title: "Import STL / STEP / 3MF…",
                section: "Import",
                keywords: ["mesh", "file", "own model"],
                actions: [{ title: "Import", run: () => startImport("child") }],
              },
            ],
          }}
          onClose={(reason) => {
            // Its own items attach (clearing the slot) or open the import,
            // which needs the slot kept.
            if (reason === "dismiss") setPendingSlot(null);
          }}
        />
      )}

      {importMode === "root" && (
        <ImportFlow mode="root" initialFile={importFile} onCancel={endImport} onConfirm={confirmRootImport} />
      )}
      {pendingSlot && importMode === "child" && (
        <ImportFlow
          mode="child"
          initialFile={importFile}
          onCancel={endImport}
          onConfirm={confirmChildImport}
        />
      )}

      {pendingExport && (
        <NameBenchModal
          defaultName={defaultBenchName(assembly, partsById)}
          onConfirm={confirmBenchName}
          onCancel={() => setPendingExport(null)}
        />
      )}
    </div>
  );
}
