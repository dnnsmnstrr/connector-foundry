import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

test('bundled desktop renders offline and imports/exports files through Chromium', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'foundry-desktop-'));
  let app;
  try {
    app = await electron.launch({
      ...(process.env.DESKTOP_EXECUTABLE ? { executablePath: process.env.DESKTOP_EXECUTABLE } : {}),
      args: [...(process.env.DESKTOP_EXECUTABLE ? [] : ['.']), `--user-data-dir=${directory}/profile`],
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The first render includes WASM engine startup; on slow CI VMs (Intel)
    // that outlasts expect's 5 s default, like the render waits below.
    await expect(page.getByRole('button', { name: 'Download STL', exact: true })).toBeVisible({ timeout: 90_000 });
    assert.equal(new URL(page.url()).protocol, 'foundry:');
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
    const doc = { format: 'connector-foundry/bench', version: 1,
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
    await page.getByRole('button', { name: 'Import STL…', exact: true }).click();
    const meshChooser = page.waitForEvent('filechooser');
    await page.locator('input[type=file][accept=".stl"]').click();
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
      const importedConfig = JSON.parse(await exportFile(page.getByRole('button', { name: 'Download config', exact: true })));
      assert.equal(importedConfig.imports.length, 1);
      assert.ok(importedConfig.imports[0].stl.length > 0);
    } else {
      assert.equal(process.env.DESKTOP_ALLOW_NO_WEBGL, '1', 'WebGL is unavailable; set DESKTOP_ALLOW_NO_WEBGL=1 only on GPU-less CI');
      await expect(page.getByRole('dialog').getByText('WebGL is unavailable')).toBeVisible();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ exportedSTLBytes: body.length, dimensions: [43, 31, 4], protocol: 'foundry:', sandbox: true, webgl }));
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
