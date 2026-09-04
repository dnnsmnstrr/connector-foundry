import { useEffect, useMemo, useRef, useState } from "react";
import ImportFlow from "./components/bench/ImportFlow.jsx";
import JointSelect from "./components/bench/JointSelect.jsx";
import NodeTree from "./components/bench/NodeTree.jsx";
import PresetsPanel, { ConfigImportButton } from "./components/bench/PresetsPanel.jsx";
import SpinButtons from "./components/bench/SpinButtons.jsx";
import Modal from "./components/Modal.jsx";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import {
  MAX_ATTACHED,
  ROOT_ID,
  addChild,
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
  setCropTo,
  updateChildJoint,
  updateChildOverlap,
  updateChildSpin,
  updateNodeParams,
} from "./lib/assembly.js";
import { useBenchPresets } from "./hooks/useBenchPresets.js";
import { useBenchSession } from "./hooks/useBenchSession.js";
import { configFilename, configToJson, hydrateBenchConfig, parseBenchConfig, serializeBenchConfig } from "./lib/benchConfig.js";
import { centeredToWorld, parseMarkerId, rootSlots, sceneMarkers, slotFootprint, slotInDirection } from "./lib/benchLayout.js";
import { boxTopCenter, nodeWorldBoxes, pickNodeAt } from "./lib/benchPick.js";
import { deletePreset, savePreset } from "./lib/benchPresets.js";
import { replaceBenchSession, setBenchAssembly, setBenchImportedParts } from "./lib/benchSession.js";
import { downloadBlob } from "./lib/download.js";
import { isEditableTarget } from "./lib/isEditableTarget.js";
import { meshExtents } from "./lib/meshExtents.js";
import { getCachedRender, renderPart } from "./lib/openscad-client.js";
import { fitGridCounts } from "./lib/slots.js";
import { getGlobalOverrides, getOverrides, resolveParams } from "./lib/userOverrides.js";

// A bolted/snap/pin joint nests two rounded-cuboid flanges around the
// child; openscad-wasm@0.0.4 hard-crashes with an opaque WASM trap
// once a third rounded-cuboid part (e.g. Basics plate) joins that
// chain — see assembly.js's emitJointChild() for the full story.
// The generated .scad is correct (renders fine natively); this is a
// browser-preview-only limitation, so say so instead of showing a raw
// WASM trap message.
function friendlyRenderError(message) {
  // openscad-wasm@0.0.4 wraps every WASM export in an abort handler
  // (see node_modules/openscad-wasm/openscad.js's makeAbortWrapper());
  // when the same resource limit corrupts that export table, the
  // symptom isn't always the same string — "table index out of
  // bounds"/"memory access out of bounds" from earlier testing, but
  // "original is not a function" from a bolted joint nested one level
  // deeper (a Basics plate — itself a rounded cuboid — fused onto root,
  // then something bolted onto ONE of the plate's own further anchors:
  // that's the plate plus both bolted flanges, three rounded cuboids in
  // one attach() chain, the same limit as bolting a plate directly).
  // All of these are the one known cause, not three different bugs.
  if (/table index|memory access out of bounds|is not a function/i.test(message)) {
    return "This browser's OpenSCAD build can't preview this bolted/snap/pin combination " +
      "(a known limitation, not a bad connection) — try \"fused\" for this joint instead, or for a stacked " +
      "part, fuse just one of the joints in the chain. The generated .scad still renders correctly with a " +
      "native OpenSCAD install.";
  }
  return message;
}

// Debounce between the last assembly edit and the re-render it triggers,
// so typing a parameter value doesn't compile once per keystroke.
const RENDER_DEBOUNCE_MS = 250;

// Arrow keys step the selected part to the next open slot that way,
// in root's own x/y frame (see nudgeSelected()).
const ARROW_DIRECTIONS = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

export default function Bench({ parts, sidebarCollapsed, onToggleSidebar }) {
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  // The tree and the imported meshes live in lib/benchSession.js, not
  // here: this component unmounts whenever the Library tab is up, and the
  // bench has to survive that (and App.jsx mirrors it into the URL). The
  // setters take a value or an updater, so the edits below read as before.
  // `assembly` is null until a root is chosen; `notice` is App's message
  // when a bench in the URL couldn't be restored (shown like a config
  // error, below).
  const { assembly, importedParts, notice } = useBenchSession();
  const setAssembly = setBenchAssembly;
  const setImportedParts = setBenchImportedParts;
  const partsById = useMemo(
    () => new Map([...catalogueById, ...importedParts]),
    [catalogueById, importedParts],
  );

  const [nodeExtents, setNodeExtents] = useState(new Map()); // node id ("root" or child id) -> [x,y,z]
  const [pendingSlot, setPendingSlot] = useState(null); // { parentId, slotName } awaiting a part choice
  const [pendingJoint, setPendingJoint] = useState("fused");
  const [importMode, setImportMode] = useState(null); // null | "root" | "child"
  // The attached node whose rotate controls are showing — picked by
  // clicking the part in the scene or its name in the sidebar. Never
  // root: there's nothing to spin root against (orbit the camera instead).
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  // "Move" is armed for the selected part: the next open marker clicked
  // re-seats it there instead of opening the attach picker. Only
  // meaningful while something is selected; every selection change
  // (selectNode()) disarms it.
  const [moveMode, setMoveMode] = useState(false);
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const renderSeq = useRef(0);
  // Saved setups (lib/benchPresets.js) and whatever the last config
  // load/save had to complain about — shown in the presets panel, on the
  // start screen or in the sidebar, whichever is up, with the session's
  // own restore `notice` as the fallback.
  const presets = useBenchPresets();
  const [configError, setConfigError] = useState(null);
  const shownError = configError ?? notice;

  // The Bench's own keys, one listener for the component's lifetime that
  // reads the latest handler through a ref (the handler closes over this
  // render's state and helpers). App.jsx's own keydown handler covers
  // Settings and mode-switching; this one is local because the state it
  // acts on is local too.
  //
  // Escape backs out of whichever is up — the import flow first (it's on
  // top when both are technically "open"), then the attach-a-part picker,
  // then move mode, then the selection. The rest act on the selected part,
  // and only with no modal up and the key not meant for a field:
  // Delete/Backspace removes it (subtree and all, like the sidebar's ✕),
  // M arms/disarms move mode, an arrow key steps it to the next open slot
  // that way.
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    if (e.key === "Escape") {
      if (importMode) setImportMode(null);
      else if (pendingSlot) setPendingSlot(null);
      else if (moveMode) setMoveMode(false);
      else if (selectedNodeId) setSelectedNodeId(null);
      return;
    }
    if (importMode || pendingSlot || !assembly || isEditableTarget(e.target)) return;
    if (!selectedNodeId || !getNode(assembly, selectedNodeId)) return;
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
  // offset change, a move, a crop — resolve at once, as before.
  useEffect(() => {
    if (!assembly) {
      setNodeExtents(new Map());
      return;
    }
    let cancelled = false;
    let timer = null;
    const allNodes = [{ id: ROOT_ID, partId: assembly.root.partId, params: assembly.root.params }, ...assembly.nodes];
    const requestFor = (part, node) => ({
      scadFile: part.file,
      module: part.module,
      params: node.params,
      globalOverrides: getGlobalOverrides(),
    });
    const compute = async () => {
      // allSettled, not all: one node's own standalone render hitting
      // the known openscad-wasm resource limit (see friendlyRenderError()
      // — the same WASM build the main assembly render already works
      // around) shouldn't cost every OTHER node its markers too, and
      // shouldn't surface as an unhandled rejection either.
      const results = await Promise.allSettled(
        allNodes.map(async (n) => {
          const part = partsById.get(n.partId);
          if (part.kind === "imported") return [n.id, part.extents];
          return [n.id, meshExtents(await renderPart(requestFor(part, n)))];
        }),
      );
      if (cancelled) return;
      const entries = [];
      for (const result of results) {
        if (result.status === "fulfilled") entries.push(result.value);
        else console.warn("Bench: couldn't get this node's own extents (its slots won't show):", result.reason);
      }
      setNodeExtents(new Map(entries));
    };
    const allCached = allNodes.every((n) => {
      const part = partsById.get(n.partId);
      return part.kind === "imported" || getCachedRender(requestFor(part, n)) !== null;
    });
    if (allCached) compute();
    else timer = setTimeout(compute, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [assembly, partsById]);

  const rootExtents = nodeExtents.get(ROOT_ID) ?? null;

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
    () => sceneMarkers({ assembly, partsById, openRootSlots: openSlots, rootExtents, rootSlotWorldPositions, nodeExtents }),
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

  // Re-render the whole assembly (debounced) whenever it changes.
  useEffect(() => {
    if (!assembly) return;
    const seq = ++renderSeq.current;
    const timer = setTimeout(async () => {
      setStatus("rendering");
      setRenderError(null);
      try {
        const buf = await renderAssembly("all");
        if (seq !== renderSeq.current) return;
        setStlBuffer(buf);
        setStatus("done");
      } catch (err) {
        if (seq !== renderSeq.current) return;
        setRenderError(friendlyRenderError(err.message));
        setStatus("error");
      }
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembly, partsById]);

  // The current assembly as one STL — `tag` picks the printable body
  // ("all", "root", or a joint child's own id; see assembly.js's
  // bodyTags()). The generated source is the same for every tag; only
  // the -D part= selector differs.
  function renderAssembly(tag) {
    const importedFiles = new Map();
    const scadSource = compileToScad(assembly, partsById, importedFiles);
    return renderPart({ scadSource, part: tag, importedFiles, globalOverrides: getGlobalOverrides() });
  }

  function pickRoot(part) {
    // catalogue default -> saved user override -> (no instance value yet) —
    // same resolution as Library mode, so "gridfinity should always have
    // magnet holes on" applies here too. A no-op for an imported part
    // (no catalogue defaults, no saved override under a fresh uuid id).
    setAssembly(createAssembly(part.id, resolveParams(part, {})));
  }

  // Finish the pending "attach to this slot" with `partId`: a catalogue
  // part attaches via its own "mount"; an imported one via the anchor
  // the user picked in the import flow.
  function attachPending(partId, params, childAnchor) {
    setAssembly((a) =>
      addChild(a, { parentId: pendingSlot.parentId, partId, params, slotName: pendingSlot.slotName, joint: pendingJoint, childAnchor }),
    );
    setPendingSlot(null);
    setPendingJoint("fused");
  }

  function attachChild(part) {
    const params = resolveParams(part, {});
    // Size a grid part to the surface it lands on (a 5x5 BitBeam plate on
    // a single Gridfinity base, 3x3 on an openGrid snap) — except for a
    // count the user's saved default for this part already pins.
    const available = slotFootprint(assembly, partsById, nodeExtents, pendingSlot.parentId, pendingSlot.slotName);
    const fitted = fitGridCounts(part, available);
    if (fitted) {
      const pinned = getOverrides(part.id);
      for (const [key, value] of Object.entries(fitted)) {
        if (!(key in pinned)) params[key] = value;
      }
    }
    attachPending(part.id, params, "mount");
  }

  function registerImport(importedPart) {
    setImportedParts((m) => new Map(m).set(importedPart.id, importedPart));
  }

  function confirmRootImport(importedPart) {
    registerImport(importedPart);
    pickRoot(importedPart);
    setImportMode(null);
  }

  function confirmChildImport(importedPart, anchorName) {
    registerImport(importedPart);
    attachPending(importedPart.id, {}, anchorName);
    setImportMode(null);
  }

  // Every selection change goes through here so an armed "Move" never
  // outlives the part it was armed for.
  function selectNode(id) {
    setSelectedNodeId(id);
    setMoveMode(false);
  }

  // Re-seat `id` on `target` ({ parentId, slotName }) — see assembly.js's
  // moveChild() for what it refuses (the assembly comes back as it was).
  // A "screwed" joint the new parent can't take (no screw pattern on
  // either side of the seam) falls back to fused, the same rule
  // jointsFor() applies when the joint is chosen. The part stays
  // selected, so its outline and controls follow it to the new slot.
  function moveNode(id, target) {
    setAssembly((a) => {
      const moved = moveChild(a, id, target);
      if (moved === a) return a;
      const node = getNode(moved, id);
      const parentPart = partsById.get(getNode(moved, target.parentId).partId);
      if (node.joint === "screwed" && !screwedApplies(parentPart, partsById.get(node.partId))) {
        return updateChildJoint(moved, id, "fused");
      }
      return moved;
    });
    setMoveMode(false);
  }

  function removeSelected() {
    if (!selectedNodeId) return;
    setAssembly((a) => removeChild(a, selectedNodeId));
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

  // Everything NodeTree can do to a node, bundled once here instead of
  // threaded through every level of the recursion as five props.
  const nodeActions = {
    attachAt: (parentId, slotName) => setPendingSlot({ parentId, slotName }),
    remove: (id) => setAssembly((a) => removeChild(a, id)),
    setJoint: (id, joint) => setAssembly((a) => updateChildJoint(a, id, joint)),
    setOverlap: (id, overlap) => setAssembly((a) => updateChildOverlap(a, id, overlap)),
    setSpin: (id, spin) => setAssembly((a) => updateChildSpin(a, id, spin)),
    rotate: (id, delta) => setAssembly((a) => rotateChild(a, id, delta)),
    setParams: (id, params) => setAssembly((a) => updateNodeParams(a, id, params)),
    // `on` false only clears the crop if it's this node's — unticking one
    // part never drops a crop that belongs to another.
    setCrop: (id, on) => setAssembly((a) => (on ? setCropTo(a, id) : a.cropTo === id ? setCropTo(a, null) : a)),
    select: selectNode,
  };

  // A click on the rendered assembly: the smallest known box under the
  // clicked point is the part meant. Root, or a spot no box claims (an
  // imported part, a side-mounted one, empty space), clears the
  // selection — root isn't rotatable, and a wrong guess would be worse
  // than none.
  function handleModelClick(point) {
    const id = point ? pickNodeAt(nodeBoxes, point) : null;
    selectNode(id && id !== ROOT_ID ? id : null);
  }

  async function downloadBody(tag) {
    try {
      const buf = await renderAssembly(tag);
      downloadBlob(buf, `bench_${tag}.stl`, "model/stl");
    } catch (err) {
      setRenderError(friendlyRenderError(err.message));
    }
  }

  function downloadScad() {
    downloadBlob(compileToScad(assembly, partsById), "bench_assembly.scad", "text/plain");
  }

  // --- Configs and presets (lib/benchConfig.js, lib/benchPresets.js) ---
  // One document serves both: "Download config" writes it to a file,
  // "Save" keeps it in the browser under a name, and loading either goes
  // through the same applyConfig().

  function downloadConfig() {
    const doc = serializeBenchConfig(assembly, partsById, rootPart.name);
    downloadBlob(configToJson(doc), configFilename(rootPart.name), "application/json");
  }

  // Replaces the whole bench (root, tree, imported meshes) with a checked
  // document — after asking, when there is a bench to lose. Nothing
  // changes unless hydration succeeds, so a bad file leaves the current
  // bench exactly as it was.
  function applyConfig(doc, what) {
    if (assembly && !window.confirm(`Replace the current bench with ${what}?`)) return;
    try {
      const { assembly: next, importedParts: imports } = hydrateBenchConfig(doc, catalogueById);
      replaceBenchSession({ assembly: next, importedParts: imports });
      selectNode(null);
      setPendingSlot(null);
      setImportMode(null);
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
    applyConfig(doc, `"${file.name}"`);
  }

  function loadPreset(preset) {
    applyConfig(preset.config, `the preset "${preset.name}"`);
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

  if (!assembly) {
    return (
      <main className="bench-empty">
        <h2>Start a bench</h2>
        <p className="muted">
          Pick a base part with slots — Gridfinity base or openGrid board are good starting points — or import your
          own STL.
        </p>
        {/* Saved benches first — a returning user is most likely here for
            one of these. Nothing to show (and nothing to say) until one
            exists or a config import has something to report. */}
        {(presets.length > 0 || shownError) && (
          <section className="bench-empty-section" aria-labelledby="bench-presets-heading">
            <h3 id="bench-presets-heading">Saved presets</h3>
            <PresetsPanel presets={presets} onLoad={loadPreset} onDelete={removePreset} error={shownError} emptyText={null} />
          </section>
        )}
        <div className="bench-part-list">
          <PartBrowser
            parts={parts}
            onPick={pickRoot}
            autoFocus
            toolbar={
              <div className="bench-picker-toolbar">
                <button className="render-button bench-import-button" onClick={() => setImportMode("root")}>
                  Import STL…
                </button>
                <ConfigImportButton onFile={importConfigFile} className="render-button bench-import-button" />
              </div>
            }
          />
        </div>
        {importMode === "root" && (
          <ImportFlow mode="root" onCancel={() => setImportMode(null)} onConfirm={confirmRootImport} />
        )}
      </main>
    );
  }

  const pendingParentPart = pendingSlot && partsById.get(getNode(assembly, pendingSlot.parentId).partId);
  // "screwed" needs a screw pattern on one side of the seam: if the
  // parent has none, only parts that do are offered for that joint.
  const screwedNeedsPatternedChild = pendingJoint === "screwed" && pendingParentPart && !screwedApplies(pendingParentPart, null);
  const attachableParts = screwedNeedsPatternedChild ? parts.filter((p) => screwedApplies(pendingParentPart, p)) : parts;

  // Resolved fresh each render so removing the selected node (or its
  // ancestor) simply drops the controls — no separate cleanup to forget.
  const selectedNode = selectedNodeId && selectedNodeId !== ROOT_ID ? getNode(assembly, selectedNodeId) : null;
  const selectedPart = selectedNode ? partsById.get(selectedNode.partId) : null;
  const selectedBox = selectedNode ? nodeBoxes.get(selectedNode.id) ?? null : null;
  const moving = moveMode && Boolean(selectedNode);
  const cropping = Boolean(selectedNode) && assembly.cropTo === selectedNode.id;

  return (
    <div className={sidebarCollapsed ? "bench sidebar-collapsed" : "bench"}>
      <aside className="sidebar bench-sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && (
          <>
            <h2>{rootPart.name}</h2>
            <p className="muted">Root part. Click an open slot in the scene to attach something to it.</p>
            <button
              className="render-button bench-reset"
              onClick={() => {
                // Drops the imported meshes too: nothing can reference
                // them without the tree, and it frees their bytes.
                replaceBenchSession({ assembly: null, importedParts: new Map() });
                selectNode(null);
              }}
            >
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

            <details className="bench-node-params-details">
              <summary>Root parameters</summary>
              <ParamsEditor
                className="bench-node-params"
                part={rootPart}
                params={assembly.root.params}
                onChange={(params) => nodeActions.setParams(ROOT_ID, params)}
                allowSavedDefaults={rootPart.kind !== "imported"}
              />
            </details>

            <h3>Attached ({assembly.nodes.length} of {MAX_ATTACHED})</h3>
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
                <button key={tag} className="download-button bench-export-button" onClick={() => downloadBody(tag)}>
                  STL: {tag}
                </button>
              ))}
              <button className="download-button bench-export-button" onClick={downloadScad}>
                Download .scad
              </button>
              <button
                className="download-button bench-export-button"
                onClick={downloadConfig}
                title="The bench setup as a file — parts, parameters, joints, rotations, and any imported meshes — to import again later"
              >
                Download config
              </button>
            </div>

            <h3>Presets</h3>
            <PresetsPanel
              key={assembly.root.partId}
              presets={presets}
              defaultName={rootPart.name}
              onSave={saveCurrentAsPreset}
              onLoad={loadPreset}
              onDelete={removePreset}
              onImportFile={importConfigFile}
              error={shownError}
            />
          </>
        )}
      </aside>

      <main className="workspace">
        <header className="part-header">
          <div>
            <h2>Bench</h2>
            <p className="print-note" aria-live="polite">
              {moving ? (
                <>
                  Moving {selectedPart.name}: click an open slot marker to put it there, or step it with the arrow
                  keys. Esc cancels.
                </>
              ) : roomToAttach ? (
                <>
                  {openSlots.length} open slot{openSlots.length === 1 ? "" : "s"} on {rootPart.name}. Click a marker
                  to attach a part there; click an attached part to select it, then turn, move, or delete it.
                </>
              ) : (
                <>
                  {MAX_ATTACHED} parts attached — the most a bench takes. Remove one to attach another; click an
                  attached part to select it, then turn, move, or delete it.
                </>
              )}
              {status === "rendering" && " Rendering…"}
            </p>
          </div>
        </header>
        <div className="viewer-panel bench-viewer">
          {stlBuffer ? (
            <StlViewer
              stlBuffer={stlBuffer}
              markers={shownMarkers}
              onMarkerClick={handleMarkerClick}
              onModelClick={handleModelClick}
              highlightBox={selectedBox}
              overlayAnchor={selectedBox ? boxTopCenter(selectedBox) : null}
            >
              {selectedNode && (
                <div className="bench-rotate-panel">
                  <span className="bench-rotate-name">
                    {selectedPart.name}
                    <span className="muted"> · {selectedNode.spin ?? 0}°</span>
                  </span>
                  <SpinButtons name={selectedPart.name} onRotate={(delta) => nodeActions.rotate(selectedNode.id, delta)} />
                  <button
                    type="button"
                    className="bench-rotate-pill bench-rotate-move"
                    onClick={() => setMoveMode((armed) => !armed)}
                    aria-pressed={moving}
                    aria-label={moving ? `Stop moving ${selectedPart.name}` : `Move ${selectedPart.name} to another slot`}
                    title="Move to another slot: then click an open marker, or use the arrow keys (M)"
                  >
                    {moving ? "Pick a slot…" : "Move"}
                  </button>
                  <button
                    type="button"
                    className="bench-rotate-pill bench-rotate-crop"
                    onClick={() => nodeActions.setCrop(selectedNode.id, !cropping)}
                    aria-pressed={cropping}
                    aria-label={cropping ? `Stop cropping to ${selectedPart.name}` : `Crop everything else to ${selectedPart.name}'s outline`}
                    title="Crop everything else to this part's vertical outline — edges that stick out past it are cut away"
                  >
                    Crop
                  </button>
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
              )}
            </StlViewer>
          ) : (
            <div className="viewer-placeholder" role="status">
              Rendering…
            </div>
          )}
          {renderError && (
            <p className="error-text bench-error" role="alert">
              {renderError}
            </p>
          )}
        </div>
      </main>

      {pendingSlot && !importMode && (
        <Modal
          onClose={() => setPendingSlot(null)}
          title={`Attach to ${pendingSlot.slotName}${pendingSlot.parentId !== ROOT_ID ? ` on ${pendingParentPart.name}` : ""}`}
        >
          <label className="field">
            Joint
            <JointSelect value={pendingJoint} onChange={setPendingJoint} />
          </label>
          {screwedNeedsPatternedChild && (
            <p className="muted">
              Screwed joins through a part's own screw holes, so only parts that carry a pattern are listed
              here — a flange with matching heat-set insert bores is generated on the {pendingParentPart.name} side.
            </p>
          )}
          <div className="bench-part-list">
            <PartBrowser
              parts={attachableParts}
              onPick={attachChild}
              autoFocus
              toolbar={
                <button className="render-button bench-import-button" onClick={() => setImportMode("child")}>
                  Import STL…
                </button>
              }
            />
          </div>
          <button type="button" className="bench-modal-cancel" onClick={() => setPendingSlot(null)}>
            Cancel
          </button>
        </Modal>
      )}

      {pendingSlot && importMode === "child" && (
        <ImportFlow mode="child" onCancel={() => setImportMode(null)} onConfirm={confirmChildImport} />
      )}
    </div>
  );
}
