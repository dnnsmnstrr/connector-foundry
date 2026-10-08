import { useId } from "react";
import { SKADIS_SPACING } from "../../lib/screwHoles.js";

// The selected hole's "Repeat…" form: a row, a grid or a circle of
// copies (screwHoles.js's repeatHole(), whose option names these fields
// use). The copies are previewed in the scene while it is open; `placed`
// and `skipped` are how many of them land on the model and how many
// don't (off the face, on a hole already there), so the button can say
// what it will do.
const PATTERNS = [
  { value: "row", label: "Row" },
  { value: "grid", label: "Grid" },
  { value: "circle", label: "Circle" },
];

export default function RepeatFields({ options, onChange, placed, skipped, onApply, onCancel }) {
  const id = useId();
  const number = (key, label, { min, step = 1, title } = {}) => (
    <label className="field" htmlFor={`${id}-${key}`} title={title}>
      <span className="field-label">{label}</span>
      <input
        id={`${id}-${key}`}
        type="number"
        min={min}
        step={step}
        value={options[key]}
        onChange={(e) => onChange({ [key]: e.target.value === "" ? 0 : Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="holes-spec holes-repeat">
      <label className="field" htmlFor={`${id}-pattern`}>
        <span className="field-label">Repeat as a</span>
        <select id={`${id}-pattern`} value={options.pattern} onChange={(e) => onChange({ pattern: e.target.value })}>
          {PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {options.pattern === "row" && (
        <div className="holes-spec-grid">
          {number("count", "Holes", { min: 2, title: "How many in the row, this one included." })}
          {number("spacing", "Spacing (mm)", { step: 0.5, title: "Centre to centre. Negative runs the row the other way." })}
          <label className="field" htmlFor={`${id}-along`} title="Across the face, or up it: straight up on a wall, the part's Y on a face lying flat.">
            <span className="field-label">Direction</span>
            <select id={`${id}-along`} value={options.along} onChange={(e) => onChange({ along: e.target.value })}>
              <option value="across">Across</option>
              <option value="up">Up</option>
            </select>
          </label>
        </div>
      )}
      {options.pattern === "grid" && (
        <div className="holes-spec-grid">
          {number("columns", "Across", { min: 1, title: "Holes across the face, this one included." })}
          {number("rows", "Up", { min: 1, title: "Holes up the face, this one included." })}
          {number("spacingAcross", "Spacing across (mm)", { step: 0.5, title: "Centre to centre. Negative runs the other way." })}
          {number("spacingUp", "Spacing up (mm)", { step: 0.5, title: "Centre to centre. Negative runs the other way." })}
        </div>
      )}
      {options.pattern === "grid" && (
        <div className="holes-repeat-actions">
          <label className="field field-checkbox holes-through-field" htmlFor={`${id}-stagger`} title="Every other row shifted half a spacing across, the way a Skådis board has its slots.">
            <input id={`${id}-stagger`} type="checkbox" checked={options.stagger} onChange={(e) => onChange({ stagger: e.target.checked })} />
            <span className="field-label">Stagger rows</span>
          </label>
          <button
            type="button"
            className="render-button holes-small-button"
            title="Skådis spacing: 40 mm across, 20 mm up, every other row shifted 20 mm. With a Skådis slot, the part takes Skådis hooks."
            onClick={() => onChange({ spacingAcross: SKADIS_SPACING.across, spacingUp: SKADIS_SPACING.up, stagger: true })}
          >
            Skådis spacing
          </button>
        </div>
      )}
      {options.pattern === "circle" && (
        <>
          <div className="holes-spec-grid">
            {!options.skadisFill && number("circleCount", "Holes", { min: 2, title: "How many round the circle." })}
            {number("radius", "Radius (mm)", {
              min: 0,
              step: 0.5,
              title: options.skadisFill
                ? "How far out from this hole the pattern reaches."
                : "Round this hole's spot; the first hole goes straight up from it.",
            })}
          </div>
          <label
            className="field field-checkbox holes-through-field"
            htmlFor={`${id}-skadis`}
            title={`Fill the circle with a Skådis board's pattern instead of a ring: ${SKADIS_SPACING.across} mm across, ${SKADIS_SPACING.up} mm up, every other row shifted ${SKADIS_SPACING.across / 2} mm, centred on this hole.`}
          >
            <input id={`${id}-skadis`} type="checkbox" checked={options.skadisFill} onChange={(e) => onChange({ skadisFill: e.target.checked })} />
            <span className="field-label">Skådis spacing, filling the circle</span>
          </label>
          {!options.skadisFill && (
            <label className="field field-checkbox holes-through-field" htmlFor={`${id}-center`} title="Keep this hole where it is, in the middle of the circle. Off, it moves onto the circle as its first hole.">
              <input id={`${id}-center`} type="checkbox" checked={options.keepCenter} onChange={(e) => onChange({ keepCenter: e.target.checked })} />
              <span className="field-label">Keep this hole in the centre</span>
            </label>
          )}
        </>
      )}
      <p className="muted holes-params-note">
        {placed === 0 ? "No copies land on the model." : `${placed} ${placed === 1 ? "copy" : "copies"}, shown in green.`}
        {skipped > 0 && ` ${skipped} would miss the face or sit on a hole already there, and ${skipped === 1 ? "is" : "are"} left out.`}
      </p>
      <div className="holes-repeat-actions">
        <button type="button" className="render-button holes-small-button" onClick={onApply} disabled={placed === 0}>
          {placed === 0 ? "Add copies" : `Add ${placed} ${placed === 1 ? "copy" : "copies"}`}
        </button>
        <button type="button" className="render-button holes-small-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
