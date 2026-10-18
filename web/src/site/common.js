// What every page of the website does: the landing page (landing.js) and
// the guides (docs.js).

/** The header gains its border once the page has scrolled under it. */
export function watchHeader() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/** @returns {MediaQueryList} */
export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

/**
 * Calls `start` once, the first time `element` comes within `margin` of the
 * viewport — so a demo far down the page costs nothing until it is near.
 * @param {Element} element
 * @param {() => void} start
 * @param {string} [margin]
 */
export function whenNear(element, start, margin = "300px") {
  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    },
    { rootMargin: margin },
  );
  observer.observe(element);
}

/**
 * Calls `callback` while `element` is on screen and stops when it leaves,
 * so a looping animation runs only where it can be seen.
 * @param {Element} element
 * @param {(visible: boolean) => void} callback
 */
export function onVisibility(element, callback) {
  if (!("IntersectionObserver" in window)) {
    callback(true);
    return;
  }
  new IntersectionObserver(([entry]) => callback(entry.isIntersecting), { threshold: 0.15 }).observe(element);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * An SVG element with attributes, for the demos' drawings.
 * @param {string} tag
 * @param {Record<string, string | number>} [attributes]
 * @param {Element} [parent]
 * @returns {SVGElement}
 */
export function svg(tag, attributes = {}, parent) {
  const element = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  parent?.append(element);
  return element;
}

/**
 * A polygon's points as an SVG path.
 * @param {number[][]} points [x, y] pairs
 */
export function pathOf(points) {
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
}
