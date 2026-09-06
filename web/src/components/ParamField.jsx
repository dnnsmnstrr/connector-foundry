import { useId } from "react";

// catalogueDefault + onReset: an "obvious way to see that a value
// differs from the catalogue default and reset it back" — a dot next
// to the label plus a reset button, shown only when the current value
// actually differs (deep-enough for the primitives every param is).
// Shared by Library mode and the Bench's per-node param editor.
export default function ParamField({ name, value, options, catalogueDefault, onChange, onReset }) {
  // The reset button is labelable too. Explicit association keeps the
  // field's accessible name when that button appears after an edit.
  const inputId = useId();
  const differs = catalogueDefault !== undefined && value !== catalogueDefault;
  const label = (
    <span className="field-label">
      {differs && (
        <span
          className="field-differs"
          role="img"
          aria-label={`Differs from catalogue default ${catalogueDefault}`}
          title={`Catalogue default: ${catalogueDefault}`}
        />
      )}
      {name}
      {differs && onReset && (
        <button
          type="button"
          className="field-reset"
          aria-label={`Reset ${name} to catalogue default`}
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
        <select id={inputId} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
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
        <input id={inputId} type="number" value={value} step="any" onChange={(e) => onChange(Number(e.target.value))} />
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
