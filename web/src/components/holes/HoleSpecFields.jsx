import { useEffect, useId, useRef, useState } from "react";
import { HEAD_STYLES, LOCK_SIDES } from "../../lib/screwPresets.js";
import RotationInput from "../RotationInput.jsx";

// The numeric side of a hole. For a screw hole: shank diameter, through
// or blind (and how deep), the head pocket (none / counterbore /
// countersink / hex) with its diameter, how far it sinks, and a
// countersink's angle. For a connector slot: the few choices the
// system leaves open (an openConnect slot's lock side and clearances;
// a MultiConnect slot's channel length, on-ramp, detent and
// clearance) and which way on the face is up.
//
// One component for the "new holes" spec, a selected hole's own, and
// several selected holes at once:
//   spec       the values to show; with several holes, only the fields
//              they share (screwHoles.js's sharedSpec())
//   mixed      the fields they don't share (a Set) — shown empty with
//              "mixed", an indeterminate checkbox, or a "Mixed" menu
//              entry, and left alone until the user sets one
//   onChange   (patch) with just the fields that changed
//   onRotate   (delta) from the direction's quarter-turn buttons — kept
//              apart from onChange so several slots each turn from
//              their own direction
//   count      how many holes this edits, for the slot's button labels
const NOTHING_MIXED = new Set();

export default function HoleSpecFields({ spec, mixed = NOTHING_MIXED, onChange, onRotate, count = 1 }) {
  const id = useId();
  // The depth a blind hole had before "Through" was ticked, so unticking
  // brings it back rather than starting from nothing.
  const [lastDepth, setLastDepth] = useState(spec.depth > 0 ? spec.depth : 6);
  const through = !mixed.has("depth") && !(spec.depth > 0);

  const set = (patch) => onChange(patch);
  const isMixed = (key) => mixed.has(key);
  // A number field: its value, or empty with "mixed". Clearing a field
  // that shows a value sets 0, as it always has; clearing a mixed one
  // (already empty) does nothing.
  const numberProps = (key, extra = {}) => ({
    value: isMixed(key) ? "" : spec[key],
    placeholder: isMixed(key) ? "mixed" : extra.placeholder,
    onChange: (e) => {
      if (e.target.value === "" && isMixed(key)) return;
      set({ [key]: e.target.value === "" ? 0 : Number(e.target.value) });
    },
  });

  function toggleThrough(on) {
    if (on) {
      if (spec.depth > 0) setLastDepth(spec.depth);
      set({ depth: 0 });
    } else {
      set({ depth: lastDepth || 6 });
    }
  }

  // Which way the slot points on its face: 0 is the face's own "up"
  // (straight up on a wall-like face; the part's Y on a face lying
  // flat), turned counter-clockwise as
  // seen from outside the face. Quarter turns cover every orientation
  // a mount is likely to need; any angle is accepted.
  // The same field and quarter-turn buttons as a Bench part's rotation
  // (components/RotationInput.jsx).
  const spinField = (
    <label className="field holes-direction-field" htmlFor={`${id}-spin`} title="Which way the head travels to seat — up on the wall. 0 is up — straight up on a vertical face, the part's Y on a face lying flat — turned counter-clockwise as seen from outside the face; the arrows step by 90°.">
      <span className="field-label">Direction (°)</span>
      <RotationInput
        id={`${id}-spin`}
        value={isMixed("spin") ? "" : spec.spin}
        placeholder={isMixed("spin") ? "mixed" : undefined}
        onChange={(degrees) => set({ spin: degrees })}
        onRotate={onRotate}
        name={count > 1 ? `the ${count} slots` : "the slot"}
        viewedFrom="outside the face"
      />
    </label>
  );

  if (spec.kind === "openconnect") {
    return (
      <div className="holes-spec">
        <label className="field" htmlFor={`${id}-lock`}>
          <span className="field-label">Lock nub</span>
          <MixedSelect id={`${id}-lock`} value={spec.lock} mixed={isMixed("lock")} options={LOCK_SIDES} onChange={(lock) => set({ lock })} />
        </label>
        <div className="holes-spec-grid">
          <label className="field" htmlFor={`${id}-side`} title="Added around the head, per side. Increase if the slot feels too tight.">
            <span className="field-label">Side gap (mm)</span>
            <input id={`${id}-side`} type="number" min="0" step="0.05" {...numberProps("sideClearance")} />
          </label>
          <label className="field" htmlFor={`${id}-depth`} title="Added under the head's pocket.">
            <span className="field-label">Depth gap (mm)</span>
            <input id={`${id}-depth`} type="number" min="0" step="0.05" {...numberProps("depthClearance")} />
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
          <label className="field" htmlFor={`${id}-length`} title="How far the channel runs down from the round end the head rests in. 28 mm is one openGrid cell; Multiboard spaces its slots 25 mm apart.">
            <span className="field-label">Channel (mm)</span>
            <input id={`${id}-length`} type="number" min="1" step="1" {...numberProps("length")} />
          </label>
          <label className="field" htmlFor={`${id}-clear`} title="Added to every radius. The published slot already has 0.15 mm on the head.">
            <span className="field-label">Extra gap (mm)</span>
            <input id={`${id}-clear`} type="number" min="0" step="0.05" {...numberProps("clearance")} />
          </label>
        </div>
        {spinField}
        <label className="field field-checkbox holes-through-field" htmlFor={`${id}-ramp`} title="A funnel at the channel's far end to push the head in through. Without it the channel is open-ended, for an item that slides on from its edge.">
          <MixedCheckbox id={`${id}-ramp`} checked={spec.onRamp} mixed={isMixed("onRamp")} onChange={(onRamp) => set({ onRamp })} />
          <span className="field-label">On-ramp at the entry</span>
        </label>
        <label
          className="field field-checkbox holes-through-field"
          htmlFor={`${id}-ramp-every`}
          title="For an item hung on several heads one above the other, 28 mm apart: an on-ramp every 28 mm down the channel, so the item is pushed onto all the heads at once and slid down one cell. Make the channel a multiple of 28 mm long."
        >
          <MixedCheckbox
            id={`${id}-ramp-every`}
            checked={spec.rampEvery}
            mixed={isMixed("rampEvery")}
            disabled={!isMixed("onRamp") && !spec.onRamp}
            onChange={(rampEvery) => set({ rampEvery })}
          />
          <span className="field-label">On-ramp every 28 mm</span>
        </label>
        <label className="field field-checkbox holes-through-field" htmlFor={`${id}-detent`} title="The v2 detent: the channel narrows 0.4 mm just below the round end so a seated head clicks in. Off for a quick-release mount.">
          <MixedCheckbox id={`${id}-detent`} checked={spec.detent} mixed={isMixed("detent")} onChange={(detent) => set({ detent })} />
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
  // Head fields only when the holes agree on a head that has a pocket:
  // with mixed heads, a "Pocket depth" would mean different things.
  const showHead = !isMixed("head") && spec.head !== "none";

  return (
    <div className="holes-spec">
      <div className="holes-spec-grid">
        <label className="field" htmlFor={`${id}-d`}>
          <span className="field-label">Diameter (mm)</span>
          <input id={`${id}-d`} type="number" min="0.1" step="0.1" {...numberProps("diameter")} />
        </label>
        <label className="field" htmlFor={`${id}-depth`}>
          <span className="field-label">Depth (mm)</span>
          <input
            id={`${id}-depth`}
            type="number"
            min="0"
            step="0.5"
            {...numberProps("depth", { placeholder: "through" })}
            value={isMixed("depth") || through ? "" : spec.depth}
            disabled={through}
          />
        </label>
      </div>
      <label className="field field-checkbox holes-through-field" htmlFor={`${id}-through`}>
        <MixedCheckbox id={`${id}-through`} checked={through} mixed={isMixed("depth")} onChange={toggleThrough} />
        <span className="field-label">Through hole</span>
      </label>
      <label className="field" htmlFor={`${id}-head`}>
        <span className="field-label">Head</span>
        <MixedSelect id={`${id}-head`} value={spec.head} mixed={isMixed("head")} options={HEAD_STYLES} onChange={(head) => set({ head })} />
      </label>
      {showHead && (
        <div className="holes-spec-grid">
          <label className="field" htmlFor={`${id}-hd`}>
            <span className="field-label">{headLabel} (mm)</span>
            <input id={`${id}-hd`} type="number" min="0" step="0.1" {...numberProps("headDiameter")} />
          </label>
          <label className="field" htmlFor={`${id}-hdepth`}>
            <span className="field-label">{depthLabel} (mm)</span>
            <input id={`${id}-hdepth`} type="number" min="0" step="0.1" {...numberProps("headDepth")} />
          </label>
          {spec.head === "countersink" && (
            <label className="field" htmlFor={`${id}-angle`}>
              <span className="field-label">Angle (°)</span>
              <input id={`${id}-angle`} type="number" min="10" max="179" step="1" {...numberProps("sinkAngle")} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// A checkbox that can say "some are, some aren't" (indeterminate) for
// several holes that disagree; ticking it sets them all.
function MixedCheckbox({ id, checked, mixed, disabled = false, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return <input ref={ref} id={id} type="checkbox" checked={!mixed && Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

// A <select> with a "Mixed" entry while the holes disagree — shown, not
// pickable — so picking any real option sets them all.
function MixedSelect({ id, value, mixed, options, onChange }) {
  return (
    <select id={id} value={mixed ? "" : value} onChange={(e) => onChange(e.target.value)}>
      {mixed && (
        <option value="" disabled>
          Mixed
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
