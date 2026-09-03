// catalogueDefault + onReset: an "obvious way to see that a value
// differs from the catalogue default and reset it back" — a dot next
// to the label plus a reset button, shown only when the current value
// actually differs (deep-enough for the primitives every param is).
// Shared by Library mode and the Bench's per-node param editor.
export default function ParamField({ name, value, options, catalogueDefault, onChange, onReset }) {
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
      <label className="field">
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
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
      <label className="field field-checkbox">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="field">
        {label}
        <input type="number" value={value} step="any" onChange={(e) => onChange(Number(e.target.value))} />
      </label>
    );
  }
  return (
    <label className="field">
      {label}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
