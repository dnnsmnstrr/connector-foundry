import { JOINTS, JOINT_LABELS } from "../../lib/assembly.js";

// The joint-type dropdown, as it appears both on an attached node's row
// and in the attach-a-part dialog. `options` narrows the list (a node
// row offers "screwed" only where a screw pattern is present — see
// assembly.js's jointsFor()); the dialog offers everything and filters
// the parts instead.
export default function JointSelect({ value, onChange, options = JOINTS }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((joint) => (
        <option key={joint} value={joint}>
          {JOINT_LABELS[joint] ?? joint}
        </option>
      ))}
    </select>
  );
}
