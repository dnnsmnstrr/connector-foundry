import { useId } from "react";

// A small "?" beside a label that shows `text` on hover or keyboard
// focus — for the detail a setting needs that would otherwise be a
// paragraph under it. A real button so it can be focused; the text is
// its accessible description, and also a plain `title` for whatever
// doesn't show the styled tip.
export default function InfoTip({ text, label = "More information" }) {
  const id = useId();
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-describedby={id}
        // A click inside a <label> would otherwise toggle the checkbox or
        // focus the field the label belongs to.
        onClick={(e) => e.preventDefault()}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="info-tip-text">
        {text}
      </span>
    </span>
  );
}
