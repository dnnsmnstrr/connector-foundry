// The generated files sync-scad.mjs drops into web/public/ (the .scad
// bundle, catalogue.json, global-defaults.json, the thumbnails), fetched
// relative to Vite's base URL so the GitHub Pages deployment (served
// under /connector-foundry/) finds them too. Usable from the worker as
// well as the main thread.
//
// The .scad bundle's URL carries a hash of its content (`?v=…`, which
// scripts/vite-plugin-sw.mjs works out for a build): these files are not
// content-hashed like the chunks are, and the service worker keeps a
// versioned URL until it changes — never a stale bundle under new app
// code, and never re-downloaded after a deploy that left the sources
// alone. The other files keep their plain URLs (the dev server, Node and
// the tests see no versions at all). The desktop app's foundry:// handler
// serves by path and ignores the query.
const VERSIONS = typeof __PUBLIC_VERSIONS__ === "object" && __PUBLIC_VERSIONS__ ? __PUBLIC_VERSIONS__ : {};

export function publicUrl(name) {
  const version = Object.hasOwn(VERSIONS, name) ? VERSIONS[name] : null;
  return `${import.meta.env.BASE_URL}${name}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

// fetch() only rejects on a network failure. A 404 (say, `npm run
// sync-scad` never ran) resolves fine with an HTML error page, which
// res.json() would then choke on with a message that points
// nowhere near the cause — so check the status here and name the file.
export async function fetchPublic(name) {
  const res = await fetch(publicUrl(name));
  if (!res.ok)
    throw new Error(`Could not load ${name} (HTTP ${res.status}) — has \`npm run sync-scad\` run?`);
  return res;
}
