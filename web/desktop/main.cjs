const { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { setupMcp } = require("./mcp.cjs");
const { APP_URL, assetPath, isAppURL } = require("./paths.cjs");
const { setupUpdates } = require("./updates.cjs");

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
// The header row's height. On Windows the window controls overlay is one
// pixel shorter, so the row's bottom border runs under the controls too.
const HEADER_HEIGHT = 52;
const OVERLAY_HEIGHT = HEADER_HEIGHT - 1;

app.setName("Connector Foundry");
// Windows groups taskbar buttons and pins by this id; electron-builder stamps
// the same appId into the Start menu shortcut it creates.
if (isWindows) app.setAppUserModelId("com.connectorfoundry.desktop");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "foundry",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
  },
]);

const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join("; ");
let window;
let lastExportDirectory;
// Coding agents' way in (mcp.cjs), off unless the user turned it on.
let mcp;
// Checking for, downloading and installing new releases (updates.cjs).
let updates;

function openExternal(url) {
  try {
    if (["https:", "http:"].includes(new URL(url).protocol)) {
      shell.openExternal(url).catch(() => {});
    }
  } catch {
    /* Ignore malformed links. */
  }
}

function createWindow() {
  window = new BrowserWindow({
    title: "Connector Foundry",
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#17181b",
    show: false,
    // The navigation row doubles as the title bar on both desktops. macOS
    // keeps its traffic lights on the left, Windows draws its minimise,
    // maximise and close buttons over the top-right corner; the stylesheet
    // reads the overlay bounds and keeps clear of whichever it finds.
    ...(isMac
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: true,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
    // A hidden title bar makes the window frameless on Windows, so it has
    // no menu bar; the application menu below only supplies the shortcuts.
    ...(isWindows
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: { color: "#17181b", symbolColor: "#e8e8ea", height: OVERLAY_HEIGHT },
        }
      : {}),
    // The preload is the page's only line to this process: the coding
    // agents' bridge and its Settings switch, and the updater's status and
    // buttons (preload.cjs).
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mcp?.watch(window);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppURL(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit")
      dialog.showErrorBox(
        "The app stopped responding",
        "Reopen Connector Foundry to continue. Save important benches as config files regularly.",
      );
  });
  window.on("closed", () => {
    window = null;
  });
  // Restarted to install an update, the window opens on the page it
  // showed, the bench in its address included.
  window
    .loadURL(updates?.takeRestoreURL() ?? APP_URL)
    .catch((error) => dialog.showErrorBox("Could not open Connector Foundry", error.message));
}

function focusWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

// Windows and Linux start a new process for every launch (a double-click on
// the shortcut, a second pin), where macOS activates the running app. Hand
// the second launch to the first instance, which is keyed by the profile
// directory so tests with their own --user-data-dir stay independent. Not on
// macOS: the development launcher and the installed app share a profile
// there, and `npm run desktop` must not quit because the app is open.
if (!isMac && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (!isMac) app.on("second-instance", focusWindow);
  app.whenReady().then(start);
}

function start() {
  // Packaged apps use CFBundleIconFile; the development Electron launcher
  // needs its Dock icon set explicitly.
  // The icon is generated, not committed, so a fresh checkout may not
  // have it yet — and setIcon() throws on a missing file, which would
  // abort start() before any window is created. A default Dock icon is
  // the right fallback for a development run.
  const devIcon = path.join(__dirname, "generated", "icon.png");
  if (!app.isPackaged && isMac && fs.existsSync(devIcon)) {
    app.dock.setIcon(devIcon);
  }
  // Stable private origin: no localhost server, network dependency, or file:// privileges.
  const root = path.join(__dirname, "..", "dist");
  protocol.handle("foundry", async (request) => {
    const file = assetPath(request.url, root);
    if (!file || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(file).href);
      response.headers.set("Content-Security-Policy", csp);
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  // Everything denied, except writing the clipboard from the app itself:
  // "Copy for Layerling" (src/lib/layerlingClipboard.js) needs it.
  const allowed = (permission, url) => permission === "clipboard-sanitized-write" && isAppURL(url);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowed(permission, details?.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    allowed(permission, requestingOrigin),
  );
  // Chromium streams the existing Blob exports to disk. No base64 conversion,
  // giant JSON IPC payload, or general-purpose filesystem bridge is needed.
  session.defaultSession.on("will-download", (event, item, contents) => {
    if (!contents || !isAppURL(contents.getURL()) || !item.getURL().startsWith("blob:foundry://app/")) {
      event.preventDefault();
      return;
    }
    const filename = path.basename(item.getFilename());
    const extension = path.extname(filename).slice(1);
    item.setSaveDialogOptions({
      title: "Export file",
      buttonLabel: "Export",
      defaultPath: path.join(lastExportDirectory || app.getPath("downloads"), filename),
      filters: [{ name: extension.toUpperCase() || "File", extensions: extension ? [extension] : ["*"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    item.once("done", (_event, state) => {
      if (state === "completed") lastExportDirectory = path.dirname(item.getSavePath());
      else if (state !== "cancelled")
        dialog.showErrorBox(
          "Export failed",
          "The file could not be saved. Check the destination and available disk space, then try again.",
        );
    });
  });
  updates = setupUpdates({ getWindow: () => window ?? null, isAppURL });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      // The standard app menu, with Check for Updates… where Mac apps keep it.
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" },
                { label: "Check for Updates…", click: () => updates.checkFromMenu() },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "File",
        submenu: [{ role: "close" }, ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }])],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" }] : []),
        ],
      },
      { role: "windowMenu" },
    ]),
  );
  mcp = setupMcp({
    getWindow: () => window ?? null,
    // An agent's call with no window open (closed on macOS) opens one.
    openWindow: () => {
      if (!window) createWindow();
      return window;
    },
    isAppURL,
  });
  createWindow();
  mcp.start();
  updates.start();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
