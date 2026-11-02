import { useId } from "react";
import { optionLabel } from "../lib/labels.js";
import DecimalInput from "./DecimalInput.jsx";

// catalogueDefault + onReset: an "obvious way to see that a value
// differs from the catalogue default and reset it back" — a dot next
// to the label plus a reset button, shown only when the current value
// actually differs (deep-enough for the primitives every param is).
// Shared by Library mode and the Bench's per-node param editor.
//
// `min`/`max` (catalogue.yaml's `minimums`/`maximums`): the number
// field's arrows stop there (the arrow buttons disable at the limit), and
// a value typed past one is brought back to it when the field loses
// focus — not on every keystroke, which would turn the "1" of a "10"
// being typed into the minimum. Decimals take a comma or a period.
//
// `label` is what the field is called on screen (lib/labels.js's
// paramLabel(): "Width (cells)"); `name` is the parameter's own name
// ("gx"), shown when the pointer rests on the label, for anyone moving
// between the app and the CLI. Without a label the name is the label.
/**
 * @param {{
 *   name: string,
 *   label?: string,
 *   value: any,
 *   options?: any[],
 *   min?: number | string,
 *   max?: number | string,
 *   catalogueDefault?: any,
 *   onChange: (value: any) => void,
 *   onReset?: () => void,
 * }} props
 */
export default function ParamField({
  name,
  label: text = name,
  value,
  options,
  min,
  max,
  catalogueDefault,
  onChange,
  onReset,
}) {
  // The reset button is labelable too. Explicit association keeps the
  // field's accessible name when that button appears after an edit.
  const inputId = useId();
  const differs = catalogueDefault !== undefined && value !== catalogueDefault;
  const label = (
    <span className="field-label" title={text === name ? undefined : `Parameter: ${name}`}>
      {differs && (
        <span
          className="field-differs"
          role="img"
          aria-label={`Differs from catalogue default ${catalogueDefault}`}
          title={`Catalogue default: ${catalogueDefault}`}
        />
      )}
      {text}
      {differs && onReset && (
        <button
          type="button"
          className="field-reset"
          aria-label={`Reset ${text} to catalogue default`}
          title="Reset to catalogue default"
          onClick={onReset}
        >
          ↺
        </button>
      )}
    </span>
  );

  if (options) {
    return (
      <label htmlFor={inputId} className="field">
        {label}
        <select
          id={inputId}
          value={value}
          // An <option>'s value is always a string; hand back the catalogue's
          // own option (a number for e.g. `pegs: [1, 2]`), or the .scad
          // literal, the "differs from default" check and a saved default
          // would all get "2" where the part expects 2.
          onChange={(e) => onChange(options.find((o) => String(o) === e.target.value) ?? e.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label htmlFor={inputId} className="field field-checkbox">
        <input id={inputId} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label htmlFor={inputId} className="field">
        {label}
        <DecimalInput id={inputId} value={value} min={min} max={max} onChange={onChange} />
      </label>
    );
  }
  return (
    <label htmlFor={inputId} className="field">
      {label}
      <input id={inputId} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
