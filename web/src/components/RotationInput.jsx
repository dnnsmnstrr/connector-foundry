import DecimalInput from "./DecimalInput.jsx";
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
//   onRotate   (delta) for a button press, ±step
//   step       degrees per button press, and the field's arrow-key step:
//              90 unless the caller says otherwise
//   name       what is being turned, for the buttons' accessible names
//   viewedFrom where "counter-clockwise" is seen from (SpinButtons)
//   id         for the caller's <label htmlFor>
//   placeholder shown when `value` is "" — "mixed", for several things
//              that point different ways (the buttons still turn each
//              from its own angle)
export default function RotationInput({ value, onChange, onRotate, name, viewedFrom, id, placeholder, step = 90 }) {
  return (
    <span className="rotation-controls">
      <DecimalInput id={id} step={step} min="-360" max="360" value={value} placeholder={placeholder} onChange={onChange} />
      <SpinButtons name={name} onRotate={onRotate} viewedFrom={viewedFrom} step={step} />
    </span>
  );
}
