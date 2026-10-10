import { useEffect, useRef, useState } from "react";
import { parseDecimal, stepDecimal, stepSize } from "../lib/decimalInput.js";

// A number field that takes a comma or a period as the decimal
// separator. An <input type="number"> reports "" for "3," (the browser
// can't parse it), which used to reach the parent as 0 and replace the
// typed text before the decimals could follow. Here the field keeps its
// own text while focused and only reports values that parse — an
// emptied field reports nothing; on blur it shows the value again,
// held to `min`/`max`.
//
// `value` may be "" for no single number (a "mixed" selection, a
// through hole); the field is then empty and shows its placeholder.
//
// Still a spinbutton, with what the native field had and a little more
// (lib/decimalInput.js's stepSize() has the amounts):
//   - ArrowUp/ArrowDown: ±step, ten steps with Shift.
//   - The arrow buttons inside its right edge: ±step a click, half a step
//     with Shift; held down, they repeat.
//   - The wheel, while the field has focus: ±step a tick, a tenth with
//     Shift. Only while focused, so scrolling the sidebar past a field
//     never changes it.
export default function DecimalInput({ value, min, max, step = 1, onChange, disabled, ...props }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  // The last value this field reported; a different `value` arriving
  // while focused (a reset, an undo) replaces the text being typed.
  const reported = useRef(value);
  useEffect(() => {
    if (value !== reported.current) {
      reported.current = value;
      setDraft(null);
    }
  }, [value]);

  const isNumber = typeof value === "number";
  const clamp = (n) => stepDecimal(n, 0, min, max);
  const report = (next) => {
    reported.current = next;
    if (next !== value) onChange(next);
  };
  // Steps from the last reported value rather than `value`, so a held
  // button or a fast wheel keeps counting before the parent re-renders.
  const stepBy = (delta) => {
    if (typeof reported.current !== "number") return;
    setDraft(null);
    report(stepDecimal(reported.current, delta, min, max));
  };
  const stepRef = useRef(stepBy);
  stepRef.current = stepBy;

  // The wheel. React's onWheel is passive, so preventDefault (keeping the
  // sidebar from scrolling under the pointer) needs a listener of our own.
  // Shift turns a vertical wheel horizontal on macOS and in Chromium on
  // Windows, so with Shift the horizontal delta counts too. A trackpad
  // sends many small deltas: they add up to one step per WHEEL_TICK px.
  const wheelRest = useRef(0);
  const stepSettings = useRef({ step });
  stepSettings.current = { step };
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const onWheel = (e) => {
      if (document.activeElement !== inputRef.current || inputRef.current.disabled) return;
      const raw = e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!raw) return;
      e.preventDefault();
      const px = raw * (e.deltaMode === 1 ? WHEEL_TICK : e.deltaMode === 2 ? 10 * WHEEL_TICK : 1);
      if (Math.sign(px) !== Math.sign(wheelRest.current)) wheelRest.current = 0;
      wheelRest.current += px;
      if (Math.abs(wheelRest.current) < WHEEL_TICK) return;
      // One step per event at most: a mouse's notch is one step whatever
      // delta the platform reports for it.
      const direction = wheelRest.current < 0 ? 1 : -1;
      wheelRest.current = 0;
      stepRef.current(direction * stepSize(stepSettings.current.step, "wheel", e.shiftKey));
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  // The arrow buttons: a step on press, then repeating while held, like
  // the native spinner (a pause, then quickly).
  const repeat = useRef(null);
  const stopRepeat = () => {
    if (!repeat.current) return;
    clearTimeout(repeat.current.timer);
    clearInterval(repeat.current.interval);
    repeat.current = null;
  };
  useEffect(() => stopRepeat, []);
  const press = (direction) => (e) => {
    if (e.button !== 0 || disabled || !isNumber) return;
    // Keep (or give) the field focus, so the wheel works next and blur
    // doesn't fire mid-press.
    e.preventDefault();
    inputRef.current?.focus();
    stopRepeat();
    const delta = direction * stepSize(step, "button", e.shiftKey);
    stepRef.current(delta);
    repeat.current = { timer: setTimeout(() => {
      repeat.current.interval = setInterval(() => stepRef.current(delta), REPEAT_EVERY_MS);
    }, REPEAT_AFTER_MS) };
  };

  return (
    <span className="decimal-input" ref={wrapRef}>
      <input
        {...props}
        ref={inputRef}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        role="spinbutton"
        aria-valuenow={isNumber ? value : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        value={draft ?? (isNumber ? String(value) : "")}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseDecimal(e.target.value);
          if (parsed !== null) report(parsed);
        }}
        onBlur={() => {
          setDraft(null);
          if (isNumber && clamp(value) !== value) report(clamp(value));
        }}
        onKeyDown={(e) => {
          if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || !isNumber) return;
          e.preventDefault();
          stepBy((e.key === "ArrowUp" ? 1 : -1) * stepSize(step, "key", e.shiftKey));
        }}
      />
      {/* Pointer-only: the field itself is the spinbutton, and its arrow
          keys do what these do. */}
      <span className="decimal-input-arrows" aria-hidden="true">
        {[1, -1].map((direction) => (
          <button
            key={direction}
            type="button"
            tabIndex={-1}
            className="decimal-input-arrow"
            disabled={disabled || !isNumber}
            title={direction > 0 ? "Increase (Shift: half a step)" : "Decrease (Shift: half a step)"}
            onPointerDown={press(direction)}
            onPointerUp={stopRepeat}
            onPointerLeave={stopRepeat}
            onPointerCancel={stopRepeat}
          >
            <svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true">
              <path d={direction > 0 ? "M0 5 4 0 8 5Z" : "M0 0 4 5 8 0Z"} fill="currentColor" />
            </svg>
          </button>
        ))}
      </span>
    </span>
  );
}

const WHEEL_TICK = 40;
const REPEAT_AFTER_MS = 400;
const REPEAT_EVERY_MS = 60;
