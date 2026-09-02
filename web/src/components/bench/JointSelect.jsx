import { JOINTS } from "../../lib/assembly.js";

// The joint-type dropdown, as it appears both on an attached node's row
// and in the attach-a-part dialog.
export default function JointSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {JOINTS.map((joint) => (
        <option key={joint} value={joint}>
          {joint}
        </option>
      ))}
    </select>
  );
}
