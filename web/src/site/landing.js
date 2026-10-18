// The landing page (index.html): the hero's headline and 3D view, the
// scroll-in of each section, and the demos. Each demo starts only when
// it comes near the screen; the 3D view loads when the browser is idle.
import "./site.css";
import "./landing.css";
import siteData from "virtual:site-data";
import { isMacPlatform, paletteShortcut } from "../lib/isEditableTarget.js";
import { publicUrl } from "../lib/publicAsset.js";
import { reducedMotion, watchHeader, whenNear } from "./common.js";
import { mountGallery } from "./demos/gallery.js";
import { mountHoles } from "./demos/holes.js";
import { mountJoints } from "./demos/joints.js";
import { mountPalette } from "./demos/palette.js";
import { mountResize } from "./demos/resize.js";
import { mountTerminal } from "./demos/terminal.js";
import { HERO_PAIRS } from "./heroPairs.js";

/** @typedef {{ show(index: number): void, setStill(still: boolean): void }} Hero */

const motion = reducedMotion();
// The tour without WebGL: only the headline and the pictures change.
const FALLBACK_PAIR_MS = 4500;

/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));

document.documentElement.classList.add("js");
watchHeader();
reveal();
hero();
spotlight();
downloads();
modifierKeys();

whenNear($('[data-demo="resize"]'), () => mountResize($('[data-demo="resize"]')));
whenNear($('[data-demo="joints"]'), () => mountJoints($('[data-demo="joints"]'), { still: motion.matches }));
whenNear($('[data-demo="holes"]'), () => mountHoles($('[data-demo="holes"]')));
whenNear($('[data-demo="palette"]'), () =>
  mountPalette($('[data-demo="palette"]'), { still: motion.matches }),
);
whenNear($('[data-demo="terminal"]'), () =>
  mountTerminal($('[data-demo="terminal"]'), { still: motion.matches }),
);
mountGallery($("[data-gallery-filters]"), $("[data-gallery]"));

// Cmd/Ctrl+K, the app's palette key, goes to the palette demo here — the
// same chord the app reads (lib/isEditableTarget.js).
document.addEventListener("keydown", (event) => {
  if (!paletteShortcut(event)) return;
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ (document.querySelector("[data-palette-input]"));
  input.scrollIntoView({ block: "center", behavior: motion.matches ? "auto" : "smooth" });
  input.focus({ preventScroll: true });
});

// Sections fade up as they scroll in. Whatever is on screen at load is
// shown at once.
function reveal() {
  const items = document.querySelectorAll("[data-reveal]");
  if (!("IntersectionObserver" in window)) {
    for (const item of items) item.classList.add("is-visible");
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  for (const item of items) observer.observe(item);
}

// The headline's two words, the buttons under the 3D view and the view
// itself move through HERO_PAIRS together.
function hero() {
  const stage = $("[data-hero-stage]");
  const canvas = /** @type {HTMLCanvasElement} */ (stage.querySelector("canvas"));
  const pager = $("[data-hero-pager]");
  const reels = {
    base: $('[data-reel="base"]'),
    attached: $('[data-reel="attached"]'),
  };
  for (const [kind, reel] of Object.entries(reels)) {
    // Every word is in the reel from the start, so its width (the longest
    // word's) never changes; index.html has the first pair's.
    HERO_PAIRS.forEach((pair, i) => {
      if (i === 0) return;
      const word = document.createElement("span");
      word.className = "reel-word";
      word.textContent = kind === "base" ? pair.base.words : `${pair.attached.words}.`;
      reel.append(word);
    });
  }
  const buttons = HERO_PAIRS.map((pair, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = pair.label;
    button.setAttribute("aria-label", `${pair.base.words} with ${pair.attached.words}`);
    button.setAttribute("aria-pressed", String(i === 0));
    button.addEventListener("click", () => {
      if (view) view.show(i);
      else {
        show(i);
        restartFallback();
      }
    });
    pager.append(button);
    return button;
  });

  let current = 0;
  function show(index) {
    if (index !== current) {
      for (const reel of Object.values(reels)) {
        const words = [...reel.children];
        words[current].classList.remove("is-current");
        words[current].classList.add("is-leaving");
        const leaving = words[current];
        window.setTimeout(() => leaving.classList.remove("is-leaving"), 700);
        words[index].classList.remove("is-leaving");
        words[index].classList.add("is-current");
      }
    }
    current = index;
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    // The pictures shown before (or instead of) the 3D view.
    const pair = HERO_PAIRS[index];
    const images = stage.querySelectorAll(".hero-fallback img");
    [pair.base.part, pair.attached.part].forEach((id, i) => {
      const thumbnail = siteData.parts.find((part) => part.id === id)?.thumbnail;
      if (thumbnail && images[i]) /** @type {HTMLImageElement} */ (images[i]).src = publicUrl(thumbnail);
    });
  }

  /** @type {Hero | null} */
  let view = null;
  let fallbackTimer = 0;
  function restartFallback() {
    clearInterval(fallbackTimer);
    if (motion.matches) return;
    fallbackTimer = window.setInterval(() => show((current + 1) % HERO_PAIRS.length), FALLBACK_PAIR_MS);
  }

  async function load() {
    if (!webgl()) {
      restartFallback();
      return;
    }
    try {
      const { createHero } = await import("./hero.js");
      view = await createHero({
        canvas,
        stage,
        pairs: HERO_PAIRS,
        chips: {
          base: /** @type {HTMLElement} */ (stage.querySelector('[data-chip="base"]')),
          attached: /** @type {HTMLElement} */ (stage.querySelector('[data-chip="attached"]')),
        },
        still: motion.matches,
        onPair: show,
      });
      motion.addEventListener("change", () => view?.setStill(motion.matches));
    } catch (error) {
      console.warn("The 3D view could not start; showing pictures instead.", error);
      restartFallback();
    }
  }

  // After the first paint and once the browser has a moment: three.js and
  // the meshes are not what the page is waiting for.
  const idle = window.requestIdleCallback ?? ((callback) => window.setTimeout(callback, 600));
  idle(() => load(), { timeout: 2500 });
}

function webgl() {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

// A soft light follows the pointer over each demo (landing.css, .demo::after).
function spotlight() {
  for (const demo of document.querySelectorAll(".demo")) {
    demo.addEventListener("pointermove", (event) => {
      const box = demo.getBoundingClientRect();
      const e = /** @type {PointerEvent} */ (event);
      /** @type {HTMLElement} */ (demo).style.setProperty("--mx", `${e.clientX - box.left}px`);
      /** @type {HTMLElement} */ (demo).style.setProperty("--my", `${e.clientY - box.top}px`);
    });
  }
}

/**
 * The visitor's computer, as far as the browser says: "mac", "windows" or
 * "other" (Linux, a phone, a tablet — an iPad calls itself a Mac).
 */
function platform() {
  const name = /** @type {any} */ (navigator).userAgentData?.platform ?? navigator.platform ?? "";
  if (/^Mac/i.test(name)) return navigator.maxTouchPoints > 1 ? "other" : "mac";
  if (/^Win/i.test(name)) return "windows";
  return "other";
}

// The download for this computer: its card is marked, the hero's button
// names it, and where the browser tells (Chromium only) an Intel Mac or an
// ARM PC gets its own build first.
function downloads() {
  const os = platform();
  const card = document.querySelector(`.download-card[data-os="${os}"]`);
  if (!card) return;
  card.classList.add("is-detected");
  const badge = document.createElement("span");
  badge.className = "download-detected";
  badge.textContent = os === "other" ? "For this device" : "For this computer";
  card.prepend(badge);
  const cta = document.querySelector("[data-download-cta]");
  if (cta && os === "mac") cta.textContent = "Download for macOS";
  if (cta && os === "windows") cta.textContent = "Download for Windows";

  const hints = /** @type {any} */ (navigator).userAgentData;
  hints
    ?.getHighEntropyValues?.(["architecture"])
    .then(({ architecture }) => {
      const swap = (os === "mac" && architecture === "x86") || (os === "windows" && architecture === "arm");
      if (!swap) return;
      const [first, second] = card.querySelectorAll(".download-buttons .button");
      first.classList.replace("button-primary", "button-secondary");
      second.classList.replace("button-secondary", "button-primary");
      second.parentElement.prepend(second);
    })
    .catch(() => {});
}

// "⌘" on a Mac, "Ctrl" elsewhere, wherever the page names the palette key.
function modifierKeys() {
  if (isMacPlatform()) return;
  for (const key of document.querySelectorAll("[data-mod-key]")) key.textContent = "Ctrl";
}
