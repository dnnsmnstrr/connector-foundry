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
    part.confidence.toLowerCase().includes(q)
  );
}
