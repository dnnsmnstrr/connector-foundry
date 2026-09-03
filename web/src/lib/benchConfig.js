// A Bench setup as a file: the assembly tree (assembly.js's shape, near
// enough verbatim) plus every imported STL it references, embedded
// base64 so the one file is self-contained — a config that named an
// upload the receiving browser has never seen would be unloadable.
// Saved to disk by the Bench's "Download config" button, read back by
// "Import config…", and stored as-is by benchPresets.js, so a preset and
// a config file are the same document; the only difference is where it
// lives.
//
// Loading is deliberately not a straight JSON.parse into state:
// hydrateBenchConfig() checks the document (format tag, every part id
// against the live catalogue, every parent reference, every joint name),
// re-issues node and import ids through the session's own allocators so
// the next part attached can't collide with a loaded one, and rebuilds
// each imported part through the same validate/repair gate an upload
// goes through — the bytes are the repaired mesh createImportedPart()
// exported, so they pass, and the recomputed bounding-box center is the
// one the saved anchors are relative to.
//
// Slot names are NOT checked here: which slots a part has depends on its
// rendered size and parameters (slots.js), which needs a render. A stale
// slot name (a config saved against a bigger grid, say) surfaces as an
// OpenSCAD error on the next render, the same way a bad parameter does,
// not as a silent misplacement.
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { JOINTS, ROOT_ID, allocateChildId, normalizeSpin } from "./assembly.js";
import { createImportedPart } from "./importedPart.js";
import { validateAndRepair } from "./meshValidate.js";

export const CONFIG_FORMAT = "connector-foundry/bench";
export const CONFIG_VERSION = 1;
export const CONFIG_EXTENSION = ".bench.json";

// The plain, JSON-ready document for the current assembly. `name` is
// optional — the preset name, when saving one, or the root part's name
// for a downloaded file (a hint for whoever opens it later, nothing more).
export function serializeBenchConfig(assembly, partsById, name) {
  const imports = [];
  const seen = new Set();
  const allPartIds = [assembly.root.partId, ...assembly.nodes.map((n) => n.partId)];
  for (const partId of allPartIds) {
    const part = partsById.get(partId);
    if (part?.kind !== "imported" || seen.has(partId)) continue;
    seen.add(partId);
    imports.push({
      id: part.id,
      name: part.name,
      anchors: part.anchors.map((a) => ({ name: a.name, point: [...a.point], normal: [...a.normal] })),
      stl: bytesToBase64(part.stlBytes),
    });
  }
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    ...(name ? { name } : {}),
    savedAt: new Date().toISOString(),
    root: { partId: assembly.root.partId, params: { ...assembly.root.params } },
    nodes: assembly.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      partId: n.partId,
      params: { ...n.params },
      slotName: n.slotName,
      joint: n.joint,
      childAnchor: n.childAnchor,
      overlap: n.overlap ?? 0,
      spin: n.spin ?? 0,
    })),
    // The node everything else is cropped to (assembly.js's setCropTo),
    // only when set — the common case has no key at all.
    ...(assembly.cropTo !== undefined ? { cropTo: assembly.cropTo } : {}),
    imports,
  };
}

export function configToJson(doc) {
  return JSON.stringify(doc, null, 2);
}

// Text from a file -> a checked document. Every failure is an Error whose
// message is meant to be shown to the user as-is.
export function parseBenchConfig(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("This isn't a JSON file.");
  }
  return checkBenchConfig(doc);
}

// The structural checks that don't need the catalogue: is this one of
// our documents, and does every field have the shape hydration relies
// on. Returns `doc` itself when it passes.
export function checkBenchConfig(doc) {
  if (!isObject(doc) || doc.format !== CONFIG_FORMAT) {
    throw new Error("This isn't a Connector Foundry bench config (no \"format\": \"connector-foundry/bench\").");
  }
  if (doc.version !== CONFIG_VERSION) {
    throw new Error(`This config is version ${JSON.stringify(doc.version)}; this app reads version ${CONFIG_VERSION}.`);
  }
  if (!isObject(doc.root) || typeof doc.root.partId !== "string" || !isObject(doc.root.params ?? {})) {
    throw new Error("The config has no valid root part.");
  }
  if (!Array.isArray(doc.nodes)) throw new Error("The config's \"nodes\" isn't a list.");
  doc.nodes.forEach((n, i) => {
    if (!isObject(n) || typeof n.id !== "string" || typeof n.parentId !== "string" || typeof n.partId !== "string"
      || typeof n.slotName !== "string") {
      throw new Error(`Attached part #${i + 1} is missing its id, parent, part, or slot.`);
    }
    if (n.params !== undefined && !isObject(n.params)) throw new Error(`Attached part "${n.id}" has malformed parameters.`);
    if (n.joint !== undefined && !JOINTS.includes(n.joint)) {
      throw new Error(`Attached part "${n.id}" uses an unknown joint "${n.joint}" (known: ${JOINTS.join(", ")}).`);
    }
    if (n.childAnchor !== undefined && typeof n.childAnchor !== "string") throw new Error(`Attached part "${n.id}" has a malformed anchor.`);
    if (n.overlap !== undefined && typeof n.overlap !== "number") throw new Error(`Attached part "${n.id}" has a non-numeric offset.`);
    if (n.spin !== undefined && typeof n.spin !== "number") throw new Error(`Attached part "${n.id}" has a non-numeric rotation.`);
  });
  if (doc.cropTo !== undefined && typeof doc.cropTo !== "string") throw new Error("The config's \"cropTo\" isn't a part id.");
  if (doc.imports !== undefined) {
    if (!Array.isArray(doc.imports)) throw new Error("The config's \"imports\" isn't a list.");
    doc.imports.forEach((imp, i) => {
      if (!isObject(imp) || typeof imp.id !== "string" || typeof imp.stl !== "string" || !Array.isArray(imp.anchors)) {
        throw new Error(`Imported mesh #${i + 1} is missing its id, anchors, or STL data.`);
      }
      for (const a of imp.anchors) {
        if (!isObject(a) || typeof a.name !== "string" || !isVec3(a.point) || !isVec3(a.normal)) {
          throw new Error(`Imported mesh "${imp.name ?? imp.id}" has a malformed slot.`);
        }
      }
    });
  }
  return doc;
}

// A checked document -> { assembly, importedParts } ready for Bench state.
// `catalogueById` is the live catalogue (id -> part); imported parts are
// rebuilt from the document and returned separately so the caller can
// merge them into its own imported-parts map.
export function hydrateBenchConfig(doc, catalogueById) {
  checkBenchConfig(doc);

  // Imported meshes first: they get fresh ids, and every reference to the
  // saved id below goes through this map.
  const importIdMap = new Map();
  const importedParts = new Map();
  for (const imp of doc.imports ?? []) {
    const name = imp.name ?? "imported.stl";
    let validation;
    try {
      const rawGeometry = new STLLoader().parse(base64ToBytes(imp.stl));
      validation = validateAndRepair(rawGeometry);
    } catch (err) {
      throw new Error(`Couldn't read the embedded mesh "${name}": ${err.message}`);
    }
    if (!validation.ok) {
      throw new Error(`The embedded mesh "${name}" didn't pass validation: ${validation.report.join(" ")}`);
    }
    const part = createImportedPart(name, validation, imp.anchors);
    importIdMap.set(imp.id, part.id);
    importedParts.set(part.id, part);
  }

  const resolvePart = (savedId, where) => {
    if (importIdMap.has(savedId)) return importIdMap.get(savedId);
    if (catalogueById.has(savedId)) return savedId;
    throw new Error(`${where} uses part "${savedId}", which isn't in this catalogue${importIdMap.size || (doc.imports?.length ?? 0) ? " or among the config's imported meshes" : ""}.`);
  };

  const root = { id: ROOT_ID, partId: resolvePart(doc.root.partId, "The root"), params: { ...(doc.root.params ?? {}) } };

  // Nodes may appear in any order in the file; hand out ids parents-first
  // so a child always finds its parent's new id. A node whose parent is
  // never resolved (missing, or part of a cycle) is an error, not a
  // silent drop.
  const nodeIdMap = new Map([[ROOT_ID, ROOT_ID]]);
  const pending = [...doc.nodes];
  const nodes = [];
  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; ) {
      const n = pending[i];
      if (!nodeIdMap.has(n.parentId)) {
        i++;
        continue;
      }
      if (nodeIdMap.has(n.id)) throw new Error(`Attached part id "${n.id}" appears twice.`);
      const id = allocateChildId();
      nodeIdMap.set(n.id, id);
      nodes.push({
        id,
        parentId: nodeIdMap.get(n.parentId),
        partId: resolvePart(n.partId, `Attached part "${n.id}"`),
        params: { ...(n.params ?? {}) },
        slotName: n.slotName,
        joint: n.joint ?? "fused",
        childAnchor: n.childAnchor ?? "mount",
        overlap: n.overlap ?? 0,
        spin: normalizeSpin(n.spin ?? 0),
      });
      pending.splice(i, 1);
    }
    if (pending.length === before) {
      const orphan = pending[0];
      throw new Error(`Attached part "${orphan.id}" is attached to "${orphan.parentId}", which isn't in the config.`);
    }
  }

  const assembly = { root, nodes };
  // A crop naming a node the config doesn't have is dropped, not fatal:
  // the bench is complete without it, and a mask with nothing in it
  // would cut everything away.
  if (doc.cropTo !== undefined && nodeIdMap.has(doc.cropTo)) assembly.cropTo = nodeIdMap.get(doc.cropTo);
  return { assembly, importedParts };
}

// A filename for a downloaded config: the given name slugged, or "bench".
export function configFilename(name) {
  const slug = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "bench"}${CONFIG_EXTENSION}`;
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

// Chunked so a multi-megabyte mesh doesn't blow the argument limit of
// String.fromCharCode(...bytes).
function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
