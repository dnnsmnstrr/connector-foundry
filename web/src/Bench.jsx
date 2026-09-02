import { useEffect, useMemo, useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import StlViewer from "./components/StlViewer.jsx";
import {
  addChild,
  bodyTags,
  compileToScad,
  createAssembly,
  occupiedSlotNames,
  removeChild,
  updateChildJoint,
} from "./lib/assembly.js";
import { addAnchor, createImportedPart, nextAnchorName, removeAnchor } from "./lib/importedPart.js";
import { validateAndRepair } from "./lib/meshValidate.js";
import { renderPart } from "./lib/openscad-client.js";
import { enumerateSlots } from "./lib/slots.js";
import { getGlobalOverrides, resolveParams } from "./lib/userOverrides.js";

const JOINTS = ["fused", "bolted", "snap"];

// A bolted/snap joint nests two rounded-cuboid flanges around the
// child; openscad-wasm@0.0.4 hard-crashes with an opaque WASM trap
// once a third rounded-cuboid part (e.g. Basics plate) joins that
// chain — see lib/assembly.js's attachChildScad() for the full story.
// The generated .scad is correct (renders fine natively); this is a
// browser-preview-only limitation, so say so instead of showing a raw
// WASM trap message.
function friendlyRenderError(message) {
  if (/table index|memory access out of bounds/i.test(message)) {
    return "This browser's OpenSCAD build can't preview this bolted/snap combination " +
      "(a known limitation, not a bad connection) — try \"fused\" for this joint instead. " +
      "The generated .scad still renders correctly with a native OpenSCAD install.";
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
function centeredToWorld([x, y, z], extents) {
  return [x, y, z + extents[2] / 2];
}

function PartList({ parts, onPick, onImport }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.system.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [parts, search]);

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
      <ul>
        {filtered.map((part) => (
          <li key={part.id}>
            <button className="part-button" onClick={() => onPick(part)}>
              <span>{part.name}</span>
              <span className={`badge badge-${part.confidence}`}>{part.confidence}</span>
            </button>
          </li>
        ))}
      </ul>
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
              Click a point on the surface to place a slot there — the hit point and face normal become the slot's
              position and mating direction.
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

export default function Bench({ parts }) {
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const [importedParts, setImportedParts] = useState(new Map());
  const partsById = useMemo(
    () => new Map([...catalogueById, ...importedParts]),
    [catalogueById, importedParts],
  );

  const [assembly, setAssembly] = useState(null); // null until a root is chosen
  const [rootExtents, setRootExtents] = useState(null);
  const [pendingSlot, setPendingSlot] = useState(null); // slot name awaiting a part choice
  const [pendingJoint, setPendingJoint] = useState("fused");
  const [importMode, setImportMode] = useState(null); // null | "root" | "child"
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const renderSeq = useRef(0);

  const rootPart = assembly ? partsById.get(assembly.root.partId) : null;

  // The root's own standalone bounding box, independent of whatever is
  // attached to it — needed for a free-subdivision grid (Gridfinity).
  // An imported root already knows its own extents from validation, no
  // render needed; a catalogue root's is cached by openscad-client the
  // same as any Library-mode render.
  useEffect(() => {
    if (!rootPart) {
      setRootExtents(null);
      return;
    }
    if (rootPart.kind === "imported") {
      setRootExtents(rootPart.extents);
      return;
    }
    let cancelled = false;
    renderPart({
      scadFile: rootPart.file,
      module: rootPart.module,
      params: assembly.root.params,
      globalOverrides: getGlobalOverrides(),
    }).then((buf) => {
      if (!cancelled) setRootExtents(meshExtents(buf));
    });
    return () => {
      cancelled = true;
    };
  }, [rootPart, assembly?.root.params]);

  const allSlots = useMemo(() => {
    if (!rootPart || !rootExtents) return [];
    if (rootPart.kind === "imported") {
      return rootPart.anchors.map((a) => ({ name: a.name, point: a.point }));
    }
    return enumerateSlots(rootPart, assembly.root.params, rootExtents).map((s) => ({
      name: s.name,
      point: [s.x, s.y, rootExtents[2] / 2], // grid slots sit on the top face, size.z/2 in centered frame
    }));
  }, [rootPart, rootExtents, assembly?.root.params]);

  const occupied = useMemo(() => (assembly ? occupiedSlotNames(assembly) : new Set()), [assembly]);
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
    setAssembly((a) => addChild(a, { partId: part.id, params, slotName: pendingSlot, joint: pendingJoint }));
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
        partId: importedPart.id,
        params: {},
        slotName: pendingSlot,
        joint: pendingJoint,
        childAnchor: anchorName,
      }),
    );
    setPendingSlot(null);
    setPendingJoint("fused");
    setImportMode(null);
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

  return (
    <div className="bench">
      <aside className="sidebar bench-sidebar">
        <h2>{rootPart.name}</h2>
        <p className="muted">Root part. Click an open slot in the scene to attach something to it.</p>
        <button className="render-button bench-reset" onClick={() => setAssembly(null)}>
          Start over
        </button>

        <h3>Attached ({assembly.children.length})</h3>
        {assembly.children.length === 0 && <p className="muted">Nothing attached yet.</p>}
        <ul className="bench-child-list">
          {assembly.children.map((child) => {
            const childPart = partsById.get(child.partId);
            return (
              <li key={child.id}>
                <div className="bench-child-row">
                  <span>{childPart.name}</span>
                  <button className="bench-remove" onClick={() => setAssembly((a) => removeChild(a, child.id))}>
                    ✕
                  </button>
                </div>
                <div className="bench-child-meta">
                  <span className="muted">{child.slotName}</span>
                  <select value={child.joint} onChange={(e) => setAssembly((a) => updateChildJoint(a, child.id, e.target.value))}>
                    {JOINTS.map((j) => (
                      <option key={j} value={j}>
                        {j}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            );
          })}
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
              {openSlots.length} open slot{openSlots.length === 1 ? "" : "s"} on {rootPart.name}.
              {status === "rendering" && " Rendering…"}
            </p>
          </div>
        </header>
        <div className="viewer-panel bench-viewer">
          {stlBuffer ? (
            <StlViewer stlBuffer={stlBuffer} markers={markers} onMarkerClick={(id) => setPendingSlot(id)} />
          ) : (
            <div className="viewer-placeholder">Rendering…</div>
          )}
          {renderError && <p className="error-text bench-error">{renderError}</p>}
        </div>
      </main>

      {pendingSlot && !importMode && (
        <div className="bench-modal-backdrop" onClick={() => setPendingSlot(null)}>
          <div className="bench-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Attach to {pendingSlot}</h3>
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
