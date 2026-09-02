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
import { renderPart } from "./lib/openscad-client.js";
import { enumerateSlots } from "./lib/slots.js";

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

function PartList({ parts, onPick }) {
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

export default function Bench({ parts }) {
  const catalogueById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const [assembly, setAssembly] = useState(null); // null until a root is chosen
  const [rootExtents, setRootExtents] = useState(null);
  const [pendingSlot, setPendingSlot] = useState(null); // slot name awaiting a part choice
  const [pendingJoint, setPendingJoint] = useState("fused");
  const [stlBuffer, setStlBuffer] = useState(null);
  const [status, setStatus] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const renderSeq = useRef(0);

  const rootPart = assembly ? catalogueById.get(assembly.root.partId) : null;

  // The root's own standalone bounding box, independent of whatever is
  // attached to it — needed for a free-subdivision grid (Gridfinity),
  // and cached by openscad-client the same as any Library-mode render.
  useEffect(() => {
    if (!rootPart) {
      setRootExtents(null);
      return;
    }
    let cancelled = false;
    renderPart({ scadFile: rootPart.file, module: rootPart.module, params: assembly.root.params }).then((buf) => {
      if (!cancelled) setRootExtents(meshExtents(buf));
    });
    return () => {
      cancelled = true;
    };
  }, [rootPart, assembly?.root.params]);

  const allSlots = useMemo(() => {
    if (!rootPart || !rootExtents) return [];
    return enumerateSlots(rootPart, assembly.root.params, rootExtents);
  }, [rootPart, rootExtents, assembly?.root.params]);

  const occupied = useMemo(() => (assembly ? occupiedSlotNames(assembly) : new Set()), [assembly]);
  const openSlots = useMemo(() => allSlots.filter((s) => !occupied.has(s.name)), [allSlots, occupied]);

  const markers = useMemo(() => {
    if (!rootExtents) return [];
    return openSlots.map((s) => ({ id: s.name, x: s.x, y: s.y, z: rootExtents[2] }));
  }, [openSlots, rootExtents]);

  // Re-render the whole assembly (debounced) whenever it changes.
  useEffect(() => {
    if (!assembly) return;
    const seq = ++renderSeq.current;
    const timer = setTimeout(async () => {
      setStatus("rendering");
      setRenderError(null);
      try {
        const scadSource = compileToScad(assembly, catalogueById);
        const buf = await renderPart({ scadSource, part: "all" });
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
  }, [assembly, catalogueById]);

  function pickRoot(part) {
    setAssembly(createAssembly(part.id, part.defaults ?? {}));
  }

  function attachChild(part) {
    setAssembly((a) => addChild(a, { partId: part.id, params: part.defaults ?? {}, slotName: pendingSlot, joint: pendingJoint }));
    setPendingSlot(null);
    setPendingJoint("fused");
  }

  function downloadBody(tag) {
    (async () => {
      try {
        const scadSource = compileToScad(assembly, catalogueById);
        const buf = await renderPart({ scadSource, part: tag });
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
    const scadSource = compileToScad(assembly, catalogueById);
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
        <p className="muted">Pick a base part with slots — Gridfinity base or openGrid board are good starting points.</p>
        <PartList parts={parts} onPick={pickRoot} />
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
            const childPart = catalogueById.get(child.partId);
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

      {pendingSlot && (
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
            <PartList parts={parts} onPick={attachChild} />
            <button className="bench-modal-cancel" onClick={() => setPendingSlot(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
