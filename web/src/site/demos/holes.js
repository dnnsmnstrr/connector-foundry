// The Holes demo: a plate seen from above, with the snapping the Holes
// tab does (docs/HOLES.md) — the face's middle, the middle of each
// quarter, a point set in from each corner, and its centre and quarter
// lines — and a few of its presets, drawn as they look from above. The
// app's snapping works on any face of any mesh; this one plate keeps it
// to what a visitor can see at a glance.
import { svg } from "../common.js";

// The plate, in the drawing's units (about 3.3 to the millimetre: an
// 84 x 66 mm plate).
const PLATE = { x: 60, y: 40, w: 280, h: 220, r: 18 };
const CX = PLATE.x + PLATE.w / 2;
const CY = PLATE.y + PLATE.h / 2;
const QX = PLATE.w / 4;
const QY = PLATE.h / 4;
const INSET = 22;
const MM = 3.33;

const SNAP_POINTS = [
  { x: CX, y: CY, name: "center" },
  { x: CX - QX, y: CY - QY, name: "quarter" },
  { x: CX + QX, y: CY - QY, name: "quarter" },
  { x: CX - QX, y: CY + QY, name: "quarter" },
  { x: CX + QX, y: CY + QY, name: "quarter" },
  { x: PLATE.x + INSET, y: PLATE.y + INSET, name: "corner inset" },
  { x: PLATE.x + PLATE.w - INSET, y: PLATE.y + INSET, name: "corner inset" },
  { x: PLATE.x + INSET, y: PLATE.y + PLATE.h - INSET, name: "corner inset" },
  { x: PLATE.x + PLATE.w - INSET, y: PLATE.y + PLATE.h - INSET, name: "corner inset" },
];
const SNAP_RADIUS = 18;
const LINE_RADIUS = 9;
const MAX_HOLES = 14;

/**
 * What each preset cuts, seen from above, centred on (0, 0).
 * @type {Record<string, { name: string, draw: (g: SVGElement) => void }>}
 */
const PRESETS = {
  socket: {
    name: "M3 socket cap",
    draw(g) {
      svg("circle", { r: 3.25 * MM, class: "hole-pocket" }, g);
      svg("circle", { r: 1.7 * MM, class: "hole-through" }, g);
    },
  },
  countersunk: {
    name: "M3 countersunk",
    draw(g) {
      svg("circle", { r: 3.3 * MM, class: "hole-cone" }, g);
      svg("circle", { r: 1.7 * MM, class: "hole-through" }, g);
    },
  },
  insert: {
    name: "M3 heat-set insert",
    draw(g) {
      svg("circle", { r: 2.9 * MM, class: "hole-insert-ring" }, g);
      svg("circle", { r: 2 * MM, class: "hole-blind" }, g);
    },
  },
  nut: {
    name: "M3 nut trap",
    draw(g) {
      const r = 3.3 * MM;
      const points = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
      });
      svg("polygon", { points: points.join(" "), class: "hole-pocket" }, g);
      svg("circle", { r: 1.7 * MM, class: "hole-through" }, g);
    },
  },
  skadis: {
    name: "Skådis slot",
    draw(g) {
      svg(
        "rect",
        {
          x: -2.6 * MM,
          y: -7.6 * MM,
          width: 5.2 * MM,
          height: 15.2 * MM,
          rx: 2.6 * MM,
          class: "hole-through",
        },
        g,
      );
    },
  },
};

/**
 * The point a click at (x, y) drills: a snap point near it, else the
 * nearest centre or quarter line near it, else exactly there.
 */
function snap(x, y, exact) {
  if (exact) return { x, y, name: "exactly here" };
  let best = null;
  for (const point of SNAP_POINTS) {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d <= SNAP_RADIUS && (!best || d < best.d)) best = { ...point, d };
  }
  if (best) return best;
  if (Math.abs(x - CX) <= LINE_RADIUS) return { x: CX, y, name: "on the center line" };
  if (Math.abs(y - CY) <= LINE_RADIUS) return { x, y: CY, name: "on the center line" };
  return { x, y, name: null };
}

function onPlate(x, y) {
  return x >= PLATE.x + 8 && x <= PLATE.x + PLATE.w - 8 && y >= PLATE.y + 8 && y <= PLATE.y + PLATE.h - 8;
}

/**
 * @param {HTMLElement} root the demo's <figure>
 */
export function mountHoles(root) {
  const art = /** @type {SVGSVGElement} */ (root.querySelector("[data-holes-art]"));
  const count = /** @type {HTMLElement} */ (root.querySelector("[data-holes-count]"));
  const clear = /** @type {HTMLButtonElement} */ (root.querySelector("[data-holes-clear]"));
  const presetButtons = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("[data-preset]")]);
  let preset = "socket";
  /** @type {{ x: number, y: number, preset: string, g: SVGElement }[]} */
  const holes = [];
  let keyboardIndex = -1;

  art.setAttribute("tabindex", "0");
  art.setAttribute("role", "group");
  art.setAttribute(
    "aria-label",
    "Plate. Arrow keys choose a snap point, Enter drills a hole there, Backspace removes the last one.",
  );

  const defs = svg("defs", {}, art);
  const cone = svg("radialGradient", { id: "hole-cone" }, defs);
  svg("stop", { offset: "45%", "stop-color": "#11151b" }, cone);
  svg("stop", { offset: "100%", "stop-color": "#5d6c78" }, cone);
  const shadow = svg(
    "filter",
    { id: "plate-shadow", x: "-20%", y: "-20%", width: "140%", height: "150%" },
    defs,
  );
  svg(
    "feDropShadow",
    { dx: 0, dy: 10, stdDeviation: 12, "flood-color": "#000", "flood-opacity": 0.55 },
    shadow,
  );

  svg("rect", { ...rectOf(PLATE), class: "plate", filter: "url(#plate-shadow)" }, art);
  svg(
    "rect",
    {
      ...rectOf({ ...PLATE, x: PLATE.x + 1.5, y: PLATE.y + 1.5, w: PLATE.w - 3, h: PLATE.h - 3 }),
      class: "plate-bevel",
    },
    art,
  );
  const guides = svg("g", { class: "hole-guides" }, art);
  const holeLayer = svg("g", {}, art);
  const cursor = svg("g", { class: "hole-cursor" }, art);

  // The guides the app draws over a hovered face: centre and quarter
  // lines, a line from the middle to each corner, and the snap points.
  const line = (x1, y1, x2, y2, cls) => svg("line", { x1, y1, x2, y2, class: cls }, guides);
  line(CX, PLATE.y, CX, PLATE.y + PLATE.h, "guide-centre");
  line(PLATE.x, CY, PLATE.x + PLATE.w, CY, "guide-centre");
  for (const dx of [-QX, QX]) line(CX + dx, PLATE.y, CX + dx, PLATE.y + PLATE.h, "guide-quarter");
  for (const dy of [-QY, QY]) line(PLATE.x, CY + dy, PLATE.x + PLATE.w, CY + dy, "guide-quarter");
  for (const point of SNAP_POINTS.filter((p) => p.name === "corner inset"))
    line(CX, CY, point.x, point.y, "guide-quarter");
  for (const point of SNAP_POINTS) {
    svg(
      "circle",
      {
        cx: point.x,
        cy: point.y,
        r: point.name === "center" ? 3.5 : 2.5,
        class: `guide-point guide-${point.name.split(" ")[0]}`,
      },
      guides,
    );
  }

  svg("circle", { r: 9, class: "hole-cursor-ring" }, cursor);
  svg("path", { d: "M-14 0h8M6 0h8M0-14v8M0 6v8", class: "hole-cursor-cross" }, cursor);
  const cursorLabel = svg("text", { x: 14, y: -14, class: "hole-cursor-label" }, cursor);

  function rectOf(r) {
    return { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.r ?? 0 };
  }

  function point(event) {
    const box = art.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * 400,
      y: ((event.clientY - box.top) / box.height) * 300,
    };
  }

  function showCursor(at) {
    art.classList.toggle("is-aiming", Boolean(at));
    if (!at) return;
    cursor.setAttribute("transform", `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    cursor.classList.toggle("is-snapped", Boolean(at.name));
    cursorLabel.textContent = at.name ?? "";
    // Keep the label inside the frame near the right edge.
    const flip = at.x > 300;
    cursorLabel.setAttribute("x", flip ? "-14" : "14");
    cursorLabel.setAttribute("text-anchor", flip ? "end" : "start");
  }

  function updateCount() {
    const n = holes.length;
    count.textContent = n
      ? `${n} hole${n === 1 ? "" : "s"} · next: ${PRESETS[preset].name}. Click a hole to remove it.`
      : "Click the plate to drill a hole.";
    clear.hidden = n === 0;
  }

  function drill(at) {
    const existing = holes.findIndex((hole) => Math.hypot(hole.x - at.x, hole.y - at.y) < 12);
    if (existing >= 0) {
      holes[existing].g.remove();
      holes.splice(existing, 1);
      updateCount();
      return;
    }
    if (holes.length >= MAX_HOLES) holes.shift().g.remove();
    const g = svg(
      "g",
      { class: "hole", transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})` },
      holeLayer,
    );
    const inner = svg("g", { class: "hole-shape" }, g);
    PRESETS[preset].draw(inner);
    svg("circle", { r: 12, class: "hole-ripple" }, g);
    holes.push({ x: at.x, y: at.y, preset, g });
    updateCount();
  }

  art.addEventListener("pointermove", (event) => {
    const p = point(event);
    showCursor(onPlate(p.x, p.y) ? snap(p.x, p.y, event.shiftKey) : null);
  });
  art.addEventListener("pointerleave", () => showCursor(null));
  art.addEventListener("click", (event) => {
    const p = point(event);
    if (!onPlate(p.x, p.y)) return;
    drill(snap(p.x, p.y, event.shiftKey));
  });
  art.addEventListener("keydown", (event) => {
    if (
      event.key === "ArrowRight" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp"
    ) {
      event.preventDefault();
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      keyboardIndex = (keyboardIndex + delta + SNAP_POINTS.length) % SNAP_POINTS.length;
      showCursor(SNAP_POINTS[keyboardIndex]);
    } else if ((event.key === "Enter" || event.key === " ") && keyboardIndex >= 0) {
      event.preventDefault();
      drill(SNAP_POINTS[keyboardIndex]);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      holes.pop()?.g.remove();
      updateCount();
    }
  });
  art.addEventListener("focus", () => {
    if (keyboardIndex < 0) keyboardIndex = 0;
    showCursor(SNAP_POINTS[keyboardIndex]);
  });
  art.addEventListener("blur", () => showCursor(null));

  /** @type {HTMLElement} */ (root.querySelector(".hole-presets")).addEventListener("keydown", (event) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const keys = Object.keys(PRESETS);
    choose(keys[(keys.indexOf(preset) + delta + keys.length) % keys.length]);
    presetButtons.find((button) => button.dataset.preset === preset)?.focus();
  });
  for (const button of presetButtons) button.addEventListener("click", () => choose(button.dataset.preset));

  function choose(next) {
    preset = next;
    for (const button of presetButtons) {
      const selected = button.dataset.preset === next;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    updateCount();
  }

  clear.addEventListener("click", () => {
    for (const hole of holes.splice(0)) hole.g.remove();
    updateCount();
  });

  choose(preset);
  // Two holes to start with, so the plate shows what it is for.
  drill(SNAP_POINTS[5]);
  drill(SNAP_POINTS[8]);
}
