import { useSyncExternalStore } from "react";
import InfoTip from "./InfoTip.jsx";

// A field's explanation where a touch screen can reach it. Most fields
// explain themselves in a `title`, which a mouse shows on hover and a
// finger never does; on a coarse pointer this renders InfoTip's "?"
// beside the label, which opens on a tap. With a mouse it renders
// nothing, and the field's `title` goes on doing the job, so a desktop
// screen looks as it did. Place it inside the field's label, after its
// text; the label (`.field`, `.field-checkbox` or `.has-info-tip`) is
// what the opened tip spans.

const COARSE = "(pointer: coarse)";

function subscribe(onChange) {
  const query = typeof window !== "undefined" ? window.matchMedia?.(COARSE) : null;
  // An iPad gaining or losing a trackpad changes the answer.
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

const isCoarse = () => typeof window !== "undefined" && window.matchMedia?.(COARSE).matches === true;

/**
 * @param {{ text: string, label?: string }} props
 *   text: the explanation (the same text as the field's `title`);
 *   label: the button's accessible name.
 */
export default function FieldHint({ text, label = "What is this?" }) {
  const coarse = useSyncExternalStore(subscribe, isCoarse, () => false);
  if (!coarse || !text) return null;
  // Hidden from assistive technology and out of the tab order: inside a
  // <label> a button's name becomes part of the field's own ("Width (mm)
  // What is this?"), read on every field, and a screen reader already
  // gets the field's `title` as its description. This is for the eye
  // and the finger.
  return (
    <span className="field-hint" aria-hidden="true">
      <InfoTip text={text} label={label} focusable={false} />
    </span>
  );
}
