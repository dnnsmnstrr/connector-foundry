// The website around the app: the landing page (index.html), the app
// itself (app/index.html) and the guides (docs/**, rendered from the
// repository's docs/*.md by build-docs.mjs). This plugin
//
// - renders the guides whenever Vite starts, and under `npm run dev`
//   again when one changes, and hands every page to the build as an
//   input — a multi-page build, so a typo'd path is a 404 rather than
//   the landing page;
// - puts the shared header and footer (src/site/partials/) into every
//   page that asks for them with <!-- site:header --> / <!-- site:footer -->;
// - fills the landing page's catalogue placeholders — the parts gallery,
//   the system list, the counts, the version — from public/catalogue.json
//   (sync-scad.mjs writes it before dev and build), so the page lists
//   exactly the parts the app has;
// - fills {{base}} (Vite's base: "/" locally, "/connector-foundry/" on
//   GitHub Pages) and {{repo}} in links, which Vite does not rewrite the
//   way it rewrites asset URLs;
// - serves `virtual:site-data` (types in src/site/site-data.d.ts): the
//   catalogue facts the landing page's scripts need — every listed part
//   with its picture and Bench link, and the Gridfinity bin the resize
//   demo drives through the app's own lib/resize.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAssembly } from "../src/lib/assembly.js";
import { encodeTree } from "../src/lib/benchUrlState.js";
import { REPO_URL } from "../src/lib/commandCatalog.js";
import { DOCS_SOURCE, buildDocs, escapeHtml, githubSlug } from "./build-docs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, "..");
const PARTIALS = path.join(WEB, "src", "site", "partials");
const CATALOGUE = path.join(WEB, "public", "catalogue.json");
const SITE_DATA = "virtual:site-data";
const SITE_DATA_ID = `\0${SITE_DATA}`;
// The part the Library demo resizes.
const DEMO_PART = "gridfinity/bin";

function readPartial(name) {
  // The partial's own leading comment is for whoever edits it, not the page.
  return fs.readFileSync(path.join(PARTIALS, `${name}.html`), "utf8").replace(/^\s*<!--[\s\S]*?-->\s*/, "");
}

function readCatalogue() {
  if (!fs.existsSync(CATALOGUE)) throw new Error(`${CATALOGUE} is missing: run \`npm run sync-scad\` first`);
  return JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
}

/**
 * The link that opens a part on the Bench, as the app's own URL state
 * writes it (lib/benchUrlState.js), relative to the site's base.
 * @param {string} partId
 */
export function benchLink(partId) {
  return `app/#mode=bench&bench=${encodeTree(createAssembly(partId, {}))}`;
}

/**
 * What the landing page shows of the catalogue: the parts the app lists
 * (not the `hidden` ones), grouped by system in catalogue order.
 * @param {{ parts: any[] }} catalogue
 */
export function landingData(catalogue) {
  const parts = catalogue.parts.filter((part) => !part.hidden);
  /** @type {Map<string, any[]>} */
  const systems = new Map();
  for (const part of parts) {
    if (!systems.has(part.system)) systems.set(part.system, []);
    systems.get(part.system).push(part);
  }
  return {
    parts,
    systems,
    exactCount: parts.filter((part) => part.confidence === "exact").length,
  };
}

function galleryHtml({ parts }) {
  return parts
    .map((part) => {
      const licence = part.license ?? "MIT";
      const image = part.thumbnail
        ? `<img src="/${escapeHtml(part.thumbnail)}" alt="" width="640" height="480" loading="lazy" decoding="async" />`
        : `<span class="part-card-initial" aria-hidden="true">${escapeHtml(part.system[0])}</span>`;
      return `
          <li class="part-card" data-system="${githubSlug(part.system)}" data-part="${escapeHtml(part.id)}">
            <a href="{{base}}${escapeHtml(benchLink(part.id))}">
              <span class="part-card-image">${image}</span>
              <span class="part-card-body">
                <span class="part-card-system">${escapeHtml(part.system)}</span>
                <span class="part-card-name">${escapeHtml(part.name)}</span>
                <span class="part-card-badges">
                  <span class="badge badge-${escapeHtml(part.confidence)}">${escapeHtml(part.confidence)}</span>
                  <span class="badge">${escapeHtml(licence)}</span>
                </span>
              </span>
              <span class="part-card-open" aria-hidden="true">Open on the Bench →</span>
            </a>
          </li>`;
    })
    .join("");
}

function filterHtml({ parts, systems }) {
  const chip = (value, label, count, pressed) =>
    `
            <button type="button" class="filter-chip" data-filter="${value}" aria-pressed="${pressed}">
              ${escapeHtml(label)} <span class="filter-chip-count">${count}</span>
            </button>`;
  return [
    chip("all", "All", parts.length, true),
    ...[...systems].map(([system, list]) => chip(githubSlug(system), system, list.length, false)),
  ].join("");
}

// The marquee's row of systems. Written twice, the second copy hidden
// from assistive technology, so the CSS animation can slide by exactly
// one copy's width and loop without a seam.
function systemsHtml({ systems }) {
  const row = (hidden) =>
    `
          <ul class="marquee-row"${hidden ? ' aria-hidden="true"' : ""}>
${[...systems]
  .map(
    ([system, list]) =>
      `            <li><span>${escapeHtml(system)}</span><span class="marquee-count">${list.length} part${list.length === 1 ? "" : "s"}</span></li>`,
  )
  .join("\n")}
          </ul>`;
  return row(false) + row(true);
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8")).version;
}

/**
 * The landing page's placeholders, filled.
 * @param {string} html
 * @param {{ parts: any[] }} catalogue
 */
function fillLanding(html, catalogue) {
  const data = landingData(catalogue);
  return html
    .replace("<!-- site:gallery -->", galleryHtml(data))
    .replace("<!-- site:gallery-filters -->", filterHtml(data))
    .replace("<!-- site:systems -->", systemsHtml(data))
    .replaceAll("{{partCount}}", String(data.parts.length))
    .replaceAll("{{systemCount}}", String(data.systems.size))
    .replaceAll("{{exactCount}}", String(data.exactCount))
    .replaceAll("{{version}}", escapeHtml(version()));
}

/**
 * What `virtual:site-data` exports.
 * @param {{ parts: any[] }} catalogue
 */
export function siteData(catalogue) {
  const { parts } = landingData(catalogue);
  const demo = catalogue.parts.find((part) => part.id === DEMO_PART);
  if (!demo?.resize) throw new Error(`${DEMO_PART} has no resize entry for the landing page's demo`);
  return {
    parts: parts.map((part) => ({
      id: part.id,
      name: part.name,
      system: part.system,
      confidence: part.confidence,
      thumbnail: part.thumbnail ?? null,
      bench: benchLink(part.id),
    })),
    resizePart: {
      id: demo.id,
      name: demo.name,
      defaults: demo.defaults,
      resize: demo.resize,
      minimums: demo.minimums,
      maximums: demo.maximums,
    },
  };
}

/**
 * A page of the website with its placeholders filled: the shared header
 * and footer, the catalogue's figures on the landing page, and the links'
 * base. The app's own page has none, and is left exactly as written.
 * @param {string} html
 * @param {string} page the page's path from the site's root ("/index.html", "/docs/cli/index.html")
 * @param {string} base Vite's base
 * @param {() => { parts: any[] }} catalogue read for the landing page only
 */
export function fillPage(html, page, base, catalogue) {
  if (page.startsWith("/app/")) return html;
  let out = html
    .replace("<!-- site:header -->", readPartial("header"))
    .replace("<!-- site:footer -->", readPartial("footer"));
  if (page === "/index.html" || page === "/") out = fillLanding(out, catalogue());
  // The guides mark their own section of the header as the current one.
  if (page.startsWith("/docs/")) out = out.replace('data-nav="docs"', 'data-nav="docs" aria-current="page"');
  return out.replaceAll("{{base}}", base).replaceAll("{{repo}}", REPO_URL);
}

function pageInputs(docPages) {
  const inputs = { main: path.join(WEB, "index.html"), app: path.join(WEB, "app", "index.html") };
  for (const page of docPages) inputs[page.replace(/\/index\.html$|\.html$/, "")] = path.join(WEB, page);
  return inputs;
}

export default function sitePlugin() {
  let base = "/";
  return {
    name: "foundry-site",
    config() {
      return { appType: "mpa", build: { rollupOptions: { input: pageInputs(buildDocs()) } } };
    },
    configResolved(config) {
      base = config.base;
    },
    resolveId(id) {
      return id === SITE_DATA ? SITE_DATA_ID : null;
    },
    load(id) {
      return id === SITE_DATA_ID ? `export default ${JSON.stringify(siteData(readCatalogue()))};` : null;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        return fillPage(html, ctx.path, base, readCatalogue);
      },
    },
    configureServer(server) {
      server.watcher.add([DOCS_SOURCE, PARTIALS]);
      const onChange = (file) => {
        if (file.startsWith(DOCS_SOURCE) && file.endsWith(".md")) {
          buildDocs();
          server.ws.send({ type: "full-reload" });
        } else if (file.startsWith(PARTIALS)) {
          server.ws.send({ type: "full-reload" });
        } else if (file === CATALOGUE) {
          // sync-scad rewrote it (vite-plugin-scad-watch.mjs reloads the page).
          const cached = server.moduleGraph.getModuleById(SITE_DATA_ID);
          if (cached) server.moduleGraph.invalidateModule(cached);
        }
      };
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
    },
  };
}
