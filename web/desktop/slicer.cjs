// Opening a rendered model straight in a desktop slicer, with no Save
// dialog and no trip through the Downloads folder.
//
// Each open writes the model under its own human-readable filename inside a
// fresh directory under <temp>/connector-foundry-slicer/<stamp>-<rand>/:
// slicers name the project and plate after the file's basename, and a directory
// per open means a second open of the same part cannot overwrite the first
// while a slow-starting slicer is still reading it. Directories older than a
// day are swept up on the next open.
//
// First tries the operating system's registered handler for the file
// (Electron's shell.openPath(), which resolves to "" when the file was handed
// over, or an error string when no program claims the extension). When the
// system has no handler associated with .3mf/.stl yet, falls back to launching
// the first known slicer found in the platform's standard install locations.
//
// Electron-free so it is unit-tested directly in Node
// (tests/unit/desktop-slicer.test.js); main.cjs supplies tempRoot and
// shell.openPath.

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TEMP_FOLDER = "connector-foundry-slicer";
const MAX_SLICER_BYTES = 256 * 1024 * 1024;
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;
const SLICER_EXTENSIONS = Object.freeze([".3mf", ".stl"]);
const UNSAFE_CHARS = /[/\\:*?"<>|\p{Cc}]+/gu;

// Known desktop slicers in the order tried when the OS has no default handler
// associated with .3mf or .stl yet.
const MAC_SLICERS = Object.freeze([
  { name: "OrcaSlicer", rel: "OrcaSlicer.app" },
  { name: "Bambu Studio", rel: "BambuStudio.app" },
  { name: "PrusaSlicer", rel: "PrusaSlicer.app" },
  { name: "PrusaSlicer", rel: path.join("Original Prusa Drivers", "PrusaSlicer.app") },
  { name: "SuperSlicer", rel: "SuperSlicer.app" },
  { name: "UltiMaker Cura", rel: "UltiMaker-Cura.app" },
  { name: "UltiMaker Cura", rel: "UltiMaker Cura.app" },
  { name: "ElegooSlicer", rel: "ElegooSlicer.app" },
  { name: "Creality Print", rel: "Creality Print.app" },
  { name: "AnycubicSlicerNext", rel: "AnycubicSlicerNext.app" },
]);

const WINDOWS_SLICERS = Object.freeze([
  { name: "OrcaSlicer", rel: path.win32.join("OrcaSlicer", "orca-slicer.exe") },
  { name: "Bambu Studio", rel: path.win32.join("Bambu Studio", "bambu-studio.exe") },
  { name: "PrusaSlicer", rel: path.win32.join("Prusa3D", "PrusaSlicer", "prusa-slicer.exe") },
  { name: "SuperSlicer", rel: path.win32.join("SuperSlicer", "superslicer.exe") },
  { name: "UltiMaker Cura", rel: path.win32.join("UltiMaker Cura", "UltiMaker-Cura.exe") },
]);

const LINUX_SLICERS = Object.freeze([
  { name: "OrcaSlicer", bin: "orca-slicer" },
  { name: "Bambu Studio", bin: "bambu-studio" },
  { name: "PrusaSlicer", bin: "prusa-slicer" },
  { name: "SuperSlicer", bin: "superslicer" },
  { name: "UltiMaker Cura", bin: "cura" },
]);

/**
 * Checks and cleans a model filename so it is safe to write inside a temp
 * directory and ends in .3mf or .stl.
 * @param {unknown} filename
 * @returns {string}
 */
function sanitizeSlicerFilename(filename) {
  if (typeof filename !== "string" || !filename.trim()) {
    throw new Error("A model filename (.3mf or .stl) is required.");
  }
  const base = path.posix.basename(filename.trim().replace(/\\/g, "/"));
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  if (!SLICER_EXTENSIONS.includes(ext)) {
    throw new Error("Only .3mf and .stl files can be opened in a slicer.");
  }
  const rawStem = base
    .slice(0, dot)
    .replace(UNSAFE_CHARS, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  const stem = (rawStem || "model").slice(0, 120);
  return `${stem}${ext}`;
}

/**
 * Checks the model payload and returns a Buffer over it.
 * @param {unknown} bytes
 * @returns {Buffer}
 */
function checkSlicerBytes(bytes) {
  let buf = null;
  if (Buffer.isBuffer(bytes)) {
    buf = bytes;
  } else if (bytes instanceof ArrayBuffer) {
    buf = Buffer.from(bytes);
  } else if (ArrayBuffer.isView(bytes)) {
    buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (!buf || buf.byteLength === 0) {
    throw new Error("There is no model geometry to open.");
  }
  if (buf.byteLength > MAX_SLICER_BYTES) {
    throw new Error("The model is too large to hand over to the slicer.");
  }
  return buf;
}

/**
 * Finds the first installed desktop slicer in standard locations on `platform`.
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   homedir?: string,
 *   existsSync?: (p: string) => boolean,
 * }} [options]
 * @returns {{ name: string, target: string, kind: "mac-app" | "binary" } | null}
 */
function findInstalledSlicer({
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
  existsSync = fs.existsSync,
} = {}) {
  if (platform === "darwin") {
    const roots = ["/Applications", homedir ? path.join(homedir, "Applications") : null].filter(Boolean);
    for (const { name, rel } of MAC_SLICERS) {
      for (const root of roots) {
        const candidate = path.join(root, rel);
        if (existsSync(candidate)) return { name, target: candidate, kind: "mac-app" };
      }
    }
    return null;
  }
  if (platform === "win32") {
    const roots = [
      env.ProgramFiles,
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Programs") : null,
      env["ProgramFiles(x86)"],
    ].filter(Boolean);
    for (const { name, rel } of WINDOWS_SLICERS) {
      for (const root of roots) {
        const candidate = path.win32.join(root, rel);
        if (existsSync(candidate)) return { name, target: candidate, kind: "binary" };
      }
    }
    return null;
  }
  const pathDirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const { name, bin } of LINUX_SLICERS) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, bin);
      if (existsSync(candidate)) return { name, target: candidate, kind: "binary" };
    }
  }
  return null;
}

/**
 * Launches a found slicer with `filePath`.
 * @param {{ name: string, target: string, kind: "mac-app" | "binary" }} slicer
 * @param {string} filePath
 * @returns {Promise<void>}
 */
function launchInstalledSlicer(slicer, filePath) {
  return new Promise((resolve, reject) => {
    const command = slicer.kind === "mac-app" ? "open" : slicer.target;
    const args = slicer.kind === "mac-app" ? ["-a", slicer.target, filePath] : [filePath];
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Removes temp directories under `root` older than `STALE_TEMP_MS`.
 * Best-effort: a locked file on Windows or a missing directory is ignored.
 * @param {string} root
 * @param {number} now
 */
function pruneStaleTempDirs(root, now) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      const stat = fs.statSync(dir);
      if (now - stat.mtimeMs >= STALE_TEMP_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      /* Still open in a slicer, or already gone. */
    }
  }
}

/**
 * Writes `bytes` to a fresh temporary directory under `filename` and hands it
 * to the user's slicer. Resolves to `{ ok: true, path, slicer? }` or
 * `{ ok: false, error }` — never rejects, so the renderer always receives a
 * structured answer over IPC.
 * @param {{
 *   bytes: unknown,
 *   filename: unknown,
 *   tempRoot?: string,
 *   openPath: (filePath: string) => Promise<string>,
 *   findSlicer?: () => { name: string, target: string, kind: "mac-app" | "binary" } | null,
 *   launchSlicer?: (slicer: { name: string, target: string, kind: "mac-app" | "binary" }, filePath: string) => Promise<void>,
 *   now?: number,
 * }} options
 * @returns {Promise<{ ok: true, path: string, slicer?: string } | { ok: false, error: string }>}
 */
async function openModelInSlicer({
  bytes,
  filename,
  tempRoot = os.tmpdir(),
  openPath,
  findSlicer = findInstalledSlicer,
  launchSlicer = launchInstalledSlicer,
  now = Date.now(),
}) {
  let safeName;
  let buffer;
  try {
    safeName = sanitizeSlicerFilename(filename);
    buffer = checkSlicerBytes(bytes);
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }

  const baseDir = path.join(tempRoot, TEMP_FOLDER);
  pruneStaleTempDirs(baseDir, now);

  const runDir = path.join(baseDir, `${now}-${crypto.randomBytes(4).toString("hex")}`);
  const filePath = path.join(runDir, safeName);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
  } catch (err) {
    return { ok: false, error: `Couldn't write the temporary model file: ${err.message}` };
  }

  let openError = "";
  try {
    openError = (await openPath(filePath)) || "";
  } catch (err) {
    openError = String(err?.message ?? err);
  }
  if (!openError) {
    return { ok: true, path: filePath };
  }

  const fallback = findSlicer();
  if (fallback) {
    try {
      await launchSlicer(fallback, filePath);
      return { ok: true, path: filePath, slicer: fallback.name };
    } catch {
      /* Fall through to the user-facing error below. */
    }
  }

  return {
    ok: false,
    error:
      "Couldn't open a slicer. Install PrusaSlicer, OrcaSlicer, Bambu Studio or Cura, or associate .3mf files with your slicer.",
  };
}

module.exports = {
  MAX_SLICER_BYTES,
  SLICER_EXTENSIONS,
  STALE_TEMP_MS,
  TEMP_FOLDER,
  checkSlicerBytes,
  findInstalledSlicer,
  launchInstalledSlicer,
  openModelInSlicer,
  pruneStaleTempDirs,
  sanitizeSlicerFilename,
};
