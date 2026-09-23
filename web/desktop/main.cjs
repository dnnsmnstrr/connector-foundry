const { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_URL, assetPath, isAppURL } = require('./paths.cjs');

app.setName('Connector Foundry');
protocol.registerSchemesAsPrivileged([{
  scheme: 'foundry',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
}]);

const csp = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "worker-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-src 'none'",
].join('; ');
let window;
let lastExportDirectory;

function openExternal(url) {
  try {
    if (['https:', 'http:'].includes(new URL(url).protocol)) {
      shell.openExternal(url).catch(() => {});
    }
  } catch { /* Ignore malformed links. */ }
}

function createWindow() {
  window = new BrowserWindow({
    title: 'Connector Foundry', width: 1440, height: 960, minWidth: 800, minHeight: 600,
    backgroundColor: '#17181b', show: false,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: true,
      trafficLightPosition: { x: 16, y: 18 },
    } : {}),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppURL(url)) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') dialog.showErrorBox('The app stopped responding', 'Reopen Connector Foundry to continue. Save important benches as config files regularly.');
  });
  window.on('closed', () => { window = null; });
  window.loadURL(APP_URL).catch((error) => dialog.showErrorBox('Could not open Connector Foundry', error.message));
}

app.whenReady().then(() => {
  // Packaged apps use CFBundleIconFile; the development Electron launcher
  // needs its Dock icon set explicitly.
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'generated', 'icon.png'));
  }
  // Stable private origin: no localhost server, network dependency, or file:// privileges.
  const root = path.join(__dirname, '..', 'dist');
  protocol.handle('foundry', async (request) => {
    const file = assetPath(request.url, root);
    if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(file).href);
      response.headers.set('Content-Security-Policy', csp);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Chromium streams the existing Blob exports to disk. No base64 conversion,
  // giant JSON IPC payload, or general-purpose filesystem bridge is needed.
  session.defaultSession.on('will-download', (event, item, contents) => {
    if (!contents || !isAppURL(contents.getURL()) || !item.getURL().startsWith('blob:foundry://app/')) {
      event.preventDefault();
      return;
    }
    const filename = path.basename(item.getFilename());
    const extension = path.extname(filename).slice(1);
    item.setSaveDialogOptions({
      title: 'Export file', buttonLabel: 'Export',
      defaultPath: path.join(lastExportDirectory || app.getPath('downloads'), filename),
      filters: [{ name: extension.toUpperCase() || 'File', extensions: extension ? [extension] : ['*'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    item.once('done', (_event, state) => {
      if (state === 'completed') lastExportDirectory = path.dirname(item.getSavePath());
      else if (state !== 'cancelled') dialog.showErrorBox('Export failed', 'The file could not be saved. Check the destination and available disk space, then try again.');
    });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
