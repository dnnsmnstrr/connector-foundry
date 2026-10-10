import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// DESKTOP_EXECUTABLE selects a packaged build instead of the development
// launcher. It may be relative to web/, which is what CI passes.
const executable = process.env.DESKTOP_EXECUTABLE ? path.resolve(process.env.DESKTOP_EXECUTABLE) : null;
// Screenshots of the real window, kept as CI artifacts, are the only look
// at a platform's title bar this repository's maintainer may ever get.
const screenshots = fileURLToPath(new URL(`../../test-results/desktop/${process.platform}-${process.arch}/`, import.meta.url));

test('bundled desktop renders offline and imports/exports files through Chromium', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'foundry-desktop-'));
  await mkdir(screenshots, { recursive: true });
  let app;
  try {
    app = await electron.launch({
      ...(executable ? { executablePath: executable } : {}),
      args: [...(executable ? [] : ['.']), `--user-data-dir=${path.join(directory, 'profile')}`],
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The first render includes WASM engine startup; on slow CI VMs (Intel)
    // that outlasts expect's 5 s default, like the render waits below.
    await expect(page.getByRole('button', { name: 'Download STL', exact: true })).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: path.join(screenshots, 'library.png') });
    assert.equal(new URL(page.url()).protocol, 'foundry:');
    // "Copy for Layerling" reaches the system clipboard: the one permission
    // main.cjs grants the app. Read back from the main process.
    await page.getByRole('button', { name: 'Copy for Layerling' }).click();
    await expect(page.getByRole('button', { name: 'Copied — paste in Layerling' })).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.ok(copied.startsWith('LAYERLING/1\n'), copied.slice(0, 40));
    assert.equal(JSON.parse(copied.slice('LAYERLING/1\n'.length)).shapes[0].kind, 'mesh');
    // The window is titled like the app, and the header row doubles as its
    // title bar on both desktops: the stylesheet picks the platform's class
    // and keeps the row clear of the native window controls Electron
    // overlays, whose bounds the renderer can read back.
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Connector Foundry');
    const shell = await page.evaluate(() => {
      const header = document.querySelector('.mode-tabs');
      const style = getComputedStyle(header);
      const overlay = navigator.windowControlsOverlay;
      const rect = overlay?.visible ? overlay.getTitlebarAreaRect() : null;
      return {
        classes: [...document.documentElement.classList].sort(),
        header: header.getBoundingClientRect().toJSON(),
        paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight),
        width: window.innerWidth,
        overlay: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
    const platformClass = { darwin: 'desktop-mac', win32: 'desktop-win' }[process.platform];
    assert.deepEqual(shell.classes, ['desktop', ...(platformClass ? [platformClass] : [])]);
    if (platformClass) {
      assert.ok(shell.overlay, `window controls overlay is active: ${JSON.stringify(shell)}`);
      assert.ok(shell.header.height >= shell.overlay.height, `header covers the title bar height: ${JSON.stringify(shell)}`);
      // Whatever the overlay leaves of the row's width is where the controls
      // are; the padding must reach past them on that side.
      const controls = shell.width - shell.overlay.width;
      assert.ok(controls > 0, `window controls take some width: ${JSON.stringify(shell)}`);
      if (process.platform === 'darwin') assert.ok(shell.paddingLeft >= shell.overlay.x, `header starts after the traffic lights: ${JSON.stringify(shell)}`);
      else assert.ok(shell.paddingRight >= controls, `header ends before the window controls: ${JSON.stringify(shell)}`);
    }
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegration, false);
    await app.evaluate(({ session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    });
    // Only the test chooses a path automatically; production uses the native
    // Save dialog. Exercise the actual DownloadItem and disk write unchanged.
    await app.evaluate(({ session }, directory) => {
      globalThis.saved = [];
      session.defaultSession.on('will-download', (_event, item) => {
        const options = item.getSaveDialogOptions();
        item.setSavePath(`${directory}/${item.getFilename()}`);
        item.once('done', (_event, state) => globalThis.saved.push({ state, path: item.getSavePath(), options }));
      });
    }, directory);
    async function exportFile(button) {
      const count = await app.evaluate(() => globalThis.saved.length);
      await button.click();
      await expect.poll(() => app.evaluate(() => globalThis.saved.length), { timeout: 90_000 }).toBe(count + 1);
      const result = await app.evaluate(() => globalThis.saved.at(-1));
      assert.equal(result.state, 'completed');
      assert.equal(result.options.buttonLabel, 'Export');
      return readFile(result.path);
    }
    await page.getByRole('button', { name: 'Flat plate exact', exact: true }).click();
    const download = page.getByRole('button', { name: 'Download STL', exact: true });
    await expect(download).toBeEnabled({ timeout: 90_000 });
    const stl = await exportFile(download);
    const geometry = new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength));
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.z > geometry.boundingBox.min.z);
    await page.getByTitle('Bench (2)').click();
    // Named, so exports start at once: an unnamed bench asks for a name first.
    const doc = { format: 'connector-foundry/bench', version: 1, name: 'test',
      root: { partId: 'basics/plate', params: { w: 43, d: 31, t: 4, r: 0 } }, nodes: [], imports: [] };
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import config…', exact: true }).click();
    await (await chooser).setFiles({ name: 'test.bench.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    const config = JSON.parse(await exportFile(page.getByRole('button', { name: 'Download config', exact: true })));
    assert.equal(config.root.params.w, 43);
    const body = await exportFile(page.getByRole('button', { name: 'STL: root', exact: true }));
    const benchGeometry = new STLLoader().parse(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    benchGeometry.computeBoundingBox();
    const { min, max } = benchGeometry.boundingBox;
    assert.deepEqual([max.x - min.x, max.y - min.y, max.z - min.z], [43, 31, 4]);
    const scad = await exportFile(page.getByRole('button', { name: /Download .scad/ }));
    assert.match(scad.toString(), /basics_plate/);
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await page.getByRole('button', { name: 'Import STL / STEP / 3MF…', exact: true }).click();
    const meshChooser = page.waitForEvent('filechooser');
    await page.locator('input[type=file][accept=".stl,.step,.stp,.3mf"]').click();
    await (await meshChooser).setFiles({ name: 'exported-plate.stl', mimeType: 'model/stl', buffer: body });
    const usePart = page.getByRole('button', { name: 'Use as base part', exact: true });
    await expect(usePart).toBeVisible();
    // Slots are placed by clicking the 3D preview. GPU-less CI VMs (the Intel
    // runners) have no WebGL, and Electron on macOS has no working software
    // fallback, so only there may the test stop at the viewer's notice.
    const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'));
    if (webgl) {
      await page.getByRole('dialog').locator('canvas').click();
      await expect(usePart).toBeEnabled();
      await usePart.click();
      // A fresh bench has no name yet and would ask for one before exporting.
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('imported plate');
      const importedConfig = JSON.parse(await exportFile(page.getByRole('button', { name: 'Download config', exact: true })));
      assert.equal(importedConfig.imports.length, 1);
      assert.ok(importedConfig.imports[0].stl.length > 0);
      // Exports are named after the bench, through the Save dialog's default.
      assert.equal(path.basename(await app.evaluate(() => globalThis.saved.at(-1).path)), 'imported-plate.bench.json');
    } else {
      assert.equal(process.env.DESKTOP_ALLOW_NO_WEBGL, '1', 'WebGL is unavailable; set DESKTOP_ALLOW_NO_WEBGL=1 only on GPU-less CI');
      await expect(page.getByRole('dialog').getByText('WebGL is unavailable')).toBeVisible();
    }
    await page.screenshot({ path: path.join(screenshots, 'bench-import.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ exportedSTLBytes: body.length, dimensions: [43, 31, 4], protocol: 'foundry:', sandbox: true, webgl, shell }));
  } finally {
    await app?.close();
    // Windows may still hold the profile's lock files for a moment after exit.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// The lock is only taken where a launch starts a new process (Windows,
// Linux); macOS activates the running app itself.
test('a second launch hands over to the running instance instead of opening another window', { timeout: 120_000, skip: process.platform === 'darwin' && 'macOS launches are single-instance already' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'foundry-desktop-'));
  const args = (extra) => [...(executable ? [] : ['.']), `--user-data-dir=${path.join(directory, 'profile')}`, ...extra];
  let first;
  let child;
  try {
    first = await electron.launch({ ...(executable ? { executablePath: executable } : {}), args: args([]) });
    await first.firstWindow();
    // The window shows once the page is ready; minimising it before that
    // is a no-op. Minimised, the handover has something visible to do.
    await expect.poll(() => first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), { timeout: 30_000 }).toBe(true);
    await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await expect.poll(() => first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    // The second process must quit on its own without ever showing a window.
    // Playwright would wait for one, so launch it as a plain child process.
    const { spawn } = await import('node:child_process');
    child = spawn(executable ?? (await import('electron')).default, args([]), { stdio: 'ignore', windowsHide: true });
    const exit = await Promise.race([
      new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('the second instance did not quit within 60 s')), 60_000).unref()),
    ]);
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    await expect.poll(() => first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
  } finally {
    if (child && child.exitCode === null) child.kill();
    await first?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
