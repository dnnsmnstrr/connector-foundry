// Two quarter-turn buttons — ↺ (+90°) and ↻ (−90°). `onRotate(delta)`
// gets the signed degrees; positive is counter-clockwise as seen from
// `viewedFrom`, which also goes in the tooltips. Every rotation in the
// app shares that convention: a Bench part's spin (BOSL2's, see
// assembly.js's addChild()) reads counter-clockwise looking at the slot
// it sits on, a Holes slot's direction counter-clockwise looking at its
// face (screwHoles.js's slotFrame()).
//
// Used floating over the selected Bench part in the scene, and inside
// RotationInput next to an exact angle field.
export default function SpinButtons({ name, onRotate, viewedFrom = "above the slot", className = "" }) {
  return (
    <span className={`spin-buttons ${className}`.trim()} role="group" aria-label={`Rotate ${name}`}>
      <button
        type="button"
        className="spin-button"
        onClick={() => onRotate(90)}
        title={`Turn 90° counter-clockwise (viewed from ${viewedFrom})`}
        aria-label={`Turn ${name} 90° counter-clockwise`}
      >
        ↺
      </button>
      <button
        type="button"
        className="spin-button"
        onClick={() => onRotate(-90)}
        title={`Turn 90° clockwise (viewed from ${viewedFrom})`}
        aria-label={`Turn ${name} 90° clockwise`}
      >
        ↻
      </button>
    </span>
  );
}
