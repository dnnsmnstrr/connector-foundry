// A bench's name — what its exported files are called. The Bench asks
// for one before the first export when none is set (assembly.js's
// `name`), and proposes the one defaultBenchName() builds here.
import { ROOT_ID, childrenOf } from "./assembly.js";

// The parts in tree order (root, then each subtree depth-first), each
// distinct part once, joined with "_": "gridfinity-base_gopro-female".
// A catalogue part contributes its id with the system/part slash turned
// into a dash; an imported mesh its file name without the extension.
// Enough to tell one export from another in a downloads folder, and the
// same separator the per-body suffix uses (exportFilename()).
export function defaultBenchName(assembly, partsById) {
  const seen = new Set();
  const names = [];
  const visit = (nodeId, partId) => {
    if (!seen.has(partId)) {
      seen.add(partId);
      names.push(partLabel(partsById.get(partId), partId));
    }
    for (const child of childrenOf(assembly, nodeId)) visit(child.id, child.partId);
  };
  visit(ROOT_ID, assembly.root.partId);
  return names.join("_");
}

function partLabel(part, partId) {
  if (part?.kind === "imported") {
    const stem = String(part.name ?? "imported").replace(/\.[^.]+$/, "");
    return safeStem(stem) || "imported";
  }
  return safeStem(String(part?.id ?? partId).replace(/\//g, "-")) || "part";
}

// `name` as a file name stem: trimmed, with the characters no file
// system takes (and whitespace) turned into "-", runs collapsed. Never
// empty — "bench" when nothing is left.
export function safeStem(name) {
  const stem = String(name ?? "")
    .trim()
    .replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return stem;
}

// "<name>_<suffix>.<ext>" — the suffix (a body tag) is optional.
export function exportFilename(name, suffix, extension) {
  const stem = safeStem(name) || "bench";
  return `${stem}${suffix ? `_${suffix}` : ""}${extension}`;
}
