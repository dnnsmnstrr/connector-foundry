import { useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  addAnchor,
  anchorDisplayPoint,
  createImportedPart,
  findAnchorNear,
  nextAnchorName,
  removeAnchor,
} from "../../lib/importedPart.js";
import { validateAndRepair } from "../../lib/meshValidate.js";
import Modal from "../Modal.jsx";
import StlViewer from "../StlViewer.jsx";

// How close a newly-clicked slot center has to be to an already-placed
// one to count as "the same face, clicked again" rather than a genuine
// second slot. Small relative to typical printed-part scale (10s of
// mm), generous enough to absorb the tiny floating-point drift between
// two clusterFace() runs starting from different triangles in the same
// coplanar patch.
const DUPLICATE_SLOT_TOLERANCE_MM = 0.75;

// Upload -> validate/repair -> place one or more slots by clicking the
// mesh -> hand back a finished ImportedPart. `mode` only changes copy:
// a root can carry any number of slots (they become its whole slot
// set, same as a catalogue part's grid); a child only needs the one
// it'll attach through, but placing more and picking one is allowed.
export default function ImportFlow({ mode, onCancel, onConfirm }) {
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
      // Same flat face clicked again: select its existing slot rather
      // than stacking a second marker on it (see findAnchorNear()).
      const existing = findAnchorNear(p, point, DUPLICATE_SLOT_TOLERANCE_MM);
      if (existing) {
        setSelectedAnchor(existing.name);
        return p;
      }
      const name = nextAnchorName(p);
      setSelectedAnchor(name);
      return addAnchor(p, name, point, normal);
    });
  }

  function deleteSlot(name) {
    setPart((p) => removeAnchor(p, name));
    setSelectedAnchor((s) => (s === name ? null : s));
  }

  const markers = part
    ? part.anchors.map((a) => {
        const [x, y, z] = anchorDisplayPoint(part, a);
        return { id: a.name, x, y, z, radius: 1.5 };
      })
    : [];

  return (
    <Modal onClose={onCancel} className="bench-import-modal">
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
    </Modal>
  );
}
