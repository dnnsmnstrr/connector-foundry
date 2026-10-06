import { useId, useState } from "react";
import { HEAD_STYLES, LOCK_SIDES } from "../../lib/screwPresets.js";

// The numeric side of a hole. For a screw hole: shank diameter, through
// or blind (and how deep), the head pocket (none / counterbore /
// countersink / hex) with its diameter, how far it sinks, and a
// countersink's angle. For a connector slot: the few choices the
// system leaves open (an openConnect slot's lock side and clearances;
// a MultiConnect slot's channel length, on-ramp, detent and
// clearance) and which way on the face is up. One component for both
// the "new holes" spec and a selected hole's own — `spec` in, the whole
// next spec out through onChange.
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

  // Which way the slot points on its face: 0 is the face's own "up"
  // (the part's Y on a plate lying flat), turned counter-clockwise as
  // seen from outside the face. Quarter turns cover every orientation
  // a mount is likely to need; any angle is accepted.
  const spinField = (
    <label className="field" htmlFor={`${id}-spin`} title="Which way the head travels to seat — up on the wall. 0 is the face's own up (the part's Y on a plate lying flat), turned counter-clockwise as seen from outside the face.">
      <span className="field-label">Direction (°)</span>
      <input id={`${id}-spin`} type="number" step="90" value={spec.spin} onChange={(e) => number("spin", e.target.value)} />
    </label>
  );

  if (spec.kind === "openconnect") {
    return (
      <div className="holes-spec">
        <label className="field" htmlFor={`${id}-lock`}>
          <span className="field-label">Lock nub</span>
          <select id={`${id}-lock`} value={spec.lock} onChange={(e) => set({ lock: e.target.value })}>
            {LOCK_SIDES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <div className="holes-spec-grid">
          <label className="field" htmlFor={`${id}-side`} title="Added around the head, per side. Increase if the slot feels too tight.">
            <span className="field-label">Side gap (mm)</span>
            <input id={`${id}-side`} type="number" min="0" step="0.05" value={spec.sideClearance} onChange={(e) => number("sideClearance", e.target.value)} />
          </label>
          <label className="field" htmlFor={`${id}-depth`} title="Added under the head's pocket.">
            <span className="field-label">Depth gap (mm)</span>
            <input id={`${id}-depth`} type="number" min="0" step="0.05" value={spec.depthClearance} onChange={(e) => number("depthClearance", e.target.value)} />
          </label>
        </div>
        {spinField}
        <p className="muted holes-params-note">
          The point you click is the centre of the openGrid cell the snap sits in; the head seats 3.6 mm up from it. The slot
          needs about 3 mm of material under the surface.
        </p>
      </div>
    );
  }

  if (spec.kind === "multiconnect") {
    return (
      <div className="holes-spec">
        <div className="holes-spec-grid">
          <label className="field" htmlFor={`${id}-length`} title="How far the channel runs down from the round end the head rests in. Multiboard spaces its slots 25 mm apart.">
            <span className="field-label">Channel (mm)</span>
            <input id={`${id}-length`} type="number" min="1" step="1" value={spec.length} onChange={(e) => number("length", e.target.value)} />
          </label>
          <label className="field" htmlFor={`${id}-clear`} title="Added to every radius. The published slot already has 0.15 mm on the head.">
            <span className="field-label">Extra gap (mm)</span>
            <input id={`${id}-clear`} type="number" min="0" step="0.05" value={spec.clearance} onChange={(e) => number("clearance", e.target.value)} />
          </label>
        </div>
        {spinField}
        <label className="field field-checkbox holes-through-field" htmlFor={`${id}-ramp`} title="A funnel at the channel's far end to push the head in through. Without it the channel is open-ended, for an item that slides on from its edge.">
          <input id={`${id}-ramp`} type="checkbox" checked={spec.onRamp} onChange={(e) => set({ onRamp: e.target.checked })} />
          <span className="field-label">On-ramp at the entry</span>
        </label>
        <label className="field field-checkbox holes-through-field" htmlFor={`${id}-detent`} title="The v2 detent: the channel narrows 0.4 mm just below the round end so a seated head clicks in. Off for a quick-release mount.">
          <input id={`${id}-detent`} type="checkbox" checked={spec.detent} onChange={(e) => set({ detent: e.target.checked })} />
          <span className="field-label">Detent</span>
        </label>
        <p className="muted holes-params-note">
          The point you click is the round end the head rests in; the channel runs down from it. The slot needs about 4.5 mm
          of material under the surface.
        </p>
      </div>
    );
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
