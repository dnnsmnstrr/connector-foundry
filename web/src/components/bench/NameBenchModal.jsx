import { useState } from "react";
import Modal from "../Modal.jsx";

// Asked once, before the first export of a bench that has no name yet
// (Bench.jsx's withName()): every exported file is named after the
// bench, so the downloads folder says what each one is. `defaultName`
// is benchName.js's proposal built from the parts; whatever is
// confirmed becomes the bench's name (editable later in the sidebar)
// and the export the user asked for goes ahead under it.
export default function NameBenchModal({ defaultName, onConfirm, onCancel }) {
  const [name, setName] = useState(defaultName);
  const trimmed = name.trim();

  function submit(e) {
    e.preventDefault();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <Modal onClose={onCancel} title="Name this bench" className="bench-name-modal">
      <p className="muted bench-name-help">
        Exports are named after the bench — <code>{trimmed || "name"}_root.stl</code>,{" "}
        <code>{trimmed || "name"}.scad</code>, <code>{trimmed || "name"}.bench.json</code> — so the files say
        what they are. This one is built from the parts; change it to anything.
      </p>
      <form className="bench-name-form" onSubmit={submit}>
        <input
          type="text"
          className="bench-preset-name"
          aria-label="Bench name"
          placeholder="Bench name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          data-autofocus
        />
        <button type="submit" className="render-button bench-preset-save-button" disabled={!trimmed}>
          Export
        </button>
      </form>
      <button type="button" className="bench-modal-cancel" onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
