import { useId } from "react";
import { SKADIS_SPACING, STANDARD_SPACINGS, matchSpacing, spacingLabel } from "../../lib/screwHoles.js";
import DecimalInput from "../DecimalInput.jsx";

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

/**
 * @param {{
 *   options: Record<string, any>,
 *   spacings?: readonly { id: string, label: string, short: string, across: number, up: number, stagger: boolean }[],
 *   onChange: (patch: Record<string, any>) => void,
 *   placed: number,
 *   skipped: number,
 *   onApply: () => void,
 *   onCancel: () => void,
 * }} props
 */
export default function RepeatFields({
  options,
  spacings = STANDARD_SPACINGS,
  onChange,
  placed,
  skipped,
  onApply,
  onCancel,
}) {
  const id = useId();
  /**
   * @param {string} key
   * @param {string} label
   * @param {{ min?: number | string, step?: number | string, title?: string }} [field]
   */
  const number = (key, label, { min, step = 1, title } = {}) => (
    <label className="field" htmlFor={`${id}-${key}`} title={title}>
      <span className="field-label">{label}</span>
      <DecimalInput
        id={`${id}-${key}`}
        min={min}
        step={step}
        value={options[key]}
        onChange={(value) => onChange({ [key]: value })}
      />
    </label>
  );
  // Row and grid alike: the pattern round this hole, or from it.
  const centered = (
    <label
      className="field field-checkbox holes-through-field"
      htmlFor={`${id}-centered`}
      title="Lay the pattern out round this hole's spot instead of from it as a corner. This hole stays put if a hole of the pattern lands on its spot (the middle of an odd row or an odd × odd grid); otherwise it moves to the pattern's first corner."
    >
      <input
        id={`${id}-centered`}
        type="checkbox"
        checked={Boolean(options.centered)}
        onChange={(e) => onChange({ centered: e.target.checked })}
      />
      <span className="field-label">Centre on this hole</span>
    </label>
  );
  return (
    <div className="holes-spec holes-repeat">
      <label className="field" htmlFor={`${id}-pattern`}>
        <span className="field-label">Repeat as a</span>
        <select
          id={`${id}-pattern`}
          value={options.pattern}
          onChange={(e) => onChange({ pattern: e.target.value })}
        >
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
          {number("spacing", "Spacing (mm)", {
            step: 0.5,
            title: "Centre to centre. Negative runs the row the other way.",
          })}
          <label
            className="field"
            htmlFor={`${id}-along`}
            title="Across the face, or up it: straight up on a wall, the part's Y on a face lying flat."
          >
            <span className="field-label">Direction</span>
            <select
              id={`${id}-along`}
              value={options.along}
              onChange={(e) => onChange({ along: e.target.value })}
            >
              <option value="across">Across</option>
              <option value="up">Up</option>
            </select>
          </label>
        </div>
      )}
      {options.pattern === "row" && centered}
      {options.pattern === "grid" && (
        <div className="holes-spec-grid">
          {number("columns", "Across", { min: 1, title: "Holes across the face, this one included." })}
          {number("rows", "Up", { min: 1, title: "Holes up the face, this one included." })}
          {number("spacingAcross", "Spacing across (mm)", {
            step: 0.5,
            title: "Centre to centre. Negative runs the other way.",
          })}
          {number("spacingUp", "Spacing up (mm)", {
            step: 0.5,
            title: "Centre to centre. Negative runs the other way.",
          })}
        </div>
      )}
      {options.pattern === "grid" && (
        <>
          <label
            className="field"
            htmlFor={`${id}-standard`}
            title="A system's hole pattern, the same spacings Measure shows round a hole: Gridfinity's magnet and screw holes (a cell's 2 × 2), openGrid, Skådis (every other row shifted), Multiboard, US pegboard, MOD-GRID, BitBeam, MOLLE panels and VESA monitor mounts."
          >
            <span className="field-label">Standard spacing</span>
            <select
              id={`${id}-standard`}
              value={matchSpacing(options, spacings)?.id ?? ""}
              onChange={(e) => {
                const spacing = spacings.find((s) => s.id === e.target.value);
                if (spacing)
                  onChange({
                    spacingAcross: spacing.across,
                    spacingUp: spacing.up,
                    stagger: spacing.stagger,
                    standard: spacing.id,
                  });
              }}
            >
              <option value="">Custom</option>
              {spacings.map((s) => (
                <option key={s.id} value={s.id}>
                  {spacingLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label
            className="field field-checkbox holes-through-field"
            htmlFor={`${id}-stagger`}
            title="Every other row shifted half a spacing across, the way a Skådis board has its slots."
          >
            <input
              id={`${id}-stagger`}
              type="checkbox"
              checked={options.stagger}
              onChange={(e) => onChange({ stagger: e.target.checked })}
            />
            <span className="field-label">Stagger rows</span>
          </label>
          {centered}
        </>
      )}
      {options.pattern === "circle" && (
        <>
          <div className="holes-spec-grid">
            {!options.skadisFill &&
              number("circleCount", "Holes", { min: 2, title: "How many round the circle." })}
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
            <input
              id={`${id}-skadis`}
              type="checkbox"
              checked={options.skadisFill}
              onChange={(e) => onChange({ skadisFill: e.target.checked })}
            />
            <span className="field-label">Skådis spacing, filling the circle</span>
          </label>
          {!options.skadisFill && (
            <label
              className="field field-checkbox holes-through-field"
              htmlFor={`${id}-center`}
              title="Keep this hole where it is, in the middle of the circle. Off, it moves onto the circle as its first hole."
            >
              <input
                id={`${id}-center`}
                type="checkbox"
                checked={options.keepCenter}
                onChange={(e) => onChange({ keepCenter: e.target.checked })}
              />
              <span className="field-label">Keep this hole in the centre</span>
            </label>
          )}
        </>
      )}
      <p className="muted holes-params-note">
        {placed === 0
          ? "No copies land on the model."
          : `${placed} ${placed === 1 ? "copy" : "copies"}, shown in green.`}
        {skipped > 0 &&
          ` ${skipped} would miss the face or sit on a hole already there, and ${skipped === 1 ? "is" : "are"} left out.`}
      </p>
      <div className="holes-repeat-actions">
        <button
          type="button"
          className="render-button holes-small-button"
          onClick={onApply}
          disabled={placed === 0}
        >
          {placed === 0 ? "Add copies" : `Add ${placed} ${placed === 1 ? "copy" : "copies"}`}
        </button>
        <button type="button" className="render-button holes-small-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
