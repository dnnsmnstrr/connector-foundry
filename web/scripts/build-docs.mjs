// Renders the user-facing guides in the repository's docs/ folder into
// the website's documentation pages: docs/<slug>/index.html under web/,
// one per guide, plus docs/index.html listing them all. The Markdown
// stays the source — GitHub shows the same files — and the pages are
// generated, like public/catalogue.json: ignored by Git, rewritten by
// vite-plugin-site.mjs whenever Vite starts and, under `npm run dev`,
// whenever a guide changes.
//
// What the website needs that GitHub's rendering does on its own:
// heading ids (GitHub's slugs, so a #fragment works on both), links
// between guides pointed at the website's pages and every other relative
// link at the file on GitHub, and the page around the article — the
// guide list, the "On this page" list, the previous and next guide. The
// site's header and footer are not here: vite-plugin-site.mjs puts the
// same ones into every page.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { REPO_URL } from "../src/lib/commandCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DOCS_SOURCE = path.join(REPO_ROOT, "docs");
export const DOCS_OUT = path.resolve(__dirname, "..", "docs");

// What the website publishes, in the order the sidebar lists it. The rest
// of docs/ is for people working on the code (MACOS.md, WINDOWS.md,
// IMPROVEMENTS.md): the guides link to those on GitHub.
export const DOC_GROUPS = [
  {
    title: "Start here",
    docs: [
      { file: "GETTING_STARTED.md", slug: "getting-started", label: "Getting started" },
      { file: "DESKTOP.md", slug: "desktop", label: "Desktop app" },
      { file: "CLI.md", slug: "cli", label: "Command line" },
    ],
  },
  {
    title: "Using the app",
    docs: [
      { file: "BENCH.md", slug: "bench", label: "Bench" },
      { file: "HOLES.md", slug: "holes", label: "Holes" },
      { file: "JOINTS.md", slug: "joints", label: "Joints" },
      { file: "OVERRIDES.md", slug: "overrides", label: "User overrides" },
    ],
  },
  {
    title: "Under the hood",
    docs: [{ file: "ACCURACY.md", slug: "accuracy", label: "Accuracy" }],
  },
];

const ALL_DOCS = DOC_GROUPS.flatMap((group) => group.docs);
const SLUG_BY_FILE = new Map(ALL_DOCS.map((doc) => [`docs/${doc.file}`, doc.slug]));

// Each guide opens with a line that ends "Back to the README." — a way
// home on GitHub, where the guides are loose files. The website has its
// own navigation, so the sentence goes.
const BACK_TO_README = /\s*Back to the \[README\]\(\.\.\/README\.md\)\./;

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

function decodeEntities(text) {
  return text
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (entity, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name],
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * GitHub's heading ids: lowercase, punctuation dropped, each space a hyphen.
 * @param {string} text the heading as plain text
 */
export function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * Where a link in a guide should point on the website. `href` as written in
 * the Markdown, relative to docs/.
 * @param {string} href
 * @returns {string}
 */
export function resolveDocLink(href) {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const hashAt = href.indexOf("#");
  const target = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const repoPath = path.posix.normalize(path.posix.join("docs", target));
  const slug = SLUG_BY_FILE.get(repoPath);
  if (slug) return `../${slug}/${hash}`;
  // Anything else in the repository: the file (or folder) on GitHub.
  const isDir =
    fs.existsSync(path.join(REPO_ROOT, repoPath)) &&
    fs.statSync(path.join(REPO_ROOT, repoPath)).isDirectory();
  return `${REPO_URL}/${isDir ? "tree" : "blob"}/main/${repoPath}${hash}`;
}

// Shell comments in a muted colour — the only highlighting the guides
// need: their code blocks are commands, and the comment says what each
// does. A `#` counts only at the start of a line or after a space, so a
// URL's #fragment is left alone.
const COMMENTED_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "powershell", "ps1"]);
function highlight(code, lang) {
  return code
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (!COMMENTED_LANGS.has(lang)) return escaped;
      return escaped.replace(/(^|\s)(#.*)$/, '$1<span class="code-comment">$2</span>');
    })
    .join("\n");
}

/**
 * One guide's Markdown as the website's article.
 * @param {string} markdown
 * @returns {{ html: string, title: string, lede: string, toc: { depth: number, id: string, text: string }[] }}
 */
export function renderGuide(markdown) {
  const toc = [];
  const used = new Map();
  let title = "";
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = decodeEntities(this.parser.parseInline(tokens, this.parser.textRenderer));
        let id = githubSlug(text);
        const seen = used.get(id) ?? 0;
        used.set(id, seen + 1);
        if (seen) id = `${id}-${seen}`;
        if (depth === 1) {
          title ||= text;
          return `<h1 id="${id}">${inner}</h1>\n`;
        }
        if (depth <= 3) toc.push({ depth, id, text });
        return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${depth}>\n`;
      },
      link({ href, title: linkTitle, tokens }) {
        const text = this.parser.parseInline(tokens);
        const resolved = resolveDocLink(href);
        const titleAttr = linkTitle ? ` title="${escapeHtml(linkTitle)}"` : "";
        return `<a href="${escapeHtml(resolved)}"${titleAttr}>${text}</a>`;
      },
      image({ href, text }) {
        const src = /^[a-z][a-z0-9+.-]*:/i.test(href)
          ? href
          : `${REPO_URL}/raw/main/${path.posix.normalize(path.posix.join("docs", href))}`;
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}" loading="lazy">`;
      },
      code({ text, lang }) {
        const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
        const label = language ? ` data-lang="${escapeHtml(language)}"` : "";
        return `<pre class="code-block"${label}><code>${highlight(text, language)}</code></pre>\n`;
      },
    },
  });
  const source = markdown.replace(BACK_TO_README, "");
  const tokens = marked.lexer(source);
  const firstParagraph = tokens.find((token) => token.type === "paragraph");
  const lede = firstParagraph
    ? decodeEntities(marked.parseInline(firstParagraph.text).replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim()
    : "";
  const html = marked
    .parser(tokens)
    // A wide table scrolls inside its own box on a phone rather than
    // widening the page.
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");
  return { html, title, lede, toc };
}

function sidebar(currentSlug) {
  return DOC_GROUPS.map(
    (group) => `
          <div class="docs-nav-group">
            <p class="docs-nav-title">${escapeHtml(group.title)}</p>
            <ul>
${group.docs
  .map((doc) => {
    const current = doc.slug === currentSlug ? ' aria-current="page"' : "";
    return `              <li><a href="../${doc.slug}/"${current}>${escapeHtml(doc.label)}</a></li>`;
  })
  .join("\n")}
            </ul>
          </div>`,
  ).join("");
}

function tocList(toc) {
  if (toc.length < 2) return "";
  const items = toc
    .map(
      (entry) =>
        `            <li class="toc-depth-${entry.depth}"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`,
    )
    .join("\n");
  return `
        <nav class="docs-toc" aria-labelledby="toc-title">
          <p class="docs-toc-title" id="toc-title">On this page</p>
          <ul>
${items}
          </ul>
        </nav>`;
}

function pager(index) {
  const prev = ALL_DOCS[index - 1];
  const next = ALL_DOCS[index + 1];
  const link = (doc, rel, label) =>
    doc
      ? `<a class="docs-pager-${rel}" href="../${doc.slug}/" rel="${rel}"><span>${label}</span> ${escapeHtml(doc.label)}</a>`
      : "<span></span>";
  return `<nav class="docs-pager" aria-label="More guides">${link(prev, "prev", "Previous")}${link(next, "next", "Next")}</nav>`;
}

// The parts every generated page shares. The script and stylesheet are
// the site's own (src/site/docs.js imports its CSS); the icon is the
// desktop app's, which Vite copies into the build.
function page({ title, description, bodyClass, main, source }) {
  return `<!doctype html>
<!-- Generated by web/scripts/build-docs.mjs${source ? ` from docs/${source}` : ""}: edit the Markdown, not this file. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0f1115" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="icon" href="/desktop/icon.svg" type="image/svg+xml" />
    <script type="module" src="/src/site/docs.js"></script>
  </head>
  <body class="${bodyClass}">
    <a class="skip-link" href="#content">Skip to content</a>
    <!-- site:header -->
${main}
    <!-- site:footer -->
  </body>
</html>
`;
}

function guidePage(doc, index, guide) {
  const main = `    <div class="docs-shell">
      <div class="docs-sidebar" id="docs-sidebar">
        <nav aria-label="Guides">${sidebar(doc.slug)}
        </nav>
      </div>
      <main class="docs-main" id="content">
        <button class="docs-sidebar-toggle" type="button" aria-controls="docs-sidebar" aria-expanded="false">
          All guides
        </button>
        <article class="prose">
${guide.html}
        </article>
        <footer class="docs-article-footer">
          <a class="docs-edit" href="${REPO_URL}/edit/main/docs/${doc.file}">Edit this page on GitHub</a>
          ${pager(index)}
        </footer>
      </main>${tocList(guide.toc)}
    </div>`;
  return page({
    title: `${guide.title} · Connector Foundry`,
    description: guide.lede,
    bodyClass: "docs-page",
    main,
    source: doc.file,
  });
}

function indexPage(guides) {
  const groups = DOC_GROUPS.map(
    (group) => `
        <section class="docs-index-group" aria-labelledby="group-${githubSlug(group.title)}">
          <h2 id="group-${githubSlug(group.title)}">${escapeHtml(group.title)}</h2>
          <ul class="docs-index-cards">
${group.docs
  .map((doc) => {
    const guide = guides.get(doc.slug);
    return `            <li>
              <a class="docs-card" href="${doc.slug}/">
                <span class="docs-card-title">${escapeHtml(guide.title)}</span>
                <span class="docs-card-text">${escapeHtml(guide.lede)}</span>
              </a>
            </li>`;
  })
  .join("\n")}
          </ul>
        </section>`,
  ).join("");
  const main = `    <main class="docs-index" id="content">
      <header class="docs-index-header">
        <p class="eyebrow">Documentation</p>
        <h1>Guides</h1>
        <p class="docs-index-lede">
          Start with the guide for the way you use Connector Foundry: in the browser, on the desktop
          or from the command line. The rest go deeper into each tab of the app.
        </p>
      </header>${groups}
    </main>`;
  return page({
    title: "Guides · Connector Foundry",
    description:
      "Guides for Connector Foundry: getting started, the desktop app, the command line and the app's tabs.",
    bodyClass: "docs-page docs-home",
    main,
  });
}

/**
 * Writes every page and returns their paths relative to web/, the index
 * first. Pages for guides no longer listed are removed.
 * @returns {string[]}
 */
export function buildDocs() {
  fs.rmSync(DOCS_OUT, { recursive: true, force: true });
  const guides = new Map();
  const written = [];
  ALL_DOCS.forEach((doc, index) => {
    const markdown = fs.readFileSync(path.join(DOCS_SOURCE, doc.file), "utf8");
    const guide = renderGuide(markdown);
    guides.set(doc.slug, guide);
    const file = path.join(DOCS_OUT, doc.slug, "index.html");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, guidePage(doc, index, guide));
    written.push(path.relative(path.resolve(__dirname, ".."), file));
  });
  const index = path.join(DOCS_OUT, "index.html");
  fs.writeFileSync(index, indexPage(guides));
  return [path.relative(path.resolve(__dirname, ".."), index), ...written];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const pages = buildDocs();
  console.log(`build-docs: wrote ${pages.length} pages to ${path.relative(process.cwd(), DOCS_OUT) || "."}`);
}
