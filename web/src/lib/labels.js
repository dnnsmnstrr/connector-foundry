// What the screen calls a parameter, its options and a Bench slot.
//
// A parameter and its options: a catalogue
// part can name its parameters (catalogue.yaml's `labels`: "gx" is
// "Width (cells)"); one it doesn't name, and every parameter of an
// imported part, is shown as its own name in words, with the one- and
// three-letter short forms the .scad sources use spelled out. Only the
// screen changes: the parameter's own name stays what the CLI, saved
// defaults, bench files and links use.

// Short forms in parameter names, word by word. "d" is left alone: in
// these sources it is a depth as often as a diameter, so a part that has
// one names it in `labels`.
const WORDS = {
  h: "height",
  w: "width",
  t: "thickness",
  r: "radius",
  len: "length",
  dia: "diameter",
  od: "outside diameter",
  id: "inside diameter",
  cols: "columns",
  x: "X",
  y: "Y",
  z: "Z",
};

/**
 * A parameter's name in words: `side_holes` is "Side holes", `base_h`
 * "Base height".
 * @param {string} key
 * @returns {string}
 */
export function humanizeParam(key) {
  const words = String(key)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => WORDS[word] ?? word);
  const text = words.join(" ");
  return text ? text[0].toUpperCase() + text.slice(1) : String(key);
}

/**
 * What the field for `key` is labelled: the part's own label, or the
 * name in words. `part` may be an imported part, which has no labels.
 * @param {{ labels?: Record<string, unknown> } | null | undefined} part
 * @param {string} key
 * @returns {string}
 */
export function paramLabel(part, key) {
  const label = part?.labels?.[key];
  return typeof label === "string" && label.trim() ? label : humanizeParam(key);
}

/**
 * An option as a dropdown shows it: a word starts with a capital ("thin"
 * is "Thin"), anything else ("1/4", "4mm", 2) is shown as it is.
 * @param {unknown} value
 * @returns {string}
 */
export function optionLabel(value) {
  const text = String(value);
  return /^[a-z]/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}

// The faces a part's named anchors sit on (catalogue.yaml's `anchors`
// and `side_slots`), as seen in the Bench: +Y is away from the viewer.
const FACES = {
  mount: "Top",
  bot: "Bottom",
  xpos: "Right side",
  xneg: "Left side",
  ypos: "Back side",
  yneg: "Front side",
};

/** 1 is "1", 0.5 "½", 1.5 "1½": grid indices are whole or half steps. */
function steps(n) {
  const whole = Math.floor(n);
  const half = n - whole === 0.5;
  return half ? `${whole || ""}½` : String(n);
}

/**
 * A slot as the Bench names it on screen. A grid slot is counted from the
 * middle of the grid (lib/slots.scad's "mount_<i>_<j>": "mount_1_-2" is
 * "1 right, 2 front of centre", "mount_0_0" "Centre"); a slot in a row along a side
 * is numbered from 1 ("xpos_0" is "Right side 1"); a face is named
 * ("bot" is "Bottom"). Anything else is shown as it is.
 * @param {string} name
 * @returns {string}
 */
export function slotLabel(name) {
  if (FACES[name]) return FACES[name];
  const grid = /^mount_(-?\d+(?:\.5)?)_(-?\d+(?:\.5)?)$/.exec(name);
  if (grid) {
    const [i, j] = [Number(grid[1]), Number(grid[2])];
    const parts = [];
    if (i) parts.push(`${steps(Math.abs(i))} ${i > 0 ? "right" : "left"}`);
    if (j) parts.push(`${steps(Math.abs(j))} ${j > 0 ? "back" : "front"}`);
    return parts.length ? `${parts.join(", ")} of centre` : "Centre";
  }
  const row = /^(xpos|xneg|ypos|yneg)_(\d+)$/.exec(name);
  if (row) return `${FACES[row[1]]} ${Number(row[2]) + 1}`;
  return name;
}
