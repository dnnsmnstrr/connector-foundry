// The Library demo: a Gridfinity bin with the app's resize handles, drawn
// in isometric SVG. What the handles do is the app's own code — the
// catalogue's resize entry for gridfinity/bin (via virtual:site-data),
// lib/resize.js's axes, handles, drag and step maths and its drag label —
// so the demo snaps, clamps and labels exactly as the Library does. Only
// the "render" is pretend: the bin's outside size comes from the formula
// below instead of OpenSCAD.
import siteData from "virtual:site-data";
import {
  boxEdges,
  dragResize,
  formatMm,
  handlesForBox,
  resizeAxes,
  resizeText,
  stepResize,
} from "../../lib/resize.js";
import { pathOf, svg } from "../common.js";

/** @typedef {import("../../lib/resize.js").Box} Box */
/** @typedef {import("../../lib/resize.js").ResizeHandle} ResizeHandle */

const VIEW = { width: 520, height: 330 };
// px of the drawing per mm, and where the middle of the bin's underside
// sits: the largest bin the demo allows (gx 4, gy 3, gz 6) just fills the
// frame.
const SCALE = 1.65;
const ORIGIN = [VIEW.width / 2, 200];
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
// Kept smaller than the catalogue's own bounds (8 x 8 x 20), which would
// not fit the frame.
const DEMO_MAX = { gx: 4, gy: 3, gz: 6 };
// The handles the demo shows: one per axis, as the app's keyboard stops
// are (a corner drives two parameters, which a stepper can't show).
const HANDLES = new Set(["x+", "y+", "z+"]);
const AXIS_NAMES = { x: "Width", y: "Depth", z: "Height" };
const RENDER_MS = 380;
const GROW_MS = 420;

// The bin as foundry renders it: 42 mm a grid unit less 0.5 mm of
// clearance across, 7 mm a height unit plus 3.55 mm of base and lip up
// (measured from renders of gridfinity/bin, gx 1 to 3 and gz 2 to 6).
// The handles never need this — like the app, they work from the box.
/** @returns {Box} */
function renderedBox(params) {
  const w = 42 * params.gx - 0.5;
  const d = 42 * params.gy - 0.5;
  const h = 7 * params.gz + 3.55;
  return { min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, h] };
}

/** A model point (mm, Z up) on the drawing. */
function iso(x, y, z) {
  return [ORIGIN[0] + (x - y) * COS * SCALE, ORIGIN[1] + (x + y) * SIN * SCALE - z * SCALE];
}

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;

function lerpBox(from, to, t) {
  return {
    min: from.min.map((v, i) => lerp(v, to.min[i], t)),
    max: from.max.map((v, i) => lerp(v, to.max[i], t)),
  };
}

// One axis-aligned block's visible faces: its top, its +Y side (on the
// left of the drawing) and its +X side (on the right).
function block(group, [x0, y0, z0], [x1, y1, z1], classes) {
  svg(
    "path",
    { d: pathOf([iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)]), class: classes.left },
    group,
  );
  svg(
    "path",
    { d: pathOf([iso(x1, y0, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x1, y0, z1)]), class: classes.right },
    group,
  );
  svg(
    "path",
    { d: pathOf([iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)]), class: classes.top },
    group,
  );
}

/**
 * @param {HTMLElement} root the demo's <figure>
 */
export function mountResize(root) {
  const art = /** @type {SVGSVGElement} */ (root.querySelector("[data-resize-art]"));
  const stage = /** @type {HTMLElement} */ (root.querySelector(".resize-stage"));
  const label = /** @type {HTMLElement} */ (root.querySelector("[data-resize-label]"));
  const status = /** @type {HTMLElement} */ (root.querySelector("[data-resize-status]"));
  const dimensions = /** @type {HTMLElement} */ (root.querySelector("[data-resize-dimensions]"));
  /** @type {Record<string, HTMLElement>} */
  const handleButtons = {
    x: /** @type {HTMLElement} */ (root.querySelector('[data-axis="x"]')),
    y: /** @type {HTMLElement} */ (root.querySelector('[data-axis="y"]')),
    z: /** @type {HTMLElement} */ (root.querySelector('[data-axis="z"]')),
  };

  const part = siteData.resizePart;
  let params = { ...part.defaults, gx: 2 };
  const axes = resizeAxes(part, params).map((axis) => ({
    ...axis,
    max: Math.min(axis.max, DEMO_MAX[axis.param] ?? axis.max),
  }));

  let box = renderedBox(params); // what is drawn as the solid
  /** @type {Box | null} */
  let ghost = null;
  let busy = false;

  const defs = svg("defs", {}, art);
  const blur = svg(
    "filter",
    { id: "resize-shadow", x: "-20%", y: "-20%", width: "140%", height: "140%" },
    defs,
  );
  svg("feGaussianBlur", { stdDeviation: 7 }, blur);
  const floor = svg("g", { class: "resize-floor" }, art);
  const shadow = svg("path", { class: "resize-shadow", filter: "url(#resize-shadow)" }, art);
  const solid = svg("g", { class: "resize-solid" }, art);
  const ghostLines = svg("g", { class: "resize-ghost" }, art);

  // The floor: lines every half grid unit. The bin grows about its
  // centre, as in the app, so the edges between its feet fall on
  // multiples of 42 mm for an even count and between them for an odd one;
  // a 21 mm grid has a line under every edge either way.
  const floorLine = (from, to) => {
    const [x1, y1] = iso(...from);
    const [x2, y2] = iso(...to);
    svg("line", { x1, y1, x2, y2 }, floor);
  };
  for (let i = -7; i <= 7; i++) floorLine([i * 21, -105, 0], [i * 21, 105, 0]);
  for (let j = -5; j <= 5; j++) floorLine([-147, j * 21, 0], [147, j * 21, 0]);

  function drawSolid() {
    solid.replaceChildren();
    const [x0, y0] = box.min;
    const [x1, y1, h] = box.max;
    const footH = 4.75;
    // The feet follow the units the bin is growing to, each one stretching
    // with it, rather than popping in halfway through the animation.
    const unitX = (x1 - x0) / params.gx;
    const unitY = (y1 - y0) / params.gy;
    shadow.setAttribute(
      "d",
      pathOf([
        iso(x0 - 2, y0 - 2, 0),
        iso(x1 + 6, y0 - 2, 0),
        iso(x1 + 6, y1 + 6, 0),
        iso(x0 - 2, y1 + 6, 0),
      ]),
    );
    // Feet, one per grid unit, each with the stepped profile a Gridfinity
    // base has, drawn back to front: a foot further along X or Y is nearer.
    const feet = [];
    for (let i = 0; i < params.gx; i++) for (let j = 0; j < params.gy; j++) feet.push([i, j]);
    feet.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    const footFaces = { left: "bin-foot-left", right: "bin-foot-right", top: "bin-foot-top" };
    for (const [i, j] of feet) {
      const fx0 = x0 + i * unitX;
      const fy0 = y0 + j * unitY;
      block(solid, [fx0 + 3.2, fy0 + 3.2, 0], [fx0 + unitX - 3.2, fy0 + unitY - 3.2, 2.2], footFaces);
      block(solid, [fx0 + 1.4, fy0 + 1.4, 2.2], [fx0 + unitX - 1.4, fy0 + unitY - 1.4, footH], footFaces);
    }
    block(solid, [x0, y0, footH], [x1, y1, h], { left: "bin-left", right: "bin-right", top: "bin-top" });
    // The opening, and the two inner walls a view from this side sees.
    const wall = 2.6;
    const floorZ = footH + 1.6;
    const ix0 = x0 + wall;
    const ix1 = x1 - wall;
    const iy0 = y0 + wall;
    const iy1 = y1 - wall;
    const opening = [iso(ix0, iy0, h), iso(ix1, iy0, h), iso(ix1, iy1, h), iso(ix0, iy1, h)];
    const clipId = "resize-opening";
    const clip = svg("clipPath", { id: clipId }, solid);
    svg("path", { d: pathOf(opening) }, clip);
    const inside = svg("g", { "clip-path": `url(#${clipId})` }, solid);
    svg("path", { d: pathOf(opening), class: "bin-cavity" }, inside);
    svg(
      "path",
      {
        d: pathOf([iso(ix0, iy0, h), iso(ix0, iy1, h), iso(ix0, iy1, floorZ), iso(ix0, iy0, floorZ)]),
        class: "bin-inner-x",
      },
      inside,
    );
    svg(
      "path",
      {
        d: pathOf([iso(ix0, iy0, h), iso(ix1, iy0, h), iso(ix1, iy0, floorZ), iso(ix0, iy0, floorZ)]),
        class: "bin-inner-y",
      },
      inside,
    );
    svg("path", { d: pathOf(opening), class: "bin-rim" }, solid);
  }

  function drawGhost() {
    ghostLines.replaceChildren();
    if (!ghost) return;
    for (const [a, b] of boxEdges(ghost)) {
      const [x1, y1] = iso(a[0], a[1], a[2]);
      const [x2, y2] = iso(b[0], b[1], b[2]);
      svg("line", { x1, y1, x2, y2 }, ghostLines);
    }
  }

  /** The handles where the app puts them, on the box being shown. */
  function currentHandles(onBox = ghost ?? box) {
    return handlesForBox(onBox, axes).filter((handle) => HANDLES.has(handle.id));
  }

  function placeHandles() {
    for (const handle of currentHandles()) {
      const button = handleButtons[handle.axes[0]];
      const [x, y] = iso(...handle.point);
      button.style.left = `${(x / VIEW.width) * 100}%`;
      button.style.top = `${(y / VIEW.height) * 100}%`;
      const axis = axes.find((a) => a.axis === handle.axes[0]);
      const value = params[axis.param];
      button.setAttribute("aria-valuenow", String(value));
      button.setAttribute("aria-valuemin", String(axis.min));
      button.setAttribute("aria-valuemax", String(axis.max));
      const index = { x: 0, y: 1, z: 2 }[handle.axes[0]];
      button.setAttribute(
        "aria-valuetext",
        `${axis.param} ${value}, ${formatMm(box.max[index] - box.min[index])} mm`,
      );
    }
  }

  function showLabel(text, handle) {
    label.hidden = !text;
    if (!text) return;
    label.textContent = text;
    const [x, y] = iso(...handle.point);
    label.style.left = `${(x / VIEW.width) * 100}%`;
    label.style.top = `${(y / VIEW.height) * 100}%`;
  }

  function updateReadouts() {
    const size = [box.max[0] - box.min[0], box.max[2] - box.min[2], box.max[1] - box.min[1]].map(formatMm);
    dimensions.textContent = `Outside: W ${size[0]} × H ${size[1]} × D ${size[2]} mm`;
    for (const output of root.querySelectorAll("output[data-param]")) {
      output.textContent = String(params[output.getAttribute("data-param")]);
    }
    for (const button of root.querySelectorAll("button[data-step]")) {
      const [key, delta] = button.getAttribute("data-step").split(":");
      const axis = axes.find((a) => a.axis === key);
      const value = params[axis.param];
      /** @type {HTMLButtonElement} */ (button).disabled =
        busy || (Number(delta) > 0 ? value >= axis.max : value <= axis.min);
    }
  }

  function draw() {
    drawSolid();
    drawGhost();
    placeHandles();
    updateReadouts();
  }

  // The part renders once a change is let go of, as in the app: the ghost
  // stays where the new size will be while it "renders", then the solid
  // grows into it.
  function commit(changes) {
    if (!changes || !Object.keys(changes).length) {
      ghost = null;
      draw();
      return;
    }
    params = { ...params, ...changes };
    const from = box;
    const to = renderedBox(params);
    ghost = to;
    busy = true;
    status.textContent = "Rendering…";
    status.classList.add("is-rendering");
    draw();
    setTimeout(() => {
      const started = performance.now();
      const grow = (now) => {
        const t = Math.min(1, (now - started) / GROW_MS);
        box = lerpBox(from, to, easeOut(t));
        if (t < 1) {
          drawSolid();
          placeHandles();
          requestAnimationFrame(grow);
          return;
        }
        box = to;
        ghost = null;
        busy = false;
        status.classList.remove("is-rendering");
        status.textContent = "Rendered";
        draw();
      };
      requestAnimationFrame(grow);
    }, RENDER_MS);
  }

  function step(key, steps) {
    if (busy) return;
    const handle = currentHandles().find((h) => h.axes[0] === key);
    const result = stepResize({ handle, axes, box, startParams: params, steps });
    if (result) commit(result.params);
  }

  // Dragging a handle: the pointer's travel across the drawing, turned
  // back into millimetres along the handle's axis, is the constrained
  // point lib/resize.js's dragResize() takes.
  for (const [key, button] of Object.entries(handleButtons)) {
    button.hidden = false;
    button.setAttribute("role", "slider");
    button.setAttribute("aria-label", AXIS_NAMES[key]);
    /** @type {{ id: number, x: number, y: number, handle: ResizeHandle, result: any } | null} */
    let drag = null;
    button.addEventListener("pointerdown", (event) => {
      if (busy) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-dragging");
      const handle = currentHandles(box).find((h) => h.axes[0] === key);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, handle, result: null };
    });
    button.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const perPixel = VIEW.width / stage.clientWidth;
      const dx = (event.clientX - drag.x) * perPixel;
      const dy = (event.clientY - drag.y) * perPixel;
      // +X runs down to the right on the drawing, +Y down to the left, +Z up.
      const travel = {
        x: (dx * COS + dy * SIN) / SCALE,
        y: (-dx * COS + dy * SIN) / SCALE,
        z: -dy / SCALE,
      }[key];
      const point = [...drag.handle.point];
      point[{ x: 0, y: 1, z: 2 }[key]] += travel;
      drag.result = dragResize({ handle: drag.handle, axes, box, startParams: params, point });
      if (!drag.result) return;
      ghost = drag.result.box;
      drawGhost();
      // The handles jump with the ghost, a unit at a time.
      placeHandles();
      const moved = currentHandles().find((h) => h.id === drag.handle.id) ?? drag.handle;
      showLabel(resizeText(drag.handle, axes, box, drag.result), moved);
    });
    const end = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      button.classList.remove("is-dragging");
      showLabel("", drag.handle);
      const result = drag.result;
      drag = null;
      commit(result?.params);
    };
    button.addEventListener("pointerup", end);
    button.addEventListener("pointercancel", end);
    button.addEventListener("keydown", (event) => {
      const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
      if (!steps) return;
      event.preventDefault();
      step(key, steps);
    });
  }

  for (const button of root.querySelectorAll("button[data-step]")) {
    button.addEventListener("click", () => {
      const [key, delta] = button.getAttribute("data-step").split(":");
      step(key, Number(delta));
    });
  }

  draw();
}
