import DecimalInput from "../DecimalInput.jsx";

// The Holes tab's snapping controls, in a bar over the viewer's bottom
// right corner, beside the model they act on (they used to be a sidebar
// section, which pushed the hole list down): Snap on or off, and the two
// guides' sizes. Inset and radius only draw while snapping is on, so their
// fields are off with it.
//
// `snapOn` / `onSnapChange(on)` are the snapping toggle (the holes.snap
// command's too); `inset` / `onInsetChange(mm)` how far in from each edge
// the corner snap points sit; `radius` / `onRadiusChange(mm)` the center
// circle's radius, 0 for none.
/**
 * @param {{
 *   snapOn: boolean,
 *   onSnapChange: (on: boolean) => void,
 *   inset: number,
 *   onInsetChange: (mm: number) => void,
 *   radius: number,
 *   onRadiusChange: (mm: number) => void,
 * }} props
 */
export default function SnapBar({ snapOn, onSnapChange, inset, onInsetChange, radius, onRadiusChange }) {
  return (
    <div className="holes-snap-bar" role="group" aria-label="Snapping">
      <button
        type="button"
        className="holes-snap-toggle"
        aria-pressed={snapOn}
        aria-label="Snap to face features and guide lines"
        title="Clicks land on the face center, quadrant centers, existing holes, corner insets and the guide lines when one is within reach. Shift-click places freely."
        onClick={() => onSnapChange(!snapOn)}
      >
        Snap
      </button>
      <label
        className="holes-snap-field"
        title="How far in from each edge the corner snap points sit; a radial line runs from the face center through each of them"
      >
        <span className="holes-snap-field-label">Inset</span>
        <DecimalInput
          aria-label="Corner inset (mm)"
          min="0"
          step="0.5"
          value={inset}
          disabled={!snapOn}
          onChange={(value) => onInsetChange(Math.max(0, value))}
        />
      </label>
      <label
        className="holes-snap-field"
        title="A circle of this radius around the face center — a bolt circle. Snap points where it crosses the center lines and the radials; a click near it lands on it. 0 draws none."
      >
        <span className="holes-snap-field-label">Radius</span>
        <DecimalInput
          aria-label="Center radius (mm)"
          min="0"
          step="0.5"
          value={radius}
          disabled={!snapOn}
          onChange={(value) => onRadiusChange(Math.max(0, value))}
        />
      </label>
    </div>
  );
}
