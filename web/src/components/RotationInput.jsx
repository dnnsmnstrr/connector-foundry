import SpinButtons from "./SpinButtons.jsx";

// An angle in degrees: the exact field, and the quarter-turn buttons
// beside it. The Bench's "Rotation (°)" for an attached part and the
// Holes tab's "Direction (°)" for a connector slot are both this — the
// caller supplies the label around it.
//
//   value      degrees shown in the field
//   onChange   (degrees) for a typed angle; an emptied field is ignored
//              rather than read as 0, so clearing it to type a new
//              number doesn't snap the part round first
//   onRotate   (delta) for a button press, ±90
//   name       what is being turned, for the buttons' accessible names
//   viewedFrom where "counter-clockwise" is seen from (SpinButtons)
//   id         for the caller's <label htmlFor>
export default function RotationInput({ value, onChange, onRotate, name, viewedFrom, id }) {
  return (
    <span className="rotation-controls">
      <input
        id={id}
        type="number"
        step="90"
        min="-360"
        max="360"
        value={value}
        onChange={(e) => {
          if (e.target.value !== "") onChange(Number(e.target.value));
        }}
      />
      <SpinButtons name={name} onRotate={onRotate} viewedFrom={viewedFrom} />
    </span>
  );
}
