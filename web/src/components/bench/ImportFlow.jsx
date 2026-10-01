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
import { tessellateStep } from "../../lib/stepImport.js";
import { MESH_FILE_ACCEPT, bodyLabels, geometryFromBodies, isStepFilename, looksLikeStep } from "../../lib/stepMesh.js";
import Modal from "../Modal.jsx";
import StlViewer from "../StlViewer.jsx";

// How close a newly-clicked slot center has to be to an already-placed
// one to count as "the same face, clicked again" rather than a genuine
// second slot. Small relative to typical printed-part scale (10s of
// mm), generous enough to absorb the tiny floating-point drift between
// two clusterFace() runs starting from different triangles in the same
// coplanar patch.
const DUPLICATE_SLOT_TOLERANCE_MM = 0.75;

// Sentinel for the body picker's "every body as one mesh" choice.
const ALL_BODIES = "all";

function formatMm(n) {
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
}

// Upload -> (STEP: tessellate, pick a body if there are several) ->
// validate/repair -> place one or more slots by clicking the mesh ->
// hand back a finished ImportedPart. An STL is parsed as-is; a STEP file
// is tessellated in a worker first (src/lib/stepImport.js) and from
// then on is the same triangle soup an STL would be, so everything from
// validation onward — the slot placement, the part record, the bytes
// that go to OpenSCAD, what a config embeds — is one path.
//
// `mode` only changes copy: a root can carry any number of slots (they
// become its whole slot set, same as a catalogue part's grid); a child
// only needs the one it'll attach through, but placing more and picking
// one is allowed.
export default function ImportFlow({ mode, onCancel, onConfirm }) {
  const [stage, setStage] = useState("pick"); // pick | reading | bodies | validating | rejected | placing
  const [fileName, setFileName] = useState(null);
  const [bodies, setBodies] = useState(null);
  const [bodyChoice, setBodyChoice] = useState(ALL_BODIES);
  const [validation, setValidation] = useState(null);
  const [part, setPart] = useState(null);
  const [selectedAnchor, setSelectedAnchor] = useState(null);
  const fileInputRef = useRef(null);

  function reject(report) {
    setValidation({ ok: false, report });
    setStage("rejected");
  }

  // The gate every mesh passes through, whichever file it came from.
  function validate(rawGeometry, name) {
    setStage("validating");
    const result = validateAndRepair(rawGeometry);
    setValidation(result);
    if (result.ok) {
      setPart(createImportedPart(name, result));
      setStage("placing");
    } else {
      setStage("rejected");
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same filename after a reject
    if (!file) return;
    setFileName(file.name);
    setBodies(null);
    setBodyChoice(ALL_BODIES);
    try {
      const buffer = await file.arrayBuffer();
      if (isStepFilename(file.name) || looksLikeStep(buffer)) {
        setStage("reading");
        const read = await tessellateStep(buffer);
        if (read.length === 1) {
          validate(geometryFromBodies(read), file.name);
        } else {
          // Several bodies: an assembly, or a part modelled as separate
          // solids. The gate below refuses more than one disconnected
          // solid, so let the user pick before it gets the chance to.
          setBodies(read);
          setStage("bodies");
        }
      } else {
        setStage("validating");
        validate(new STLLoader().parse(buffer), file.name);
      }
    } catch (err) {
      reject([`Couldn't read this file: ${err.message}`]);
    }
  }

  function useBodies() {
    const chosen = bodyChoice === ALL_BODIES ? bodies : [bodies[Number(bodyChoice)]];
    try {
      validate(geometryFromBodies(chosen), fileName);
    } catch (err) {
      reject([`Couldn't build a mesh from this body: ${err.message}`]);
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

  const labels = bodies ? bodyLabels(bodies) : [];

  return (
    <Modal
      onClose={onCancel}
      className="bench-import-modal"
      title={`Import STL or STEP ${mode === "root" ? "as base part" : "to attach here"}`}
    >

      {stage === "pick" && (
        <>
          <p className="muted">
            STL or STEP (.step / .stp). An STL is used as it is; a STEP file is converted to a mesh here in your
            browser first. Either way your file stays local to this session: it's never uploaded anywhere or saved
            into this repo.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={MESH_FILE_ACCEPT}
            onChange={handleFile}
            className="bench-file-input"
          />
        </>
      )}

      {stage === "reading" && (
        <p className="muted" role="status">
          Reading STEP geometry… The first STEP import also loads the converter (about 8 MB).
        </p>
      )}

      {stage === "bodies" && bodies && (
        <>
          <p className="muted">
            This file holds {bodies.length} bodies. A Bench part is one solid, so pick the body to import — or take
            them all as one mesh if they are the pieces of a single part.
          </p>
          <ul className="bench-slot-list bench-body-list">
            <li>
              <label>
                <input
                  type="radio"
                  name="body"
                  checked={bodyChoice === ALL_BODIES}
                  onChange={() => setBodyChoice(ALL_BODIES)}
                />
                All bodies as one mesh
              </label>
            </li>
            {bodies.map((b, i) => (
              <li key={i}>
                <label>
                  <input
                    type="radio"
                    name="body"
                    checked={bodyChoice === String(i)}
                    onChange={() => setBodyChoice(String(i))}
                  />
                  {labels[i]}
                </label>
                <span className="muted bench-body-size">
                  {b.extents.map(formatMm).join(" × ")} mm · {b.triangleCount} triangles
                </span>
              </li>
            ))}
          </ul>
          <div className="bench-import-actions">
            <button className="render-button" onClick={useBodies}>
              Use {bodyChoice === ALL_BODIES ? "all bodies" : labels[Number(bodyChoice)]}
            </button>
          </div>
        </>
      )}

      {stage === "validating" && (
        <p className="muted" role="status">
          Checking watertightness and winding…
        </p>
      )}

      {stage === "rejected" && (
        <>
          <p className="error-text" role="alert">
            This mesh can't be used as-is:
          </p>
          <ul className="bench-report">
            {validation.report.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {bodies && bodies.length > 1 && (
            <button className="render-button" onClick={() => setStage("bodies")}>
              Pick a different body
            </button>
          )}
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
                  <button
                    type="button"
                    className="bench-remove"
                    aria-label={`Remove slot ${a.name}`}
                    title="Remove this slot"
                    onClick={() => deleteSlot(a.name)}
                  >
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

      <button type="button" className="bench-modal-cancel" onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
