// Shared catalogue-list helpers — grouping and search — used by both
// Library mode's sidebar and the Bench's part pickers, so a part shows
// up under the same system heading and matches the same search terms
// everywhere in the app.
export function groupBySystem(parts) {
  const groups = new Map();
  for (const part of parts) {
    if (!groups.has(part.system)) groups.set(part.system, []);
    groups.get(part.system).push(part);
  }
  return groups;
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
