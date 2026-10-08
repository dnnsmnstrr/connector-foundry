import { presetGroups } from "../../lib/screwPresets.js";
import ScrewIcon from "./ScrewIcon.jsx";

// The screw presets as a grid of cross-section icons, grouped by kind
// (socket cap, countersunk, heat-set insert, …). `value` is the preset
// id currently in effect; picking one calls onPick(preset) and the
// caller copies its spec into whatever it is editing (the next hole, or
// the selected one).
export default function PresetPicker({ value, onPick }) {
  return (
    <div className="holes-presets">
      {presetGroups().map(({ group, presets }) => (
        <section key={group} className="holes-preset-group" aria-label={group}>
          <h4>{group}</h4>
          <div className="holes-preset-grid" role="listbox" aria-label={group}>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="option"
                aria-selected={preset.id === value}
                className={preset.id === value ? "holes-preset-button is-active" : "holes-preset-button"}
                onClick={() => onPick(preset)}
                aria-label={preset.name}
                title={`${preset.name} — ${describe(preset.spec)}`}
              >
                <ScrewIcon spec={preset.spec} screw={preset.screw} />
                <span className="holes-preset-name">{shortName(preset)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// "M3" under the icon when the group already says what kind it is; a
// preset that names its own short form (the connector slots) uses that.
function shortName(preset) {
  if (preset.short) return preset.short;
  const m = preset.name.match(/^(M\d+(?:\.\d+)?)\b/);
  if (m) return m[1];
  const mm = preset.name.match(/(\d+(?:\.\d+)?) mm/);
  if (mm) return `${mm[1]} mm`;
  return preset.name;
}

function describe(spec) {
  if (spec.kind === "openconnect") return `openConnect slot, lock nub ${spec.lock}, ${spec.sideClearance} mm side / ${spec.depthClearance} mm depth clearance`;
  if (spec.kind === "thread") return `openGrid snap thread, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}, ${spec.clearance} mm clearance`;
  if (spec.kind === "extrusion") return `Socket for a 2020 extrusion's end, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}, ${spec.clearance} mm clearance${spec.keys ? ", keyed into its slots" : ""}${spec.bolt ? ", M5 bolt hole" : ""}`;
  if (spec.kind === "klippt") return `KLIPPT clip channel: slides onto a KLIPPT base; ${spec.pocket ? "a drop-in pocket at the entry" : `open, ${spec.runout} mm lead-in`}, ${spec.clearance} mm clearance a side`;
  if (spec.kind === "pinhole") return `BitBeam pin hole: Ø4.8 with the groove a Technic pin clicks into, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}`;
  if (spec.kind === "cylinder") return `Round Ø${spec.diameter} mm, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}`;
  if (spec.kind === "rectangle") return `${spec.width} × ${spec.height} mm cutout${spec.cornerRadius > 0 ? `, ${spec.cornerRadius} mm corner radius` : ""}, ${spec.depth > 0 ? `${spec.depth} mm deep` : "through"}`;
  if (spec.kind === "multiconnect") return `MultiConnect slot, ${spec.length} mm channel${spec.onRamp ? (spec.rampEvery ? " with on-ramps every 28 mm" : " with on-ramp") : ", open-ended"}${spec.detent ? ", detent" : ", no detent"}`;
  const bits = [`Ø${spec.diameter} mm`, spec.depth > 0 ? `${spec.depth} mm deep` : "through"];
  if (spec.head === "counterbore") bits.push(`counterbore Ø${spec.headDiameter} × ${spec.headDepth}`);
  if (spec.head === "countersink") bits.push(`countersink Ø${spec.headDiameter}, ${spec.sinkAngle}°`);
  if (spec.head === "hex") bits.push(`hex pocket ${spec.headDiameter} × ${spec.headDepth}`);
  return bits.join(", ");
}
