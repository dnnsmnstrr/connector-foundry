import { JOINTS, JOINT_LABELS } from "../../lib/assembly.js";

// The joint-type dropdown, as it appears both on an attached node's row
// and in the attach-a-part dialog. `options` narrows the list (a node
// row offers "screwed" only where a screw pattern is present — see
// assembly.js's jointsFor()); the dialog offers everything and filters
// the parts instead. Anything else (aria-label, id) goes to the <select>.
/**
 * The rest of the props (aria-label, id, …) go to the <select>.
 * @param {Omit<import("react").SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
 *   value: string,
 *   onChange: (joint: string) => void,
 *   options?: readonly string[],
 * }} props
 */
export default function JointSelect({ value, onChange, options = JOINTS, ...rest }) {
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((joint) => (
        <option key={joint} value={joint}>
          {JOINT_LABELS[joint] ?? joint}
        </option>
      ))}
    </select>
  );
}
