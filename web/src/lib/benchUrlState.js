// The bench in the URL, so a reload (or a bookmarked/pasted link) comes
// back to the same setup instead of the start screen.
//
// The hash carries two things: `mode=bench` when the Bench tab is up
// (absent means Library, the default), and `bench=<payload>` — the
// assembly tree as compact JSON (benchConfig.js's own `root`/`nodes`
// shape, with every default-valued field left out) in URL-safe base64.
// A typical bench is a few hundred bytes; a big one a few KB, well inside
// every browser's limit. Written with history.replaceState, debounced by
// the caller, so typing a parameter never piles up history entries.
//
// Imported STL meshes are NOT in the URL — one mesh can be megabytes, and
// the link would be useless anyway. They go to sessionStorage instead
// (the same embedded shape a config file uses), which survives a reload
// of this tab and nothing else. A link opened elsewhere that names a
// mesh this tab never saw gets a clear message pointing at the config
// file export, which does carry the meshes.
//
// Restoring goes through hydrateBenchConfig() like any other load: the
// same checks, fresh ids, meshes rebuilt through the validate gate. The
// URL is then rewritten with the new ids on the next mirror, harmlessly.
import { CONFIG_FORMAT, CONFIG_VERSION, hydrateBenchConfig, serializeBenchConfig } from "./benchConfig.js";

const MODE_PARAM = "mode";
const BENCH_PARAM = "bench";
const SESSION_IMPORTS_KEY = "connector-foundry:benchImports";

export function readUrlState() {
  const params = hashParams();
  const mode = params.get(MODE_PARAM);
  return {
    mode: mode === "bench" || mode === "library" ? mode : null,
    bench: params.get(BENCH_PARAM),
  };
}

// Mirror `mode` and `assembly` into the hash. Library with no bench is
// the default and gets no hash at all, so the plain URL stays plain.
export function writeUrlState({ mode, assembly }) {
  const params = new URLSearchParams();
  if (mode && mode !== "library") params.set(MODE_PARAM, mode);
  if (assembly) params.set(BENCH_PARAM, encodeTree(assembly));
  const hash = params.toString();
  const { pathname, search } = window.location;
  const next = `${pathname}${search}${hash ? `#${hash}` : ""}`;
  if (next === `${pathname}${search}${window.location.hash}`) return;
  try {
    window.history.replaceState(window.history.state, "", next);
  } catch {
    // Some embedding contexts refuse; the in-memory bench is unaffected.
  }
}

// The meshes the current bench references, kept for a reload of this tab.
// Best-effort: a mesh past the ~5 MB quota just isn't there after a
// reload, and restoreBenchFromUrl() says so.
export function saveSessionImports(assembly, partsById) {
  try {
    if (!assembly) {
      window.sessionStorage.removeItem(SESSION_IMPORTS_KEY);
      return;
    }
    const { imports } = serializeBenchConfig(assembly, partsById);
    if (imports.length === 0) window.sessionStorage.removeItem(SESSION_IMPORTS_KEY);
    else window.sessionStorage.setItem(SESSION_IMPORTS_KEY, JSON.stringify(imports));
  } catch (err) {
    console.warn("Bench: couldn't keep the imported meshes for a reload:", err);
  }
}

function loadSessionImports() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(SESSION_IMPORTS_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// { assembly, importedParts } for the bench in the current URL, null when
// the URL has none. Throws with a user-facing message when it has one
// that can't be brought back.
export function restoreBenchFromUrl(catalogueById) {
  const { bench } = readUrlState();
  if (!bench) return null;
  let tree;
  try {
    tree = JSON.parse(decodeBase64Url(bench));
  } catch {
    throw new Error("The bench in this link couldn't be read — the address may have been cut short.");
  }
  if (!tree || typeof tree !== "object" || !tree.root) {
    throw new Error("The bench in this link couldn't be read — the address may have been cut short.");
  }
  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const imports = loadSessionImports();
  const known = new Set(imports.map((i) => i.id));
  const missing = [tree.root, ...nodes]
    .map((n) => n?.partId)
    .filter((id) => typeof id === "string" && id.startsWith("imported:") && !known.has(id));
  if (missing.length) {
    throw new Error(
      "This bench uses an imported STL that is only kept in the tab it was uploaded in, so it can't be " +
        "rebuilt here. Open it in that tab, or move it with \"Download config\" / \"Import config…\", which carries the mesh.",
    );
  }
  const doc = { format: CONFIG_FORMAT, version: CONFIG_VERSION, root: tree.root, nodes, imports };
  if (typeof tree.cropTo === "string") doc.cropTo = tree.cropTo;
  return hydrateBenchConfig(doc, catalogueById);
}

// --- encoding ---------------------------------------------------------

// The tree with every default left out: no `joint` means fused, no
// `childAnchor` means mount, no `overlap`/`spin` means 0, no `params`
// means none — exactly the defaults hydrateBenchConfig() fills back in.
function compactTree(assembly) {
  const nodes = assembly.nodes.map((n) => {
    const out = { id: n.id, parentId: n.parentId, partId: n.partId, slotName: n.slotName };
    if (n.params && Object.keys(n.params).length) out.params = n.params;
    if (n.joint && n.joint !== "fused") out.joint = n.joint;
    if (n.childAnchor && n.childAnchor !== "mount") out.childAnchor = n.childAnchor;
    if (n.overlap) out.overlap = n.overlap;
    if (n.spin) out.spin = n.spin;
    return out;
  });
  const root = { partId: assembly.root.partId };
  if (assembly.root.params && Object.keys(assembly.root.params).length) root.params = assembly.root.params;
  const tree = nodes.length ? { root, nodes } : { root };
  if (assembly.cropTo !== undefined) tree.cropTo = assembly.cropTo;
  return tree;
}

export function encodeTree(assembly) {
  return encodeBase64Url(JSON.stringify(compactTree(assembly)));
}

function hashParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
