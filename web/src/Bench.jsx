import { useEffect, useMemo, useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import ParamField from "./components/ParamField.jsx";
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
  updateChildJoint,
  updateNodeParams,
} from "./lib/assembly.js";
import { groupBySystem, matchesSearch } from "./lib/catalogueUtils.js";
import { addAnchor, createImportedPart, nextAnchorName, removeAnchor } from "./lib/importedPart.js";
import { validateAndRepair } from "./lib/meshValidate.js";
import { renderPart } from "./lib/openscad-client.js";
import { enumerateSlots } from "./lib/slots.js";
import { clearOverrides, getGlobalOverrides, getOverrides, resolveParams, setOverrides } from "./lib/userOverrides.js";

const JOINTS = ["fused", "bolted", "snap"];

// A bolted/snap joint nests two rounded-cuboid flanges around the
// child; openscad-wasm@0.0.4 hard-crashes with an opaque WASM trap
// once a third rounded-cuboid part (e.g. Basics plate) joins that
// chain — see lib/assembly.js's attachChildScad() for the full story.
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
    return "This browser's OpenSCAD build can't preview this bolted/snap combination " +
      "(a known limitation, not a bad connection) — try \"fused\" for this joint instead, or for a stacked " +
      "part, fuse just one of the joints in the chain. The generated .scad still renders correctly with a " +
      "native OpenSCAD install.";
  }
  return message;
}

// The render pipeline emits ASCII STL (OpenSCAD's default for -o *.stl),
// so this needs a real parser, not a fixed binary-STL byte layout —
// STLLoader already handles both, so reuse it instead of hand-rolling one.
function meshExtents(stlBuffer) {
  const geometry = new STLLoader().parse(stlBuffer);
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [max.x - min.x, max.y - min.y, max.z - min.z];
}

// A named-anchor position is always expressed relative to the part's
// own centered local origin (BOSL2's attachable() convention — every
// module in this repo follows it, generated imported-part wrappers
// included). Rendered as a root with the default anchor=BOTTOM, the
// whole part additionally shifts up by half its height so its bottom
// lands on world z=0 — so a centered-frame anchor position converts to
// a world marker position by adding height/2 on Z only.
//
// This only holds for the ROOT: it's the only node BOSL2 places with no
// rotation (attach()'s own flip means a non-root node's local axes
// don't line up with world space in general — see lib/assembly.js's
// attachChildScad() comment). So 3D slot markers are root-only; a
// deeper node's own open slots are listed as buttons in the sidebar
// instead (see NodeTree below) rather than guessed at with the wrong
// transform.
function centeredToWorld([x, y, z], extents) {
  return [x, y, z + extents[2] / 2];
}

function slotsForNode(assembly, partsById, nodeExtents, nodeId) {
  const node = getNode(assembly, nodeId);
  const part = node && partsById.get(node.partId);
  const extents = nodeExtents.get(nodeId);
  if (!node || !part || !extents) return [];
  const all = part.kind === "imported"
    ? part.anchors.map((a) => ({ name: a.name }))
    : enumerateSlots(part, node.params, extents);
  // A slot with a grandchild attached is occupied; so, for a non-root
  // node, is the anchor it used to attach to ITS OWN parent
  // (childAnchor) — that face is already touching the parent, it can't
  // also host something else.
  const occupied = occupiedSlotNames(assembly, nodeId);
  if (nodeId !== ROOT_ID) occupied.add(node.childAnchor);
  return all.filter((s) => !occupied.has(s.name));
}

function PartList({ parts, onPick, onImport }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => parts.filter((p) => matchesSearch(p, search)), [parts, search]);
  const groups = useMemo(() => groupBySystem(filtered), [filtered]);

  return (
    <div className="bench-part-list">
      <input
        type="search"
        className="search-input"
        placeholder="Search parts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {onImport && (
        <button className="render-button bench-import-button" onClick={onImport}>
          Import STL…
        </button>
      )}
      {filtered.length === 0 && <p className="muted no-results">No parts match "{search}".</p>}
      {[...groups.entries()].map(([system, systemParts]) => (
        <div key={system} className="system-group">
          <h2>{system}</h2>
          <ul>
            {systemParts.map((part) => (
              <li key={part.id}>
                <button className="part-button" onClick={() => onPick(part)}>
                  <span>{part.name}</span>
                  <span className={`badge badge-${part.confidence}`}>{part.confidence}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Upload -> validate/repair -> place one or more slots by clicking the
// mesh -> hand back a finished ImportedPart. `mode` only changes copy:
// a root can carry any number of slots (they become its whole slot
// set, same as a catalogue part's grid); a child only needs the one
// it'll attach through, but placing more and picking one is allowed.
function ImportFlow({ mode, onCancel, onConfirm }) {
  const [stage, setStage] = useState("pick"); // pick | validating | rejected | placing
  const [validation, setValidation] = useState(null);
  const [part, setPart] = useState(null);
  const [selectedAnchor, setSelectedAnchor] = useState(null);
  const fileInputRef = useRef(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same filename after a reject
    if (!file) return;
    setStage("validating");
    try {
      const buffer = await file.arrayBuffer();
      const rawGeometry = new STLLoader().parse(buffer);
      const result = validateAndRepair(rawGeometry);
      setValidation(result);
      if (result.ok) {
        setPart(createImportedPart(file.name, result));
        setStage("placing");
      } else {
        setStage("rejected");
      }
    } catch (err) {
      setValidation({ ok: false, report: [`Couldn't read this file: ${err.message}`] });
      setStage("rejected");
    }
  }

  function placeSlot(point, normal) {
    setPart((p) => {
      const name = nextAnchorName(p);
      const next = addAnchor(p, name, point, normal);
      setSelectedAnchor(name);
      return next;
    });
  }

  function deleteSlot(name) {
    setPart((p) => removeAnchor(p, name));
    setSelectedAnchor((s) => (s === name ? null : s));
  }

  const markers = part
    ? part.anchors.map((a) => {
        const [x, y, z] = [a.point[0] + part.center[0], a.point[1] + part.center[1], a.point[2] + part.center[2]];
        return { id: a.name, x, y, z, radius: 1.5 };
      })
    : [];

  return (
    <div className="bench-modal-backdrop" onClick={onCancel}>
      <div className="bench-modal bench-import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import STL {mode === "root" ? "as base part" : "to attach here"}</h3>

        {stage === "pick" && (
          <>
            <p className="muted">
              STL only for now — OpenSCAD imports it natively and Manifold can boolean against it. Your file stays
              local to this session: it's never uploaded anywhere or saved into this repo.
            </p>
            <input ref={fileInputRef} type="file" accept=".stl" onChange={handleFile} className="bench-file-input" />
          </>
        )}

        {stage === "validating" && <p className="muted">Checking watertightness and winding…</p>}

        {stage === "rejected" && (
          <>
            <p className="error-text">This mesh can't be used as-is:</p>
            <ul className="bench-report">
              {validation.report.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <button className="render-button" onClick={() => setStage("pick")}>
              Try a different file
            </button>
          </>
        )}

        {stage === "placing" && part && (
          <>
            <ul className="bench-report bench-report-ok">
              {validation.report.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="muted">
              Click anywhere on a flat face to place a slot there — it centers on that whole surface automatically
              (not just the exact pixel you clicked), using the face's own normal as the mating direction.
            </p>
            <div className="bench-import-viewer">
              <StlViewer geometry={part.geometry} markers={markers} placingMode onSurfacePick={placeSlot} />
            </div>
            {part.anchors.length > 0 && (
              <ul className="bench-slot-list">
                {part.anchors.map((a) => (
                  <li key={a.name}>
                    <label>
                      <input
                        type="radio"
                        name="anchor"
                        checked={selectedAnchor === a.name}
                        onChange={() => setSelectedAnchor(a.name)}
                      />
                      {a.name}
                    </label>
                    <button className="bench-remove" onClick={() => deleteSlot(a.name)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="bench-import-actions">
              <button
                className="render-button"
                disabled={part.anchors.length === 0}
                onClick={() => onConfirm(part, mode === "child" ? (selectedAnchor ?? part.anchors[0].name) : null)}
              >
                {mode === "root" ? "Use as base part" : "Attach here"}
              </button>
            </div>
          </>
        )}

        <button className="bench-modal-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// A part's parameter editor within the Bench — same catalogue-default
// diff/reset/save-as-default machinery as Library mode's params panel
// (App.jsx), just scoped to one node in the tree instead of the whole
// screen. `nodeId` may be "root" or a child id; updateNodeParams()
// (lib/assembly.js) resolves either the same way.
function NodeParamsPanel({ nodeId, node, part, onUpdateParams }) {
  const [savedVersion, setSavedVersion] = useState(0);
  const isImported = part.kind === "imported";
  const params = node.params ?? {};
  const entries = Object.entries(params);
  const savedOverride = useMemo(
    () => (isImported ? {} : getOverrides(part.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part.id, isImported, savedVersion],
  );
  const hasSavedOverride = Object.keys(savedOverride).length > 0;

  function setParam(key, value) {
    onUpdateParams(nodeId, { ...params, [key]: value });
  }

  function resetAllToCatalogue() {
    onUpdateParams(nodeId, { ...(part.defaults ?? {}) });
  }

  function saveAsDefault() {
    const diff = {};
    for (const [key, value] of entries) {
      if (value !== part.defaults?.[key]) diff[key] = value;
    }
    setOverrides(part.id, diff);
    setSavedVersion((v) => v + 1);
  }

  function clearSavedDefault() {
    clearOverrides(part.id);
    setSavedVersion((v) => v + 1);
  }

  if (entries.length === 0) return <p className="muted">No parameters.</p>;

  return (
    <div className="bench-node-params">
      {entries.map(([key, value]) => (
        <ParamField
          key={key}
          name={key}
          value={value}
          options={part.options?.[key]}
          catalogueDefault={part.defaults?.[key]}
          onChange={(next) => setParam(key, next)}
          onReset={() => setParam(key, part.defaults?.[key])}
        />
      ))}
      {!isImported && (
        <div className="params-defaults-row">
          <button className="bench-modal-cancel params-defaults-button" onClick={resetAllToCatalogue}>
            Reset all to catalogue
          </button>
          <button className="bench-modal-cancel params-defaults-button" onClick={saveAsDefault}>
            Save as my default
          </button>
          {hasSavedOverride && (
            <button className="bench-modal-cancel params-defaults-button" onClick={clearSavedDefault}>
              Clear my saved default
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One node in the "Attached" tree (always a non-root node — root gets
// its own params panel above this list in Bench's sidebar). Renders
// itself, its own open slots as "attach here" buttons (text, not a 3D
// marker — see centeredToWorld()'s comment for why), and recurses into
// whatever's attached to IT, to any depth.
function NodeTree({ assembly, partsById, nodeExtents, nodeId, onAttachSlot, onRemove, onJointChange, onUpdateParams }) {
  const node = getNode(assembly, nodeId);
  const part = partsById.get(node.partId);
  const kids = childrenOf(assembly, nodeId);
  const openSlots = slotsForNode(assembly, partsById, nodeExtents, nodeId);

  return (
    <li className="bench-tree-node">
      <div className="bench-child-row">
        <span>{part.name}</span>
        <button className="bench-remove" onClick={() => onRemove(nodeId)} title="Remove (and anything attached to it)">
          ✕
        </button>
      </div>
      <div className="bench-child-meta">
        <span className="muted">{node.slotName}</span>
        <select value={node.joint} onChange={(e) => onJointChange(nodeId, e.target.value)}>
          {JOINTS.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>
      <details className="bench-node-params-details">
        <summary>Parameters</summary>
        <NodeParamsPanel nodeId={nodeId} node={node} part={part} onUpdateParams={onUpdateParams} />
      </details>
      {openSlots.length > 0 && (
        <div className="bench-node-slots">
          {openSlots.map((slot) => (
            <button key={slot.name} className="bench-attach-here" onClick={() => onAttachSlot(nodeId, slot.name)}>
              + Attach: {slot.name}
            </button>
          ))}
        </div>
      )}
      {kids.length > 0 && (
        <ul className="bench-child-list bench-child-list-nested">
          {kids.map((kid) => (
            <NodeTree
              key={kid.id}
              assembly={assembly}
              partsById={partsById}
              nodeExtents={nodeExtents}
              nodeId={kid.id}
              onAttachSlot={onAttachSlot}
              onRemove={onRemove}
              onJointChange={onJointChange}
              onUpdateParams={onUpdateParams}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Bench({ parts }) {
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const [importedParts, setImportedParts] = useState(new Map());
  const partsById = useMemo(
    () => new Map([...catalogueById, ...importedParts]),
    [catalogueById, importedParts],
  );

  const [assembly, setAssembly] = useState(null); // null until a root is chosen
  const [nodeExtents, setNodeExtents] = useState(new Map()); // node id ("root" or child id) -> [x,y,z]
  const [pendingSlot, setPendingSlot] = useState(null); // { parentId, slotName } awaiting a part choice
  const [pendingJoint, setPendingJoint] = useState("fused");
  const [importMode, setImportMode] = useState(null); // null | "root" | "child"
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const renderSeq = useRef(0);

  const rootPart = assembly ? partsById.get(assembly.root.partId) : null;

  // Every node's own standalone bounding box (its part rendered alone,
  // with its own params, no attach() context) — needed to enumerate
  // that node's own slots. A node's position elsewhere in the tree
  // never changes its own size, so this is exactly the same computation
  // for root and for any descendant. Cached by (file, module, params)
  // in openscad-client, so re-deriving nodes nothing changed about on
  // every assembly edit is a cache hit, not a wasted compile.
  useEffect(() => {
    if (!assembly) {
      setNodeExtents(new Map());
      return;
    }
    let cancelled = false;
    const allNodes = [{ id: ROOT_ID, partId: assembly.root.partId, params: assembly.root.params }, ...assembly.nodes];
    (async () => {
      const entries = await Promise.all(
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
      if (!cancelled) setNodeExtents(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [assembly, partsById]);

  const rootExtents = nodeExtents.get(ROOT_ID) ?? null;

  const allSlots = useMemo(() => {
    if (!rootPart || !rootExtents) return [];
    if (rootPart.kind === "imported") {
      return rootPart.anchors.map((a) => ({ name: a.name, point: a.point }));
    }
    return enumerateSlots(rootPart, assembly.root.params, rootExtents).map((s) => ({
      name: s.name,
      point: [s.x, s.y, s.z],
    }));
  }, [rootPart, rootExtents, assembly?.root.params]);

  const occupied = useMemo(() => (assembly ? occupiedSlotNames(assembly, ROOT_ID) : new Set()), [assembly]);
  const openSlots = useMemo(() => allSlots.filter((s) => !occupied.has(s.name)), [allSlots, occupied]);

  const markers = useMemo(() => {
    if (!rootExtents) return [];
    return openSlots.map((s) => {
      const [x, y, z] = centeredToWorld(s.point, rootExtents);
      return { id: s.name, x, y, z };
    });
  }, [openSlots, rootExtents]);

  // Re-render the whole assembly (debounced) whenever it changes.
  useEffect(() => {
    if (!assembly) return;
    const seq = ++renderSeq.current;
    const timer = setTimeout(async () => {
      setStatus("rendering");
      setRenderError(null);
      try {
        const importedFiles = new Map();
        const scadSource = compileToScad(assembly, partsById, importedFiles);
        const buf = await renderPart({ scadSource, part: "all", importedFiles, globalOverrides: getGlobalOverrides() });
        if (seq !== renderSeq.current) return;
        setStlBuffer(buf);
        setStatus("done");
      } catch (err) {
        if (seq !== renderSeq.current) return;
        setRenderError(friendlyRenderError(err.message));
        setStatus("error");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [assembly, partsById]);

  function pickRoot(part) {
    // catalogue default -> saved user override -> (no instance value yet) —
    // same resolution as Library mode, so "gridfinity should always have
    // magnet holes on" applies here too. A no-op for an imported part
    // (no catalogue defaults, no saved override under a fresh uuid id).
    setAssembly(createAssembly(part.id, resolveParams(part, {})));
  }

  function attachChild(part) {
    const params = resolveParams(part, {});
    setAssembly((a) =>
      addChild(a, { parentId: pendingSlot.parentId, partId: part.id, params, slotName: pendingSlot.slotName, joint: pendingJoint }),
    );
    setPendingSlot(null);
    setPendingJoint("fused");
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
    setAssembly((a) =>
      addChild(a, {
        parentId: pendingSlot.parentId,
        partId: importedPart.id,
        params: {},
        slotName: pendingSlot.slotName,
        joint: pendingJoint,
        childAnchor: anchorName,
      }),
    );
    setPendingSlot(null);
    setPendingJoint("fused");
    setImportMode(null);
  }

  function updateParams(nodeId, params) {
    setAssembly((a) => updateNodeParams(a, nodeId, params));
  }

  function downloadBody(tag) {
    (async () => {
      try {
        const importedFiles = new Map();
        const scadSource = compileToScad(assembly, partsById, importedFiles);
        const buf = await renderPart({ scadSource, part: tag, importedFiles, globalOverrides: getGlobalOverrides() });
        const blob = new Blob([buf], { type: "model/stl" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bench_${tag}.stl`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setRenderError(friendlyRenderError(err.message));
      }
    })();
  }

  function downloadScad() {
    const scadSource = compileToScad(assembly, partsById);
    const blob = new Blob([scadSource], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bench_assembly.scad";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!assembly) {
    return (
      <div className="bench-empty">
        <h2>Start a bench</h2>
        <p className="muted">
          Pick a base part with slots — Gridfinity base or openGrid board are good starting points — or import your
          own STL.
        </p>
        <PartList parts={parts} onPick={pickRoot} onImport={() => setImportMode("root")} />
        {importMode === "root" && (
          <ImportFlow mode="root" onCancel={() => setImportMode(null)} onConfirm={confirmRootImport} />
        )}
      </div>
    );
  }

  const pendingParentPart = pendingSlot && partsById.get(getNode(assembly, pendingSlot.parentId).partId);

  return (
    <div className="bench">
      <aside className="sidebar bench-sidebar">
        <h2>{rootPart.name}</h2>
        <p className="muted">Root part. Click an open slot in the scene to attach something to it.</p>
        <button className="render-button bench-reset" onClick={() => setAssembly(null)}>
          Start over
        </button>

        <details className="bench-node-params-details">
          <summary>Root parameters</summary>
          <NodeParamsPanel nodeId={ROOT_ID} node={assembly.root} part={rootPart} onUpdateParams={updateParams} />
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
              onAttachSlot={(parentId, slotName) => setPendingSlot({ parentId, slotName })}
              onRemove={(id) => setAssembly((a) => removeChild(a, id))}
              onJointChange={(id, joint) => setAssembly((a) => updateChildJoint(a, id, joint))}
              onUpdateParams={updateParams}
            />
          ))}
        </ul>

        <h3>Export</h3>
        <div className="bench-export">
          {assembly && bodyTags(assembly).map((tag) => (
            <button key={tag} className="download-button bench-export-button" onClick={() => downloadBody(tag)}>
              STL: {tag}
            </button>
          ))}
          <button className="download-button bench-export-button" onClick={downloadScad}>
            Download .scad
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="part-header">
          <div>
            <h2>Bench</h2>
            <p className="print-note">
              {openSlots.length} open slot{openSlots.length === 1 ? "" : "s"} on {rootPart.name}. A part with its own
              extra faces (a Basics plate or post, or another multi-slot part) keeps offering them once attached —
              expand it in the sidebar to stack something onto it.
              {status === "rendering" && " Rendering…"}
            </p>
          </div>
        </header>
        <div className="viewer-panel bench-viewer">
          {stlBuffer ? (
            <StlViewer
              stlBuffer={stlBuffer}
              markers={markers}
              onMarkerClick={(id) => setPendingSlot({ parentId: ROOT_ID, slotName: id })}
            />
          ) : (
            <div className="viewer-placeholder">Rendering…</div>
          )}
          {renderError && <p className="error-text bench-error">{renderError}</p>}
        </div>
      </main>

      {pendingSlot && !importMode && (
        <div className="bench-modal-backdrop" onClick={() => setPendingSlot(null)}>
          <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              Attach to {pendingSlot.slotName}
              {pendingSlot.parentId !== ROOT_ID && ` on ${pendingParentPart.name}`}
            </h3>
            <label className="field">
              Joint
              <select value={pendingJoint} onChange={(e) => setPendingJoint(e.target.value)}>
                {JOINTS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
            <PartList parts={parts} onPick={attachChild} onImport={() => setImportMode("child")} />
            <button className="bench-modal-cancel" onClick={() => setPendingSlot(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingSlot && importMode === "child" && (
        <ImportFlow mode="child" onCancel={() => setImportMode(null)} onConfirm={confirmChildImport} />
      )}
    </div>
  );
}
