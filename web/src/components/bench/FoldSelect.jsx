import { FOLD_MODES } from "../../lib/assembly.js";
import { FOLD_MODE_LABELS } from "../../lib/benchFold.js";

// "Fold for printing" on a part that carries an openConnect head (the
// root's panel and an attached part's row both show it, for a part whose
// catalogue entry has `fold` — lib/benchFold.js's foldSpec()). It changes
// what the exports hold, never the scene: the body the head is in comes
// out cut just in front of the head and laid on its side, folded on a
// hinge or split in two. One part at a time, like Crop.
/**
 * @param {{
 *   name: string,
 *   mode: string | null,
 *   onChange: (mode: string | null) => void,
 * }} props
 */
export default function FoldSelect({ name, mode, onChange }) {
  return (
    <label
      className="field bench-offset-field bench-fold-field"
      title="Exports this part's body laid on its side, cut just in front of the openConnect head, so its layers run along the load instead of across the neck. Folded keeps the halves on a one-layer hinge to fold up and glue after printing (print with a 0.2 mm first layer); Split prints them apart. The scene doesn't change."
    >
      Fold for printing
      <select
        aria-label={`Fold for printing: ${name}`}
        value={mode ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Off</option>
        {FOLD_MODES.map((m) => (
          <option key={m} value={m}>
            {FOLD_MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  );
}
