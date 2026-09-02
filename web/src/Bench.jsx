import { useEffect, useMemo, useRef, useState } from "react";
import ImportFlow from "./components/bench/ImportFlow.jsx";
import JointSelect from "./components/bench/JointSelect.jsx";
import NodeTree from "./components/bench/NodeTree.jsx";
import Modal from "./components/Modal.jsx";
import ParamsEditor from "./components/ParamsEditor.jsx";
import PartBrowser from "./components/PartBrowser.jsx";
import SidebarToggle from "./components/SidebarToggle.jsx";
import StlViewer from "./components/StlViewer.jsx";
import {
  ROOT_ID,
  addChild,
  bodyTags,
  childrenOf,
  compileToScad,
  createAssembly,
  getNode,
  occupiedSlotNames,
  removeChild,
  screwedApplies,
  updateChildJoint,
  updateChildOverlap,
  updateNodeParams,
} from "./lib/assembly.js";
import { centeredToWorld, parseMarkerId, rootSlots, sceneMarkers } from "./lib/benchLayout.js";
import { downloadBlob } from "./lib/download.js";
import { meshExtents } from "./lib/meshExtents.js";
import { renderPart } from "./lib/openscad-client.js";
import { getGlobalOverrides, resolveParams } from "./lib/userOverrides.js";

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

export default function Bench({ parts, pendingRoot, onConsumePendingRoot, sidebarCollapsed, onToggleSidebar }) {
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const [importedParts, setImportedParts] = useState(new Map());
  const partsById = useMemo(
    () => new Map([...catalogueById, ...importedParts]),
    [catalogueById, importedParts],
  );

  const [assembly, setAssembly] = useState(null); // null until a root is chosen

  // Library's "Open in Bench" seeds a root here, carrying over whatever
  // params were showing there (not necessarily catalogue defaults) —
  // fires once, on the mount that follows the mode switch (Bench fully
  // unmounts when not the active tab, so there's no "already have an
  // assembly" case to reconcile with).
  useEffect(() => {
    if (!pendingRoot) return;
    setAssembly(createAssembly(pendingRoot.part.id, pendingRoot.params));
    onConsumePendingRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoot]);
  const [nodeExtents, setNodeExtents] = useState(new Map()); // node id ("root" or child id) -> [x,y,z]
  const [pendingSlot, setPendingSlot] = useState(null); // { parentId, slotName } awaiting a part choice
  const [pendingJoint, setPendingJoint] = useState("fused");
  const [importMode, setImportMode] = useState(null); // null | "root" | "child"
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const renderSeq = useRef(0);

  // Escape closes whichever of the Bench's own modals is open — the
  // import flow first (it's on top when both are technically "open"),
  // then the attach-a-part picker. App.jsx's own keydown handler covers
  // Settings and mode-switching; this one is local because the state it
  // closes is local too.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      if (importMode) setImportMode(null);
      else if (pendingSlot) setPendingSlot(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [importMode, pendingSlot]);

  const rootPart = assembly ? partsById.get(assembly.root.partId) : null;

  // Every node's own standalone bounding box (its part rendered alone,
  // with its own params, no attach() context) — needed to enumerate
  // that node's own slots. A node's position elsewhere in the tree
  // never changes its own size, so this is exactly the same computation
  // for root and for any descendant. Cached by (file, module, params)
  // in openscad-client, and the parse of the result is memoised per
  // buffer in meshExtents(), so re-deriving nodes nothing changed about
  // on every assembly edit is two lookups, not a compile and a parse.
  useEffect(() => {
    if (!assembly) {
      setNodeExtents(new Map());
      return;
    }
    let cancelled = false;
    const allNodes = [{ id: ROOT_ID, partId: assembly.root.partId, params: assembly.root.params }, ...assembly.nodes];
    (async () => {
      // allSettled, not all: one node's own standalone render hitting
      // the known openscad-wasm resource limit (see friendlyRenderError()
      // — the same WASM build the main assembly render already works
      // around) shouldn't cost every OTHER node its markers too, and
      // shouldn't surface as an unhandled rejection either.
      const results = await Promise.allSettled(
        allNodes.map(async (n) => {
          const part = partsById.get(n.partId);
          if (part.kind === "imported") return [n.id, part.extents];
          const buf = await renderPart({
            scadFile: part.file,
            module: part.module,
            params: n.params,
            globalOverrides: getGlobalOverrides(),
          });
          return [n.id, meshExtents(buf)];
        }),
      );
      if (cancelled) return;
      const entries = [];
      for (const result of results) {
        if (result.status === "fulfilled") entries.push(result.value);
        else console.warn("Bench: couldn't get this node's own extents (its slots won't show):", result.reason);
      }
      setNodeExtents(new Map(entries));
    })();
    return () => {
      cancelled = true;
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
    attachPending(part.id, resolveParams(part, {}), "mount");
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

  // Everything NodeTree can do to a node, bundled once here instead of
  // threaded through every level of the recursion as five props.
  const nodeActions = {
    attachAt: (parentId, slotName) => setPendingSlot({ parentId, slotName }),
    remove: (id) => setAssembly((a) => removeChild(a, id)),
    setJoint: (id, joint) => setAssembly((a) => updateChildJoint(a, id, joint)),
    setOverlap: (id, overlap) => setAssembly((a) => updateChildOverlap(a, id, overlap)),
    setParams: (id, params) => setAssembly((a) => updateNodeParams(a, id, params)),
  };

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

  if (!assembly) {
    return (
      <div className="bench-empty">
        <h2>Start a bench</h2>
        <p className="muted">
          Pick a base part with slots — Gridfinity base or openGrid board are good starting points — or import your
          own STL.
        </p>
        <div className="bench-part-list">
          <PartBrowser
            parts={parts}
            onPick={pickRoot}
            autoFocus
            toolbar={
              <button className="render-button bench-import-button" onClick={() => setImportMode("root")}>
                Import STL…
              </button>
            }
          />
        </div>
        {importMode === "root" && (
          <ImportFlow mode="root" onCancel={() => setImportMode(null)} onConfirm={confirmRootImport} />
        )}
      </div>
    );
  }

  const pendingParentPart = pendingSlot && partsById.get(getNode(assembly, pendingSlot.parentId).partId);
  // "screwed" needs a screw pattern on one side of the seam: if the
  // parent has none, only parts that do are offered for that joint.
  const screwedNeedsPatternedChild = pendingJoint === "screwed" && pendingParentPart && !screwedApplies(pendingParentPart, null);
  const attachableParts = screwedNeedsPatternedChild ? parts.filter((p) => screwedApplies(pendingParentPart, p)) : parts;

  return (
    <div className={sidebarCollapsed ? "bench sidebar-collapsed" : "bench"}>
      <aside className="sidebar bench-sidebar">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {!sidebarCollapsed && (
          <>
            <h2>{rootPart.name}</h2>
            <p className="muted">Root part. Click an open slot in the scene to attach something to it.</p>
            <button className="render-button bench-reset" onClick={() => setAssembly(null)}>
              Start over
            </button>

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

            <h3>Attached ({assembly.nodes.length})</h3>
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
            </div>
          </>
        )}
      </aside>

      <main className="workspace">
        <header className="part-header">
          <div>
            <h2>Bench</h2>
            <p className="print-note">
              {openSlots.length} open slot{openSlots.length === 1 ? "" : "s"} on {rootPart.name}. A part with a "bot"
              anchor (a Basics plate or post) keeps offering it once attached — look for another marker on top of it
              to stack something there.
              {status === "rendering" && " Rendering…"}
            </p>
          </div>
        </header>
        <div className="viewer-panel bench-viewer">
          {stlBuffer ? (
            <StlViewer stlBuffer={stlBuffer} markers={markers} onMarkerClick={(id) => setPendingSlot(parseMarkerId(id))} />
          ) : (
            <div className="viewer-placeholder">Rendering…</div>
          )}
          {renderError && <p className="error-text bench-error">{renderError}</p>}
        </div>
      </main>

      {pendingSlot && !importMode && (
        <Modal onClose={() => setPendingSlot(null)}>
          <h3>
            Attach to {pendingSlot.slotName}
            {pendingSlot.parentId !== ROOT_ID && ` on ${pendingParentPart.name}`}
          </h3>
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
          <button className="bench-modal-cancel" onClick={() => setPendingSlot(null)}>
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
