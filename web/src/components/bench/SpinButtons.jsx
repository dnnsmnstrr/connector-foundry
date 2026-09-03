// The two quarter-turn buttons for an attached part — ↺ (+90°) and ↻
// (−90°) about the part's mating axis. Used twice: floating over the
// selected part in the scene, and inline next to the sidebar's exact
// "Rotation (°)" field. `onRotate(delta)` gets the signed degrees; the
// sign convention is BOSL2's spin (see assembly.js's addChild()), so a
// positive turn reads counter-clockwise when you look at the slot the
// part sits on.
export default function SpinButtons({ name, onRotate, className = "" }) {
  return (
    <span className={`bench-spin-buttons ${className}`.trim()} role="group" aria-label={`Rotate ${name}`}>
      <button
        type="button"
        className="bench-spin-button"
        onClick={() => onRotate(90)}
        title="Turn 90° counter-clockwise (viewed from above the slot)"
        aria-label={`Turn ${name} 90° counter-clockwise`}
      >
        ↺
      </button>
      <button
        type="button"
        className="bench-spin-button"
        onClick={() => onRotate(-90)}
        title="Turn 90° clockwise (viewed from above the slot)"
        aria-label={`Turn ${name} 90° clockwise`}
      >
        ↻
      </button>
    </span>
  );
}
