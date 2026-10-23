import { useEffect, useId, useRef, useState } from "react";

// A small "?" beside a label that shows `text` on hover, on keyboard
// focus, or — since a finger can do neither — toggled by a tap: open, it
// stays until a tap elsewhere, Escape, or another tap on it. A real
// button so it can be focused; the text is its accessible description.
/** @param {{ text: string, label?: string }} props */
export default function InfoTip({ text, label = "More information" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef(/** @type {HTMLElement | null} */ (null));

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!ref.current?.contains(/** @type {Node} */ (e.target))) setOpen(false);
    };
    // Escape closes the tip and nothing more: the dialog it sits in
    // would otherwise close on the same key (a native <dialog>'s cancel
    // is the key's default action, which preventDefault() stops).
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <span ref={ref} className={open ? "info-tip is-open" : "info-tip"}>
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        // A click inside a <label> would otherwise toggle the checkbox or
        // focus the field the label belongs to.
        onClick={(e) => {
          e.preventDefault();
          setOpen((was) => !was);
        }}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="info-tip-text">
        {text}
      </span>
    </span>
  );
}
