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
