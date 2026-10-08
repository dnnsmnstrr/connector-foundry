// Two turn buttons — ↺ (+step) and ↻ (−step), a quarter turn unless the
// caller says otherwise (`step`, degrees). `onRotate(delta)` gets the
// signed degrees; positive is counter-clockwise as seen from
// `viewedFrom`, which also goes in the tooltips. Every rotation in the
// app shares that convention: a Bench part's spin (BOSL2's, see
// assembly.js's addChild()) reads counter-clockwise looking at the slot
// it sits on, a Holes slot's direction counter-clockwise looking at its
// face (screwHoles.js's slotFrame()).
//
// Used floating over the selected Bench part in the scene, and inside
// RotationInput next to an exact angle field.
export default function SpinButtons({ name, onRotate, viewedFrom = "above the slot", className = "", step = 90 }) {
  return (
    <span className={`spin-buttons ${className}`.trim()} role="group" aria-label={`Rotate ${name}`}>
      <button
        type="button"
        className="spin-button"
        onClick={() => onRotate(step)}
        title={`Turn ${step}° counter-clockwise (viewed from ${viewedFrom})`}
        aria-label={`Turn ${name} ${step}° counter-clockwise`}
      >
        ↺
      </button>
      <button
        type="button"
        className="spin-button"
        onClick={() => onRotate(-step)}
        title={`Turn ${step}° clockwise (viewed from ${viewedFrom})`}
        aria-label={`Turn ${name} ${step}° clockwise`}
      >
        ↻
      </button>
    </span>
  );
}
