// Reads what is typed into a number field, accepting a comma or a period
// as the decimal separator (a German keyboard's numpad types a comma).
// Returns the number, or null while the text is not one yet — "", "-",
// or anything else that isn't a plain decimal. A text that is still
// being typed but already reads as a number ("3,", "3.", ".5") gives
// that number, so the field can keep showing the separator.
export function parseDecimal(text) {
  const normalized = String(text).trim().replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// `value` moved by `delta`, held to `min`/`max` (either may be undefined
// or a numeric string, as the fields get them), and rounded so 0.1 + 1
// doesn't show as 1.1000000000000001.
export function stepDecimal(value, delta, min, max) {
  let next = Math.round((value + delta) * 1e9) / 1e9;
  if (min !== undefined && min !== "" && next < Number(min)) next = Number(min);
  if (max !== undefined && max !== "" && next > Number(max)) next = Number(max);
  return next;
}

// Whether `value` already sits at the limit a step in `direction` (+1
// up, -1 down) moves towards, so that arrow has nothing left to do.
export function atLimit(value, direction, min, max) {
  const limit = direction > 0 ? max : min;
  if (typeof value !== "number" || limit === undefined || limit === "" || limit === null) return false;
  return direction > 0 ? value >= Number(limit) : value <= Number(limit);
}

// How far one press, click or wheel tick moves a field: a whole `step`,
// or with Shift ten steps from the keyboard (like the native field), half
// a step from the arrow buttons and a tenth from the wheel — the pointer
// ways get finer, the keyboard way coarser.
export const SHIFT_SCALE = { key: 10, button: 0.5, wheel: 0.1 };
export function stepSize(step, how, shift) {
  return Number(step) * (shift ? SHIFT_SCALE[how] : 1);
}
