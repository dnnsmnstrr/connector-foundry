import InfoTip from "./InfoTip.jsx";

// A field's label text, optionally paired with an InfoTip so its explanation
// is accessible on touch screens (where title= tooltips never appear) as
// well as on desktop hover and keyboard focus.
/**
 * @param {{
 *   children: import("react").ReactNode,
 *   hint?: string | null,
 *   className?: string,
 *   title?: string,
 * }} props
 */
export default function FieldLabel({ children, hint, className, title }) {
  const labelClass = className ? `field-label ${className}` : "field-label";
  return (
    <span className={labelClass} title={title}>
      {children}
      {hint && <InfoTip text={hint} />}
    </span>
  );
}
