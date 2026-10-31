// The bench in the URL, so a reload (or a bookmarked/pasted link) comes
// back to the same setup instead of the start screen. workspace.js also
// keeps the same tree in localStorage, so relaunching the app — the
// desktop app opens a hash-less URL every time — comes back to it too.
//
// The hash carries two things: `mode=bench` or `mode=holes` when that
// tab is up (absent means Library, the default), and `bench=<payload>` — the
// assembly tree as compact JSON (benchConfig.js's own `root`/`nodes`
// shape, with every default-valued field left out) in URL-safe base64.
// A typical bench is a few hundred bytes; a big one a few KB, well inside
// every browser's limit. Written with history.replaceState, debounced by
// the caller, so typing a parameter never piles up history entries.
//
// Imported STL meshes are NOT in the URL — one mesh can be megabytes, and
// the link would be useless anyway. They go to localStorage instead (the
// same embedded shape a config file uses), under the workspace prefix, so
// they survive both a reload and a relaunch. A link opened in another
// browser that names a mesh that browser never saw gets a clear message
// pointing at the config file export, which does carry the meshes.
//
// Restoring goes through hydrateBenchConfig() like any other load: the
// same checks, fresh ids, meshes rebuilt through the validate gate. The
// URL is then rewritten with the new ids on the next mirror, harmlessly.
import { FOLD_MODES, hasShift, normalizeShift } from "./assembly.js";
import { CONFIG_FORMAT, CONFIG_VERSION, hydrateBenchConfig, serializeBenchConfig } from "./benchConfig.js";

const MODE_PARAM = "mode";
const BENCH_PARAM = "bench";

// The workspace's imported meshes, shared by the URL and the saved bench:
// one embedded-imports document, exactly what serializeBenchConfig() puts
// in a config file.
export const STORED_IMPORTS_KEY = "connector-foundry:workspace:imports";

export function readUrlState() {
  const params = hashParams();
  const mode = params.get(MODE_PARAM);
  return {
    mode: mode === "bench" || mode === "library" || mode === "holes" ? mode : null,
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

// Every mainstream browser caps an origin's localStorage at about 5 MB;
// base64 is 4/3 of the bytes, so meshes past this never fit, and encoding
// them (tens of milliseconds per megabyte on the main thread, several
// times that on a phone, right after the import's own validation) would
// only be thrown away by the quota error.
export const IMPORTS_LIMIT_BYTES = 4.5 * 1024 * 1024;

// The meshes the current bench references, kept for a reload or a
// relaunch. Best-effort: a mesh past the ~5 MB quota just isn't there
// next time, and restoreBenchFromUrl() / restoreBenchFromTree() say so.
export function saveStoredImports(assembly, partsById) {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    if (!assembly) {
      storage.removeItem(STORED_IMPORTS_KEY);
      return;
    }
    let bytes = 0;
    for (const id of new Set([assembly.root.partId, ...assembly.nodes.map((n) => n.partId)])) {
      const part = partsById.get(id);
      if (part?.kind === "imported") bytes += part.stlBytes?.byteLength ?? 0;
    }
    if (bytes * (4 / 3) > IMPORTS_LIMIT_BYTES) {
      storage.removeItem(STORED_IMPORTS_KEY);
      console.warn(
        "Bench: the imported meshes are too big to keep between launches; export a config to keep them.",
      );
      return;
    }
    const { imports } = serializeBenchConfig(assembly, partsById);
    if (imports.length === 0) storage.removeItem(STORED_IMPORTS_KEY);
    else storage.setItem(STORED_IMPORTS_KEY, JSON.stringify(imports));
  } catch (err) {
    console.warn("Bench: couldn't keep the imported meshes for next time:", err);
  }
}

function loadStoredImports() {
  const storage = storageOrNull();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORED_IMPORTS_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storageOrNull() {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
  } catch {
    // A private window or a sandboxed frame refuses even to hand it over.
    return null;
  }
}

// { assembly, importedParts } for the bench in the current URL, null when
// the URL has none. Throws with a user-facing message when it has one
// that can't be brought back.
export function restoreBenchFromUrl(catalogueById) {
  const { bench } = readUrlState();
  if (!bench) return null;
  const problem = "The bench in this link couldn't be read — the address may have been cut short.";
  let tree;
  try {
    tree = JSON.parse(decodeBase64Url(bench));
  } catch {
    throw new Error(problem);
  }
  return restoreBenchFromTree(tree, catalogueById, problem);
}

// { assembly, importedParts } for a compact tree (benchTree()'s shape) —
// what the URL carries and what workspace.js keeps in localStorage.
// `problem` is the sentence for a tree that isn't one; the imported meshes
// come from the workspace's shared store.
export function restoreBenchFromTree(
  tree,
  catalogueById,
  problem = "The bench saved in this browser couldn't be read.",
) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || !tree.root) {
    throw new Error(problem);
  }
  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const referenced = new Set(
    [tree.root, ...nodes]
      .map((n) => n?.partId)
      .filter((id) => typeof id === "string" && id.startsWith("imported:")),
  );
  // Only the meshes this tree names: storage may still hold others from an
  // earlier bench, and every one handed to hydration is decoded, validated
  // and checked — a stale or damaged leftover would otherwise break
  // restoring a bench that never used it.
  const imports = loadStoredImports().filter((i) => referenced.has(i?.id));
  const known = new Set(imports.map((i) => i.id));
  const missing = [...referenced].filter((id) => !known.has(id));
  if (missing.length) {
    throw new Error(
      "This bench uses an imported STL that isn't stored in this browser, so it can't be rebuilt " +
        'here. Open it where it was uploaded, or move it with "Download config" / "Import config…", ' +
        "which carries the mesh.",
    );
  }
  const doc = { format: CONFIG_FORMAT, version: CONFIG_VERSION, root: tree.root, nodes, imports };
  if (typeof tree.cropTo === "string") doc.cropTo = tree.cropTo;
  // A fold of the right shape goes on to hydrateBenchConfig(), which
  // keeps it or drops it as it does the crop; one that isn't (a hand-
  // edited link) is dropped here, as a crop that isn't a string is,
  // rather than failing the whole bench.
  if (
    tree.fold &&
    typeof tree.fold === "object" &&
    typeof tree.fold.id === "string" &&
    FOLD_MODES.includes(tree.fold.mode)
  )
    doc.fold = { id: tree.fold.id, mode: tree.fold.mode };
  if (typeof tree.name === "string") doc.name = tree.name;
  return hydrateBenchConfig(doc, catalogueById);
}

// --- encoding ---------------------------------------------------------

// The tree with every default left out: no `joint` means fused, no
// `childAnchor` means mount, no `overlap`/`spin` means 0, no `shift`
// means none, no `params` means none, no `name` means unnamed — exactly
// the defaults hydrateBenchConfig() fills back in. Exported for
// workspace.js, which stores the same tree as plain JSON.
export function benchTree(assembly) {
  const nodes = assembly.nodes.map((n) => {
    const out = { id: n.id, parentId: n.parentId, partId: n.partId, slotName: n.slotName };
    if (n.params && Object.keys(n.params).length) out.params = n.params;
    if (n.joint && n.joint !== "fused") out.joint = n.joint;
    if (n.childAnchor && n.childAnchor !== "mount") out.childAnchor = n.childAnchor;
    if (n.overlap) out.overlap = n.overlap;
    if (n.spin) out.spin = n.spin;
    if (hasShift(n)) out.shift = normalizeShift(n.shift);
    return out;
  });
  const root = { partId: assembly.root.partId };
  if (assembly.root.params && Object.keys(assembly.root.params).length) root.params = assembly.root.params;
  const tree = nodes.length ? { root, nodes } : { root };
  if (assembly.cropTo !== undefined) tree.cropTo = assembly.cropTo;
  if (assembly.fold) tree.fold = { id: assembly.fold.id, mode: assembly.fold.mode };
  if (assembly.name) tree.name = assembly.name;
  return tree;
}

export function encodeTree(assembly) {
  return encodeBase64Url(JSON.stringify(benchTree(assembly)));
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
