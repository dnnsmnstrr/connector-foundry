import { useId, useState } from "react";
import { HEAD_STYLES } from "../../lib/screwPresets.js";

// The numeric side of a hole: shank diameter, through or blind (and how
// deep), the head pocket (none / counterbore / countersink / hex) with
// its diameter, how far it sinks, and a countersink's angle. One
// component for both the "new holes" spec and a selected hole's own —
// `spec` in, the whole next spec out through onChange.
export default function HoleSpecFields({ spec, onChange }) {
  const id = useId();
  // The depth a blind hole had before "Through" was ticked, so unticking
  // brings it back rather than starting from nothing.
  const [lastDepth, setLastDepth] = useState(spec.depth > 0 ? spec.depth : 6);
  const through = !(spec.depth > 0);

  const set = (patch) => onChange({ ...spec, ...patch });
  const number = (key, value) => set({ [key]: value === "" ? 0 : Number(value) });

  function toggleThrough(on) {
    if (on) {
      if (spec.depth > 0) setLastDepth(spec.depth);
      set({ depth: 0 });
    } else {
      set({ depth: lastDepth || 6 });
    }
  }

  const headLabel = { counterbore: "Pocket Ø", countersink: "Head Ø", hex: "Across corners" }[spec.head];
  const depthLabel = { counterbore: "Pocket depth", countersink: "Extra sink", hex: "Pocket depth" }[spec.head];

  return (
    <div className="holes-spec">
      <div className="holes-spec-grid">
        <label className="field" htmlFor={`${id}-d`}>
          <span className="field-label">Diameter (mm)</span>
          <input id={`${id}-d`} type="number" min="0.1" step="0.1" value={spec.diameter} onChange={(e) => number("diameter", e.target.value)} />
        </label>
        <label className="field" htmlFor={`${id}-depth`}>
          <span className="field-label">Depth (mm)</span>
          <input
            id={`${id}-depth`}
            type="number"
            min="0"
            step="0.5"
            value={through ? "" : spec.depth}
            placeholder="through"
            disabled={through}
            onChange={(e) => number("depth", e.target.value)}
          />
        </label>
      </div>
      <label className="field field-checkbox holes-through-field" htmlFor={`${id}-through`}>
        <input id={`${id}-through`} type="checkbox" checked={through} onChange={(e) => toggleThrough(e.target.checked)} />
        <span className="field-label">Through hole</span>
      </label>
      <label className="field" htmlFor={`${id}-head`}>
        <span className="field-label">Head</span>
        <select id={`${id}-head`} value={spec.head} onChange={(e) => set({ head: e.target.value })}>
          {HEAD_STYLES.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </label>
      {spec.head !== "none" && (
        <div className="holes-spec-grid">
          <label className="field" htmlFor={`${id}-hd`}>
            <span className="field-label">{headLabel} (mm)</span>
            <input id={`${id}-hd`} type="number" min="0" step="0.1" value={spec.headDiameter} onChange={(e) => number("headDiameter", e.target.value)} />
          </label>
          <label className="field" htmlFor={`${id}-hdepth`}>
            <span className="field-label">{depthLabel} (mm)</span>
            <input id={`${id}-hdepth`} type="number" min="0" step="0.1" value={spec.headDepth} onChange={(e) => number("headDepth", e.target.value)} />
          </label>
          {spec.head === "countersink" && (
            <label className="field" htmlFor={`${id}-angle`}>
              <span className="field-label">Angle (°)</span>
              <input id={`${id}-angle`} type="number" min="10" max="179" step="1" value={spec.sinkAngle} onChange={(e) => number("sinkAngle", e.target.value)} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
