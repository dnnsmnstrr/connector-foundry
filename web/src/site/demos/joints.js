// The Bench demo: the five joints lib/joints.scad mates two parts with
// (docs/JOINTS.md), as cut-away side views that assemble when picked.
// Schematic — the proportions are chosen to read at this size, not
// measured off the flanges.
import { onVisibility, svg } from "../common.js";

const JOINTS = {
  fused: {
    bodies: "1 body",
    text: "Plain attach: the two parts become one solid, and print in one go.",
  },
  bolted: {
    bodies: "2 bodies + 4 M3 bolts",
    text: "A flange on each side with a shared four-hole pattern: heat-set insert bores in one, clearance holes in the other. Print the halves apart and bolt them together.",
  },
  snap: {
    bodies: "2 bodies",
    text: "Barbed pegs on one side, matching holes on the other. Print both and press them together until the barbs click home.",
  },
  pin: {
    bodies: "3 bodies: 2 parts and a pin",
    text: "A flange bored 4.8 mm on each side, and a real BitBeam pin, printed as a third body, that holds the two together.",
  },
  screwed: {
    bodies: "2 bodies + 3 screws",
    text: "For a part that already has DeckMate's three-hole pattern: one flange with heat-set inserts on the other side, so the rail prints the way it prints best and screws on.",
  },
};

const ORDER = Object.keys(JOINTS);
const CYCLE_MS = 4200;

// Shared geometry, in the drawing's units: the base part on the floor, the
// flanges between, the attached part on top.
const FLOOR = 262;
const BASE = { x: 56, w: 328, top: 200 };
const FLANGE = { x: 106, w: 228, h: 16 };
const PART = { x: 146, w: 148, h: 62 };
const HOLES = [130, 310];
// Where the callouts' text starts, right of the drawing.
const TAG_X = 404;

function rect(parent, x, y, w, h, cls, extra = {}) {
  return svg("rect", { x, y, width: w, height: h, class: cls, ...extra }, parent);
}

function tag(parent, text, x, y, toX, toY, anchor = "start") {
  const g = svg("g", { class: "j-tag" }, parent);
  svg("path", { d: `M${x} ${y}L${toX} ${toY}` }, g);
  svg("circle", { cx: toX, cy: toY, r: 2.5 }, g);
  const label = svg("text", { x: anchor === "end" ? x - 6 : x + 6, y: y + 4, "text-anchor": anchor }, g);
  label.textContent = text;
  return g;
}

// A group that slides in from `from` px above when the drawing joins.
function mover(parent, from, delay) {
  return svg("g", { class: "j-move", style: `--from: ${from}px; --delay: ${delay}s` }, parent);
}

function basePart(parent) {
  rect(parent, BASE.x, BASE.top, BASE.w, FLOOR - BASE.top, "j-base", { rx: 6 });
  const label = svg("text", { x: BASE.x + 14, y: FLOOR - 16, class: "j-part-label" }, parent);
  label.textContent = "base part";
}

function attachedPart(parent, bottom) {
  rect(parent, PART.x, bottom - PART.h, PART.w, PART.h, "j-attached", { rx: 6 });
  const label = svg(
    "text",
    { x: PART.x + 14, y: bottom - PART.h + 24, class: "j-part-label j-part-label-dark" },
    parent,
  );
  label.textContent = "attached part";
}

const DRAW = {
  fused(art) {
    basePart(art);
    const top = mover(art, -70, 0);
    attachedPart(top, BASE.top);
    // The seam that disappears: one solid once fused.
    svg("path", { d: `M${PART.x} ${BASE.top}H${PART.x + PART.w}`, class: "j-seam" }, art);
    svg(
      "path",
      {
        d: `M${BASE.x + 6} ${FLOOR}a6 6 0 0 1-6-6V${BASE.top + 6}a6 6 0 0 1 6-6H${PART.x}V${BASE.top - PART.h + 6}a6 6 0 0 1 6-6H${PART.x + PART.w - 6}a6 6 0 0 1 6 6V${BASE.top}H${BASE.x + BASE.w - 6}a6 6 0 0 1 6 6V${FLOOR - 6}a6 6 0 0 1-6 6Z`,
        class: "j-outline",
      },
      art,
    );
  },

  bolted(art) {
    basePart(art);
    const flangeA = BASE.top - FLANGE.h;
    rect(art, FLANGE.x, flangeA, FLANGE.w, FLANGE.h, "j-flange-base", { rx: 3 });
    for (const x of HOLES) {
      rect(art, x - 5, flangeA, 10, FLANGE.h, "j-insert");
      for (let y = flangeA + 2; y < BASE.top - 1; y += 4)
        svg("path", { d: `M${x - 5} ${y}h10`, class: "j-knurl" }, art);
    }
    const top = mover(art, -64, 0);
    const flangeB = flangeA - FLANGE.h;
    rect(top, FLANGE.x, flangeB, FLANGE.w, FLANGE.h, "j-flange-attached", { rx: 3 });
    for (const x of HOLES) rect(top, x - 4, flangeB, 8, FLANGE.h, "j-hole");
    attachedPart(top, flangeB);
    for (const [i, x] of HOLES.entries()) {
      const bolt = mover(art, -120, 0.55 + i * 0.12);
      rect(bolt, x - 2.6, flangeB - 2, 5.2, FLANGE.h * 2, "j-bolt");
      rect(bolt, x - 8, flangeB - 10, 16, 9, "j-bolt-head", { rx: 2 });
    }
    tag(art, "heat-set insert", TAG_X, 214, HOLES[1] + 5, flangeA + 8);
    tag(art, "M3 bolt", TAG_X, 150, HOLES[1] + 8, flangeB - 6);
  },

  snap(art) {
    basePart(art);
    const flangeA = BASE.top - FLANGE.h;
    rect(art, FLANGE.x, flangeA, FLANGE.w, FLANGE.h, "j-flange-base", { rx: 3 });
    const flangeB = flangeA - FLANGE.h;
    for (const x of HOLES) {
      // A peg with a barb at its tip, standing up out of the base's flange.
      svg(
        "path",
        {
          d: `M${x - 4} ${flangeA}V${flangeB + 6}l-2.5-1V${flangeB}h13v4.9l-2.5 1V${flangeA}Z`,
          class: "j-flange-base j-peg",
        },
        art,
      );
    }
    const top = mover(art, -64, 0);
    rect(top, FLANGE.x, flangeB, FLANGE.w, FLANGE.h, "j-flange-attached", { rx: 3 });
    for (const x of HOLES) rect(top, x - 5, flangeB, 10, FLANGE.h, "j-hole");
    attachedPart(top, flangeB);
    for (const x of HOLES)
      svg("circle", { cx: x, cy: flangeB + 2, r: 13, class: "j-click", style: "--delay: 0.85s" }, art);
    tag(art, "barbed peg", TAG_X, 160, HOLES[1] + 6, flangeB + 3);
  },

  pin(art) {
    basePart(art);
    const flangeA = BASE.top - FLANGE.h;
    rect(art, FLANGE.x, flangeA, FLANGE.w, FLANGE.h, "j-flange-base", { rx: 3 });
    for (const x of HOLES) rect(art, x - 4.5, flangeA, 9, FLANGE.h, "j-hole");
    const flangeB = flangeA - FLANGE.h;
    for (const [i, x] of HOLES.entries()) {
      // The pin goes into the base's flange first, standing half out.
      const pin = mover(art, -90, i * 0.12);
      rect(pin, x - 3.6, flangeB + 2, 7.2, FLANGE.h * 2 - 4, "j-pin", { rx: 3 });
      rect(pin, x - 5.4, flangeA - 2, 10.8, 4, "j-pin", { rx: 1.5 });
    }
    const top = mover(art, -70, 0.55);
    rect(top, FLANGE.x, flangeB, FLANGE.w, FLANGE.h, "j-flange-attached", { rx: 3 });
    for (const x of HOLES) rect(top, x - 4.5, flangeB, 9, FLANGE.h, "j-hole j-hole-pin");
    attachedPart(top, flangeB);
    tag(art, "BitBeam pin", TAG_X, 168, HOLES[1] + 4, flangeA - 4);
  },

  screwed(art) {
    basePart(art);
    const flangeA = BASE.top - FLANGE.h;
    rect(art, FLANGE.x, flangeA, FLANGE.w, FLANGE.h, "j-flange-base", { rx: 3 });
    const screws = [PART.x + 24, PART.x + PART.w - 24];
    for (const x of screws) {
      rect(art, x - 5, flangeA, 10, FLANGE.h, "j-insert");
      for (let y = flangeA + 2; y < BASE.top - 1; y += 4)
        svg("path", { d: `M${x - 5} ${y}h10`, class: "j-knurl" }, art);
    }
    // The DeckMate part carries its own holes; only the base gets a flange.
    const top = mover(art, -64, 0);
    attachedPart(top, flangeA);
    for (const x of screws) {
      rect(top, x - 4, flangeA - PART.h, 8, PART.h, "j-hole");
      rect(top, x - 7, flangeA - PART.h, 14, 8, "j-hole");
    }
    for (const [i, x] of screws.entries()) {
      const screw = mover(art, -110, 0.55 + i * 0.12);
      rect(screw, x - 2.4, flangeA - PART.h + 6, 4.8, PART.h + 8, "j-bolt");
      rect(screw, x - 6.5, flangeA - PART.h + 1, 13, 6, "j-bolt-head", { rx: 2 });
    }
    tag(art, "DeckMate holes", TAG_X, 134, screws[1] + 7, flangeA - PART.h + 6);
    tag(art, "heat-set insert", TAG_X, 214, screws[1] + 5, flangeA + 8);
  },
};

/**
 * @param {HTMLElement} root the demo's <figure>
 * @param {{ still: boolean }} options still: no automatic tour
 */
export function mountJoints(root, { still }) {
  const art = /** @type {SVGSVGElement} */ (root.querySelector("[data-joint-art]"));
  const bodies = /** @type {HTMLElement} */ (root.querySelector("[data-joint-bodies]"));
  const text = /** @type {HTMLElement} */ (root.querySelector("[data-joint-text]"));
  const tabs = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("[data-joint]")]);
  let current = "fused";
  let touched = still;
  let timer = 0;

  function show(joint) {
    current = joint;
    for (const tab of tabs) {
      const selected = tab.dataset.joint === joint;
      tab.setAttribute("aria-checked", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    art.replaceChildren();
    svg("line", { x1: 24, y1: FLOOR, x2: 496, y2: FLOOR, class: "j-floor" }, art);
    DRAW[joint](art);
    bodies.textContent = JOINTS[joint].bodies;
    text.textContent = JOINTS[joint].text;
    art.classList.remove("is-joined");
    // Two frames: the parts are laid out apart first, then let go, so the
    // transitions run (one frame can be coalesced with the insert).
    requestAnimationFrame(() => requestAnimationFrame(() => art.classList.add("is-joined")));
  }

  function schedule(visible) {
    clearTimeout(timer);
    if (!visible || touched) return;
    timer = window.setTimeout(() => {
      show(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
      schedule(true);
    }, CYCLE_MS);
  }

  // A radio group: arrows move the choice, as in any other.
  /** @type {HTMLElement} */ (root.querySelector(".joint-tabs")).addEventListener("keydown", (event) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = ORDER[(ORDER.indexOf(current) + delta + ORDER.length) % ORDER.length];
    touched = true;
    clearTimeout(timer);
    show(next);
    tabs.find((tab) => tab.dataset.joint === next)?.focus();
  });
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      touched = true;
      clearTimeout(timer);
      show(tab.dataset.joint);
    });
  }

  show(current);
  onVisibility(root, schedule);
}
