import { useEffect, useRef, useState } from "react";
import { parseDecimal } from "../lib/decimalInput.js";

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
// Still a spinbutton for assistive tech and ArrowUp/ArrowDown, like the
// native field: ±step, ten steps with Shift.
export default function DecimalInput({ value, min, max, step = 1, onChange, ...props }) {
  const [draft, setDraft] = useState(null);
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
  const clamp = (n) => {
    if (min !== undefined && n < Number(min)) return Number(min);
    if (max !== undefined && n > Number(max)) return Number(max);
    return n;
  };
  const report = (next) => {
    reported.current = next;
    if (next !== value) onChange(next);
  };

  return (
    <input
      {...props}
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
        const delta = (e.key === "ArrowUp" ? 1 : -1) * Number(step) * (e.shiftKey ? 10 : 1);
        // Rounded so 0.1 + 1 doesn't show as 1.1000000000000001.
        setDraft(null);
        report(clamp(Math.round((value + delta) * 1e9) / 1e9));
      }}
    />
  );
}
