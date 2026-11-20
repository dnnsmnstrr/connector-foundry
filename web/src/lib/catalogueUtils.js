// Shared catalogue-list helpers — grouping and search — used by both
// Library mode's sidebar and the Bench's part pickers, so a part shows
// up under the same system heading and matches the same search terms
// everywhere in the app.
//
// `order` (optional) is the list of system names to sort the groups by —
// normally resolveSystemOrder()'s output. Without it the groups come out
// in catalogue order (first appearance of each system in `parts`).
export function groupBySystem(parts, order) {
  const groups = new Map();
  for (const part of parts) {
    if (!groups.has(part.system)) groups.set(part.system, []);
    groups.get(part.system).push(part);
  }
  if (!order) return groups;
  const sorted = new Map();
  for (const system of order) if (groups.has(system)) sorted.set(system, groups.get(system));
  // Anything `order` did not name (it should name everything — see
  // resolveSystemOrder) keeps its catalogue position at the end.
  for (const [system, systemParts] of groups) if (!sorted.has(system)) sorted.set(system, systemParts);
  return sorted;
}

// Every distinct `system` in `parts`, in first-appearance (catalogue) order.
export function catalogueSystems(parts) {
  const seen = new Set();
  for (const part of parts) seen.add(part.system);
  return [...seen];
}

// The order the part lists actually use: the user's saved order (from
// uiPrefs.js, string[] | null) with systems that no longer exist dropped
// and systems it does not know about — new ones, or renamed ones —
// appended in catalogue order. Always a full permutation of the
// catalogue's systems, so filtering a list never changes the order and
// the Settings dialog can show and move every heading.
export function resolveSystemOrder(parts, saved) {
  const systems = catalogueSystems(parts);
  if (!saved) return systems;
  const known = new Set(systems);
  const order = saved.filter((s) => known.has(s));
  const placed = new Set(order);
  for (const system of systems) if (!placed.has(system)) order.push(system);
  return order;
}

// The parts a picker lists: the catalogue minus entries it marks `hidden`
// itself (bitbeam/pin-joint, bitbeam/axle — parts the Bench's pin joint needs
// to exist but nobody picks by hand) and minus whatever the user has
// hidden in Settings (`hidden` is uiPrefs.js's { systems, parts }).
// Everything left out stays in `parts` for the code that looks parts up
// by id, so a bench using a hidden part still renders.
export function listedParts(parts, hidden) {
  const systems = new Set(hidden?.systems ?? []);
  const ids = new Set(hidden?.parts ?? []);
  return parts.filter((p) => !p.hidden && !systems.has(p.system) && !ids.has(p.id));
}

// A part picker's list (the Bench's and Holes' palette pages): the parts
// listedParts() keeps, under their systems in the order Settings saved —
// the same groups, in the same order, as PartBrowser's.
/**
 * @param {any[]} parts
 * @param {{ systems?: string[], parts?: string[] } | null} hidden
 * @param {string[] | null} savedOrder
 * @returns {Map<string, any[]>}
 */
export function partSections(parts, hidden, savedOrder) {
  const listed = listedParts(parts, hidden);
  return groupBySystem(listed, resolveSystemOrder(listed, savedOrder));
}

// A part id as a filename stem — gridfinity/base -> gridfinity_base, the
// same as cli/foundry.py's slug(), so a browser download and a CLI
// render of the same part get the same name.
export function slugify(partId) {
  return partId.replace(/\//g, "_");
}

export function matchesSearch(part, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    part.name.toLowerCase().includes(q) ||
    part.system.toLowerCase().includes(q) ||
    part.id.toLowerCase().includes(q) ||
    part.confidence.toLowerCase().includes(q) ||
    (part.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(q))
  );
}

/**
 * Whether a parameter edit is a finished one: every value that changed is
 * a tick (a boolean) or a choice from the part's list (`options`), not one
 * of a run of keystrokes. Such an edit renders at once instead of waiting
 * out the typing debounce (the Library's and the Bench's sidebars): that
 * wait was 400 of the 700 ms between a tick and a plate's new preview in
 * the Library, and is 250 ms of every Bench render. Nothing changed is not
 * an edit.
 * @param {{ options?: Record<string, any> } | null | undefined} part
 * @param {Record<string, any>} before
 * @param {Record<string, any>} next
 */
export function isFinishedEdit(part, before, next) {
  const changed = Object.keys({ ...before, ...next }).filter((key) => before[key] !== next[key]);
  return (
    changed.length > 0 &&
    changed.every((key) => typeof next[key] === "boolean" || part?.options?.[key] !== undefined)
  );
}
