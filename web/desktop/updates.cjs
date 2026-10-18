// The desktop app updating itself from GitHub releases. Electron's own
// autoUpdater can't be used: on macOS it is Squirrel.Mac, which accepts an
// update only when it is signed by the same Developer ID as the running
// app, and these builds are signed ad hoc (electron-builder.yml). So the
// app does what Squirrel and electron-updater do, with the release's
// checksums standing in for a signature:
//
// 1. Check: fetch the newest release's latest.json (update-manifest.cjs;
//    the release job writes it) and compare its version with this one.
// 2. Download this computer's file from that release, pinned to its tag,
//    and keep it only if its size and SHA-256 match the manifest. On macOS
//    unpack the ZIP and check the bundle inside: its identifier, its
//    version and its code signature's seal.
// 3. Install when the user restarts, or when the app quits: macOS swaps
//    the bundle from a detached script once the app has exited; Windows
//    runs the NSIS installer silently, which finds the installation in the
//    registry, elevates itself for an all-users one, and starts the app
//    again with --force-run.
//
// The trust is the same as a download from the releases page by hand: the
// release on GitHub, over HTTPS. A file written by the app carries no
// quarantine flag, so macOS doesn't ask for "Open Anyway" again.
//
// Before quitting to install, the app notes the version it is installing
// (pending-update.json); the next launch compares that with its own to
// tell whether the update took, and a failed one isn't retried on its own
// until the user checks by hand, so an update that can't install (macOS
// refusing to let the bundle be replaced, say) doesn't loop.
//
// Checks run 30 s after launch and twice a day, unless the user turns that
// off in Settings (updates.json). A development run never checks on its
// own and can't install, but a check by hand still reports the newest
// release.

const { app, dialog, ipcMain, net, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const manifest = require("./update-manifest.cjs");

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const MANIFEST_MAX_BYTES = 64 * 1024;
// Progress goes to the page at most this often; a download is thousands
// of chunks.
const PROGRESS_EVERY_MS = 250;

/** A failure worth showing the user as it is. */
class UpdateError extends Error {}

/**
 * @typedef {object} UpdateStatus
 * @property {string} version the running app's
 * @property {boolean} autoCheck the user's switch
 * @property {"idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error"} state
 *   "available": newer, but this copy can't install it itself (`manual` says why)
 * @property {string | null} latest the newest version the last check found
 * @property {number | null} progress 0–1 while downloading
 * @property {string | null} releaseUrl that version's release page
 * @property {number | null} checkedAt when the last check finished (ms)
 * @property {string | null} error why the last check, download or install failed
 * @property {string | null} manual why this copy can't install updates itself
 * @property {string | null} justUpdated the version this launch was updated to, if it was
 */

/**
 * @param {{
 *   getWindow: () => import("electron").BrowserWindow | null,
 *   isAppURL: (url: string) => boolean,
 * }} options
 */
function setupUpdates({ getWindow, isAppURL }) {
  const userData = app.getPath("userData");
  const settingsFile = path.join(userData, "updates.json");
  const pendingFile = path.join(userData, "pending-update.json");
  // One folder, emptied before each download: nothing piles up in temp
  // from earlier versions.
  const stageRoot = path.join(app.getPath("temp"), "connector-foundry-update");
  const settings = readSettings(settingsFile);

  /** @type {Omit<UpdateStatus, "version" | "autoCheck" | "releaseUrl" | "manual" | "justUpdated">} */
  let state = { state: "idle", latest: null, progress: null, checkedAt: null, error: null };
  /** @type {string | null} */
  let manual = installProblem();
  /** @type {string | null} */
  let justUpdated = null;
  /** @type {{ version: string, file: string, bundle: string | null, stage: string } | null} */
  let ready = null;
  /** @type {Promise<UpdateStatus> | null} */
  let running = null;
  /** @type {AbortController | null} */
  let abort = null;
  let installing = false;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;

  // The last launch quit to install an update: did it take?
  const pending = readPending(pendingFile, isAppURL);
  let restoreURL = pending?.url ?? null;
  if (pending) {
    if (pending.version === app.getVersion()) justUpdated = pending.version;
    else if (manifest.isNewer(pending.version, app.getVersion())) {
      settings.failed = pending.version;
      saveSettings();
      state = {
        ...state,
        latest: pending.version,
        error: `The update to ${pending.version} didn't install. Check for updates to try again, or download it from the release page.`,
        state: "error",
      };
    }
  }

  function saveSettings() {
    try {
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // The switch still holds for this run.
    }
  }

  /** @returns {UpdateStatus} */
  function status() {
    return {
      version: app.getVersion(),
      autoCheck: settings.autoCheck,
      ...state,
      releaseUrl: state.latest ? manifest.releaseUrl(state.latest) : null,
      manual,
      justUpdated,
    };
  }

  function broadcast() {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("updates:status", status());
  }

  /** @param {Partial<typeof state>} next */
  function set(next) {
    state = { ...state, ...next };
    broadcast();
  }

  /**
   * Checks for a newer release and downloads it if this copy can install
   * it. One at a time: a second call while one runs gets the same answer.
   * @param {{ byHand?: boolean }} [options] a check the user asked for
   *   retries a version that failed to install before
   */
  function check({ byHand = false } = {}) {
    if (running) return running;
    if (ready || installing) return Promise.resolve(status());
    running = (async () => {
      set({ state: "checking", error: null, progress: null });
      try {
        const found = manifest.checkManifest(await fetchManifest());
        set({ latest: found.version, checkedAt: Date.now() });
        if (!manifest.isNewer(found.version, app.getVersion())) {
          manual = installProblem();
          set({ state: "up-to-date" });
          return status();
        }
        const asset = manifest.pickAsset(
          found,
          manifest.assetCandidates({
            platform: process.platform,
            arch: process.arch,
            translated: app.runningUnderARM64Translation,
          }),
        );
        if (byHand && settings.failed) {
          settings.failed = null;
          saveSettings();
        }
        manual =
          installProblem() ??
          (asset
            ? null
            : `Version ${found.version} has no build for this computer to install itself from.`) ??
          (settings.failed === found.version
            ? `The update to ${found.version} didn't install last time. Download it from the release page, or check for updates to try again.`
            : null);
        if (manual || !asset) {
          set({ state: "available" });
          return status();
        }
        await download(found.version, asset);
        set({ state: "ready", progress: null });
      } catch (err) {
        set({ state: "error", progress: null, error: describe(err) });
      } finally {
        abort = null;
        running = null;
      }
      return status();
    })();
    return running;
  }

  async function fetchManifest() {
    let response;
    try {
      response = await net.fetch(manifest.MANIFEST_URL, { cache: "no-store" });
    } catch {
      throw new UpdateError("Couldn't reach GitHub to check for updates. Check the internet connection.");
    }
    // Releases from before the updater have no manifest.
    if (response.status === 404) throw new UpdateError("The newest release has no update information.");
    if (!response.ok) throw new UpdateError(`GitHub answered ${response.status} to the update check.`);
    const text = await response.text();
    if (text.length > MANIFEST_MAX_BYTES) throw new UpdateError("The update manifest is too large.");
    try {
      return JSON.parse(text);
    } catch {
      throw new UpdateError("The update manifest is malformed.");
    }
  }

  /**
   * @param {string} version
   * @param {{ name: string, sha256: string, size: number }} asset
   */
  async function download(version, asset) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    const stage = path.join(stageRoot, version);
    fs.mkdirSync(stage, { recursive: true });
    const file = path.join(stage, asset.name);
    set({ state: "downloading", progress: 0 });
    abort = new AbortController();
    let response;
    try {
      response = await net.fetch(manifest.downloadUrl(version, asset.name), { signal: abort.signal });
    } catch (err) {
      if (abort.signal.aborted) throw err;
      throw new UpdateError("Couldn't reach GitHub to download the update.");
    }
    if (!response.ok || !response.body)
      throw new UpdateError(`GitHub answered ${response.status} to the update's download.`);
    const hash = crypto.createHash("sha256");
    let received = 0;
    let reported = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > asset.size) {
          callback(new UpdateError("The download is larger than the release says, so it was thrown away."));
          return;
        }
        hash.update(chunk);
        const now = Date.now();
        if (now - reported >= PROGRESS_EVERY_MS) {
          reported = now;
          set({ progress: received / asset.size });
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), meter, fs.createWriteStream(file), {
      signal: abort.signal,
    });
    if (received !== asset.size) throw new UpdateError("The download was cut short. Try again.");
    if (hash.digest("hex") !== asset.sha256)
      throw new UpdateError("The download didn't match the release's checksum, so it was thrown away.");
    const bundle = process.platform === "darwin" ? await unpackMac(file, stage, version) : null;
    ready = { version, file, bundle, stage };
  }

  /**
   * The new bundle out of its ZIP, checked before it may replace this one.
   * @param {string} zip
   * @param {string} stage
   * @param {string} version
   */
  async function unpackMac(zip, stage, version) {
    const unpacked = path.join(stage, "unpacked");
    // ditto, not a JavaScript unzip: it keeps the bundle's symlinks,
    // permissions and extended attributes, which the code signature covers.
    await run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
    fs.rmSync(zip, { force: true });
    const bundle = path.join(unpacked, manifest.MAC_APP_NAME);
    const plist = path.join(bundle, "Contents", "Info.plist");
    const read = (key) => run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
    const [id, bundleVersion] = await Promise.all([
      read("CFBundleIdentifier"),
      read("CFBundleShortVersionString"),
    ]);
    if (id.trim() !== manifest.BUNDLE_ID || bundleVersion.trim() !== version)
      throw new UpdateError("The download isn't the app version the release names, so it was thrown away.");
    // An ad-hoc signature says nothing about who built the app, but its
    // seal does say every file is the one that was signed.
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]).catch(() => {
      throw new UpdateError("The downloaded app's code signature doesn't check out, so it was thrown away.");
    });
    return bundle;
  }

  /**
   * Starts installing the downloaded update; the caller quits the app.
   * @param {{ relaunch: boolean, url?: string | null }} options `url`: the page to open again
   */
  function install({ relaunch, url = null }) {
    if (!ready || installing) return false;
    installing = true;
    writePending(pendingFile, { version: ready.version, url: relaunch && url && isAppURL(url) ? url : null });
    try {
      if (process.platform === "darwin") {
        const bundle = manifest.macBundlePath(process.execPath);
        if (!bundle || !ready.bundle) throw new Error("no bundle");
        launch("/bin/sh", [
          "-c",
          manifest.MAC_SWAP_SCRIPT,
          "sh",
          String(process.pid),
          bundle,
          ready.bundle,
          ready.stage,
          relaunch ? "1" : "0",
          app.commandLine.hasSwitch("user-data-dir") ? app.getPath("userData") : "",
        ]);
      } else {
        // --updated: an update, so the installer skips its pages and waits
        // for this process to exit (or ends it) before replacing files.
        launch(ready.file, ["--updated", "/S", ...(relaunch ? ["--force-run"] : [])]);
      }
    } catch {
      installing = false;
      fs.rmSync(pendingFile, { force: true });
      set({ state: "error", error: "The update couldn't be started. Download it from the release page." });
      return false;
    }
    set({ state: "installing" });
    return true;
  }

  /** Restart now to install: what the page's "Restart to update" does. */
  function restartToInstall() {
    const window = getWindow();
    const url = window && !window.isDestroyed() ? window.webContents.getURL() : null;
    if (!install({ relaunch: true, url })) return false;
    // After this event, so the page hears back before the window closes.
    setImmediate(() => app.quit());
    return true;
  }

  function schedule() {
    clearTimeout(timer ?? undefined);
    timer = null;
    if (!settings.autoCheck || !app.isPackaged) return;
    timer = setTimeout(function tick() {
      check();
      timer = setTimeout(tick, CHECK_EVERY_MS);
    }, FIRST_CHECK_MS);
  }

  // --- The app menu's Check for Updates…: native dialogs, which work with
  // no window open (macOS keeps running without one).

  async function checkFromMenu() {
    const result = await check({ byHand: true });
    const options = { title: "Software update", buttons: ["OK"] };
    if (result.state === "ready") {
      const { response } = await dialog.showMessageBox({
        ...options,
        message: `Connector Foundry ${result.latest} is ready to install.`,
        detail: "Restart now to update, or it installs the next time you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) restartToInstall();
    } else if (result.state === "available") {
      const { response } = await dialog.showMessageBox({
        ...options,
        message: `Connector Foundry ${result.latest} is available.`,
        detail: result.manual ?? "",
        buttons: ["Open the release page", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0 && result.releaseUrl) shell.openExternal(result.releaseUrl).catch(() => {});
    } else if (result.state === "up-to-date") {
      await dialog.showMessageBox({
        ...options,
        message: "Connector Foundry is up to date.",
        detail: `Version ${result.version} is the newest.`,
      });
    } else if (result.state === "error") {
      await dialog.showMessageBox({
        ...options,
        type: "warning",
        message: "Couldn't update.",
        detail: result.error ?? "",
      });
    }
  }

  // --- IPC: only from the app's own page in its own window ----------------

  /** @param {import("electron").IpcMainInvokeEvent} event */
  function fromApp(event) {
    const window = getWindow();
    return Boolean(window) && event.sender === window?.webContents && isAppURL(event.senderFrame?.url ?? "");
  }

  ipcMain.handle("updates:status", (event) => (fromApp(event) ? status() : null));
  ipcMain.handle("updates:check", (event) => (fromApp(event) ? check({ byHand: true }) : null));
  ipcMain.handle("updates:install", (event) => (fromApp(event) ? restartToInstall() : false));
  ipcMain.handle("updates:set-auto-check", (event, on) => {
    if (!fromApp(event)) return null;
    settings.autoCheck = on === true;
    saveSettings();
    schedule();
    broadcast();
    return status();
  });

  // A downloaded update installs when the app quits, as electron-updater's
  // do; a download still running is abandoned.
  app.on("will-quit", () => {
    clearTimeout(timer ?? undefined);
    abort?.abort();
    if (ready && !installing) install({ relaunch: false });
  });

  return {
    /** Starts the automatic checks, if they're on. */
    start() {
      // A launch that was the update itself: the folder held the files
      // that installed it. The Windows installer may still be finishing
      // when the app it started comes up, so later, and quietly.
      setTimeout(() => {
        if (!running && !ready) fs.rm(stageRoot, { recursive: true, force: true }, () => {});
      }, FIRST_CHECK_MS / 2).unref();
      schedule();
    },
    checkFromMenu,
    /** The page the window showed before it restarted to update, once. */
    takeRestoreURL() {
      const url = restoreURL;
      restoreURL = null;
      return url;
    },
  };
}

/**
 * Why this copy of the app can't replace itself, or null if it can.
 * @returns {string | null}
 */
function installProblem() {
  if (!app.isPackaged) return "This is a development build, which doesn't update itself.";
  if (process.platform === "darwin") {
    const bundle = manifest.macBundlePath(process.execPath);
    if (!bundle) return "The app isn't in an app bundle it could replace.";
    // Opened straight from the download, macOS runs it from a read-only
    // copy in a random folder (App Translocation); from the DMG, it's
    // read-only too.
    if (bundle.includes("/AppTranslocation/"))
      return "macOS is running the app from a temporary copy. Move Connector Foundry to the Applications folder and open it from there to let it update itself.";
    try {
      fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
      fs.accessSync(bundle, fs.constants.W_OK);
    } catch {
      return `The app can't replace itself in ${path.dirname(bundle)}. Move it to the Applications folder, or download the update and install it by hand.`;
    }
    return null;
  }
  if (process.platform === "win32") {
    // The installer puts its uninstaller beside the app; a copy unpacked
    // by hand has none, and the installer would update the copy in the
    // registry instead of this one.
    const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
    if (!fs.existsSync(uninstaller))
      return "This copy wasn't installed by the Connector Foundry installer, so it can't update itself.";
    return null;
  }
  return "The app updates itself on macOS and Windows only.";
}

/**
 * updates.json as stored, or the defaults: automatic checks on.
 * @param {string} file
 */
function readSettings(file) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Not there yet, or unreadable: the defaults.
  }
  return {
    autoCheck: raw?.autoCheck !== false,
    failed: typeof raw?.failed === "string" && manifest.VERSION.test(raw.failed) ? raw.failed : null,
  };
}

/**
 * pending-update.json, read once and removed: the version the last launch
 * quit to install, and the page it showed.
 * @param {string} file
 * @param {(url: string) => boolean} isAppURL
 * @returns {{ version: string, url: string | null } | null}
 */
function readPending(file, isAppURL) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
  if (typeof raw?.version !== "string" || !manifest.VERSION.test(raw.version)) return null;
  return { version: raw.version, url: typeof raw.url === "string" && isAppURL(raw.url) ? raw.url : null };
}

/**
 * @param {string} file
 * @param {{ version: string, url: string | null }} pending
 */
function writePending(file, pending) {
  try {
    fs.writeFileSync(file, JSON.stringify(pending));
  } catch {
    // The update still installs; the next launch just can't say so.
  }
}

/**
 * Starts a process that outlives the app. A failure to start shows only
 * as an 'error' event, after the app has begun quitting: the next launch
 * finds its version unchanged and says the update didn't install.
 * @param {string} command
 * @param {string[]} args
 */
function launch(command, args) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

/**
 * Runs a command and resolves its output.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    );
  });
}

/** @param {unknown} err */
function describe(err) {
  if (err instanceof UpdateError) return err.message;
  if (err instanceof Error && err.name === "AbortError") return "The download was stopped.";
  return `The update failed: ${err instanceof Error ? err.message : String(err)}`;
}

module.exports = { setupUpdates };
