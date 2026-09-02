// The generated files sync-scad.mjs drops into web/public/ (the .scad
// bundle, catalogue.yaml, global-defaults.json), fetched relative to
// Vite's base URL so the GitHub Pages deployment (served under
// /connector-foundry/) finds them too. Usable from the worker as well as
// the main thread.
export function publicUrl(name) {
  return `${import.meta.env.BASE_URL}${name}`;
}

// fetch() only rejects on a network failure. A 404 (say, `npm run
// sync-scad` never ran) resolves fine with an HTML error page, which
// yaml.load()/res.json() would then choke on with a message that points
// nowhere near the cause — so check the status here and name the file.
export async function fetchPublic(name) {
  const res = await fetch(publicUrl(name));
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}) — has \`npm run sync-scad\` run?`);
  return res;
}
