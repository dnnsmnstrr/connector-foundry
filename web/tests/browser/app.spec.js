import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const cube = new STLExporter().parse(new Mesh(new BoxGeometry(10, 10, 4)), { binary: true });
const cubeBytes = [...new Uint8Array(cube.buffer, cube.byteOffset, cube.byteLength)];
const parts = [
  { id: "basics/plate", name: "Flat plate", system: "Basics", confidence: "exact", file: "parts/basics/plate.scad", module: "basics_plate", defaults: { w: 40, d: 40, t: 4, r: 3 }, anchors: ["bot"] },
  { id: "basics/post", name: "Round post", system: "Basics", confidence: "exact", file: "parts/basics/post.scad", module: "basics_post", defaults: { d: 12, h: 20 }, anchors: ["bot"] },
];

async function catalogue(page) {
  // Use real catalogue-shaped records and real SCAD sources; keep the
  // picker small so these tests aren't tied to its catalogue ordering.
  await page.route("**/catalogue.yaml", (route) => route.fulfill({ json: { parts } }));
}

async function mockWorker(page, auto = false) {
  await page.addInitScript(({ bytes, auto }) => {
    window.__renders = {
      auto, jobs: [],
      finish(index, error) {
        const job = this.jobs[index];
        job.worker.onmessage({ data: error
          ? { id: job.request.id, type: "error", message: error }
          : { id: job.request.id, type: "result", stl: new Uint8Array(bytes).buffer } });
      },
    };
    window.Worker = class {
      terminated = false;
      postMessage(request) {
        const index = window.__renders.jobs.push({ request, worker: this }) - 1;
        if (window.__renders.auto) queueMicrotask(() => window.__renders.finish(index));
      }
      terminate() { this.terminated = true; }
    };
  }, { bytes: cubeBytes, auto });
}

const jobCount = (page) => page.evaluate(() => window.__renders.jobs.length);
const finish = (page, index, error) => page.evaluate(({ index, error }) => window.__renders.finish(index, error), { index, error });
async function downloadBytes(download) { return readFile(await download.path()); }
async function importConfig(page, config) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import config…", exact: true }).click();
  await (await chooser).setFiles({ name: "test.bench.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(config)) });
}
// Named, so exports start at once: a bench without a name asks for one
// before its first export, and these tests wait on the download instead.
const config = (root = { partId: "basics/plate", params: { w: 40, d: 40, t: 4, r: 3 } }) => ({
  format: "connector-foundry/bench", version: 1, name: "bench", root, nodes: [], imports: [],
});

for (const [platform, width] of [['mac', 1280], ['mac', 640], ['win', 1280], ['win', 640]]) {
  test(`${platform} desktop panes scroll independently at ${width}px without moving the header`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    // Also exercise the CSS width reached by zooming a native window: it must
    // keep independent panes instead of switching into the mobile layout,
    // on either desktop (main.jsx adds these classes under foundry://).
    await page.addInitScript((platform) => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('desktop', `desktop-${platform}`)), platform);
    await mockWorker(page, true);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(new RegExp(`desktop-${platform}`));
    // openGrid's Board; Skådis has a Board too.
    const openGrid = page.locator('.system-group').filter({ has: page.getByRole('heading', { name: 'openGrid', exact: true }) });
    await openGrid.getByRole('button', { name: 'Board exact', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Download STL', exact: true })).toBeEnabled();
    const sidebar = page.locator('.sidebar');
    const params = page.locator('.params-panel');
    const header = page.locator('.mode-tabs');
    const headerBefore = await header.boundingBox();
    const viewerBefore = await page.locator('.viewer-panel').boundingBox();
    await sidebar.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => sidebar.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const sidebarTop = await sidebar.evaluate(el => el.scrollTop);
    expect(await params.evaluate(el => el.scrollTop)).toBe(0);
    await params.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => params.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await sidebar.evaluate(el => el.scrollTop)).toBe(sidebarTop);
    expect(await header.boundingBox()).toEqual(headerBefore);
    expect(await page.locator('.viewer-panel').boundingBox()).toEqual(viewerBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(600);

    await page.getByTitle('Bench (2)').click();
    await page.locator('.bench-empty').hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.locator('.bench-empty').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await header.boundingBox()).toEqual(headerBefore);
    await importConfig(page, config());
    await sidebar.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => sidebar.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await header.boundingBox()).toEqual(headerBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}

test("header links to the source in a new tab", async ({ page }) => {
  await catalogue(page);
  await page.goto("/");
  const source = page.getByRole("link", { name: "GitHub", exact: true });
  await expect(source).toHaveAttribute("href", "https://github.com/dnnsmnstrr/connector-foundry");
  await expect(source).toHaveAttribute("target", "_blank");
});

test("the sidebar's edge resizes it, within limits, and the width sticks", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page, true);
  await page.goto("/");
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const sidebarWidth = () => page.locator("aside.sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  // A loaded page first: under a busy parallel run the app can take
  // longer than a poll's 5s to come up, which would read as a wrong width.
  const loaded = () => expect(handle).toBeVisible({ timeout: 20_000 });
  await loaded();
  await expect.poll(sidebarWidth).toBe(280);

  // Keyboard: 16px a step, 64 with Shift; Home and End are the limits.
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(sidebarWidth).toBe(296);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(sidebarWidth).toBe(232);
  await page.keyboard.press("Home");
  await expect.poll(sidebarWidth).toBe(220);
  await page.keyboard.press("End");
  // The widest is 640px, or 60% of the window when that is less.
  await expect.poll(sidebarWidth).toBe(Math.min(640, Math.round(1280 * 0.6)));

  // A drag moves it by the distance dragged.
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(sidebarWidth).toBe(340);
  // Stored on release (not on every move of the drag).
  await expect.poll(() => page.evaluate(() => localStorage.getItem("connector-foundry.sidebarWidth"))).toBe("340");

  // It is kept, and the same column in every mode.
  await page.reload();
  await loaded();
  await expect.poll(sidebarWidth).toBe(340);
  await page.keyboard.press("3");
  await expect(page.getByRole("heading", { name: "Drill screw holes" })).toBeVisible();
  // The Holes start screen focuses its search box, so click back.
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Library/ }).click();
  await expect.poll(sidebarWidth).toBe(340);

  // A double-click puts the default back.
  await handle.dblclick();
  await expect.poll(sidebarWidth).toBe(280);
  expect(await page.evaluate(() => localStorage.getItem("connector-foundry.sidebarWidth"))).toBeNull();
});

test("selection changes and failed renders cannot download a previous part", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/");
  await expect.poll(() => jobCount(page)).toBe(1);
  await finish(page, 0);
  const download = page.getByRole("button", { name: "Download STL", exact: true });
  await expect(download).toBeEnabled();
  await page.getByRole("button", { name: "Round post exact", exact: true }).click();
  await expect(download).toBeDisabled();
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1, "Deliberate render failure");
  await expect(page.getByRole("alert")).toHaveText("Deliberate render failure");
  await expect(download).toBeDisabled();
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(3);
  await finish(page, 2);
  await expect(download).toBeEnabled();
  const saved = page.waitForEvent("download");
  await download.click();
  expect((await saved).suggestedFilename()).toBe("basics_post.stl");
});

test("parameter edits re-render on their own and cancel obsolete previews", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/");
  await expect.poll(() => jobCount(page)).toBe(1);
  await finish(page, 0);
  const download = page.getByRole("button", { name: "Download STL", exact: true });
  await expect(download).toBeEnabled();
  // An edit starts a render by itself (once the edits pause), with no
  // Render click and no "out of date" note; until it lands, no download.
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("50");
  await expect(download).toBeDisabled();
  await expect(page.getByText(/out of date/)).toHaveCount(0);
  await expect.poll(() => jobCount(page)).toBe(2);
  // Another edit while it runs cancels it and queues the new values.
  await page.getByRole("spinbutton", { name: /w/ }).first().fill("60");
  expect(await page.evaluate(() => window.__renders.jobs[1].worker.terminated)).toBe(true);
  await finish(page, 1); // a late message from the terminated worker
  await expect(download).toBeDisabled();
  await expect.poll(() => jobCount(page)).toBe(3);
  await finish(page, 2);
  await expect(download).toBeEnabled();
  // Quick successive edits are one render, not one per keystroke.
  const field = page.getByRole("spinbutton", { name: /w/ }).first();
  await field.fill("6");
  await field.fill("61");
  await field.fill("612");
  await expect.poll(() => jobCount(page)).toBe(4);
  await page.waitForTimeout(800);
  expect(await jobCount(page)).toBe(4);
  // Going back to values already rendered shows the cached result at once.
  await field.fill("60");
  await expect(download).toBeEnabled();
  expect(await jobCount(page)).toBe(4);
});

test("worker failure and user cancellation allow another render", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/");
  await expect.poll(() => jobCount(page)).toBe(1);
  await page.evaluate(() => window.__renders.jobs[0].worker.onerror({ message: "test crash" }));
  await expect(page.getByRole("alert")).toContainText("worker failed: test crash");
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(2);
  await page.getByRole("button", { name: "Cancel renders", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel renders", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(3);
  await finish(page, 2);
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
});

test("printer settings invalidate downloads and refresh the preview", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/");
  await expect.poll(() => jobCount(page)).toBe(1);
  await finish(page, 0);
  const download = page.getByRole("button", { name: "Download STL", exact: true });
  await expect(download).toBeEnabled();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Fit clearance (mm)", exact: true }).fill("0.3");
  await expect.poll(() => jobCount(page)).toBe(2);
  expect(await page.evaluate(() => window.__renders.jobs[1].request.globalOverrides.FIT_CLEARANCE)).toBe(0.3);

  // Circle detail rides the same layer: picking "fine" re-renders with
  // it (cancelling the render still running); picking "normal" again
  // clears the override, since it is the default, and renders without it.
  const detail = page.getByRole("combobox", { name: "Circle detail" });
  await expect(detail).toHaveValue("normal");
  await detail.selectOption("fine");
  await expect.poll(() => jobCount(page)).toBe(3);
  expect(await page.evaluate(() => window.__renders.jobs[2].request.globalOverrides)).toEqual({ FIT_CLEARANCE: 0.3, CIRCLE_DETAIL: "fine" });
  await detail.selectOption("normal");
  await expect.poll(() => jobCount(page)).toBe(4);
  expect(await page.evaluate(() => window.__renders.jobs[3].request.globalOverrides)).toEqual({ FIT_CLEARANCE: 0.3 });
  expect(await page.evaluate(() => Object.values(localStorage).some((v) => v.includes("CIRCLE_DETAIL")))).toBe(false);

  await page.keyboard.press("Escape");
  await expect(download).toBeDisabled();
  await finish(page, 3);
  await expect(download).toBeEnabled();
});

test("Bench edits keep explicit exports while discarding the obsolete preview", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/#mode=bench");
  await importConfig(page, config());
  await expect.poll(() => jobCount(page)).toBe(1); // root extents
  await finish(page, 0);
  await expect.poll(() => jobCount(page)).toBe(2); // assembly preview
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "STL: root", exact: true }).click();
  await page.getByText("Root parameters", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("50");
  await expect.poll(() => jobCount(page)).toBe(3); // export survives the edit
  expect(await page.evaluate(() => window.__renders.jobs[1].worker.terminated)).toBe(true);
  expect(await page.evaluate(() => window.__renders.jobs[2].request.part)).toBe("root");
  expect(await page.evaluate(() => window.__renders.jobs[2].request.scadSource)).toContain("w=40");
  await finish(page, 2);
  expect((await exported).suggestedFilename()).toBe("bench_root.stl");
  await expect.poll(() => jobCount(page)).toBe(4); // current extents
  expect(await page.evaluate(() => window.__renders.jobs[3].request.params.w)).toBe(50);
  await finish(page, 3);
  await expect.poll(() => jobCount(page)).toBe(5); // current assembly
  expect(await page.evaluate(() => window.__renders.jobs[4].request.scadSource)).toContain("w=50");
  await finish(page, 4);
  await expect(page.getByRole("button", { name: "Cancel renders", exact: true })).toHaveCount(0);
});

test("Bench state survives mode switches and URL reload", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Open in Bench", exact: true }).click();
  // The name is bench state too; set, it also lets the export below start
  // without the name prompt a fresh bench shows first.
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("kept");
  await page.getByText("Root parameters", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("57");
  await expect(page).toHaveURL(/bench=/);
  await page.getByTitle("Library (1)").click();
  await page.getByTitle("Bench (2)").click();
  await page.getByText("Root parameters", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: /w/ }).first()).toHaveValue("57");
  // Read the config after reload too, so a stale URL mirror cannot hide
  // behind the still-live session store.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("kept");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download config", exact: true }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("kept.bench.json");
  const doc = JSON.parse((await downloadBytes(download)).toString());
  expect(doc.root.params.w).toBe(57);
  expect(doc.name).toBe("kept");
});

test("embedded imported meshes survive config export and reload", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page, true);
  await page.goto("/#mode=bench");
  const doc = config({ partId: "imported:test", params: {} });
  doc.imports = [{ id: "imported:test", name: "test cube", anchors: [{ name: "mount", point: [0, 0, 2], normal: [0, 0, 1] }], stl: Buffer.from(cubeBytes).toString("base64") }];
  await importConfig(page, doc);
  await expect(page).toHaveURL(/bench=/);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download config", exact: true }).click();
  const exported = JSON.parse((await downloadBytes(await saved)).toString());
  expect(exported.imports).toHaveLength(1);
  expect(exported.imports[0].anchors).toEqual(doc.imports[0].anchors);
  await page.reload();
  await expect(page.getByRole("button", { name: "Download config", exact: true })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await importConfig(page, exported);
  const again = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download config", exact: true }).click();
  const restored = JSON.parse((await downloadBytes(await again)).toString());
  expect(restored.imports[0].stl).toBe(exported.imports[0].stl);
});

test("real WASM renders Library and generated Bench assembly to the expected dimensions", async ({ page }) => {
  test.setTimeout(120_000);
  await catalogue(page);
  await page.goto("/");
  const libraryDownload = page.getByRole("button", { name: "Download STL", exact: true });
  await expect(libraryDownload).toBeEnabled({ timeout: 90_000 });
  const first = page.waitForEvent("download");
  await libraryDownload.click();
  expect(extents(await downloadBytes(await first))).toEqual([40, 40, 4]);
  await page.getByTitle("Bench (2)").click();
  page.on("dialog", (dialog) => dialog.accept());
  const doc = config();
  doc.nodes.push({ id: "child", parentId: "root", partId: "basics/plate", params: { w: 10, d: 10, t: 6, r: 0 }, slotName: "mount", joint: "fused", overlap: 0, spin: 0 });
  await importConfig(page, doc);
  const exported = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "STL: root", exact: true }).click();
  expect(extents(await downloadBytes(await exported))).toEqual([40, 40, 10]);
});

// The two STEP tests run the real workers: mockWorker() replaces
// window.Worker wholesale, which would swallow the STEP reader too.
test("a STEP file is tessellated in the browser and offered for slot placement", async ({ page }) => {
  test.setTimeout(120_000);
  await catalogue(page);
  await page.goto("/");
  await page.getByTitle("Bench (2)").click();
  await page.getByRole("button", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator('input[type=file][accept=".stl,.step,.stp,.3mf"]').click();
  // occt-import-js ships a 10 x 10 x 10 mm rounded cube as a test fixture.
  const fixture = fileURLToPath(new URL("../../node_modules/occt-import-js/test/testfiles/rounded-cube/rounded-cube.step", import.meta.url));
  await (await chooser).setFiles(fixture);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible({ timeout: 90_000 });
  const usePart = dialog.getByRole("button", { name: "Use as base part", exact: true });
  await expect(usePart).toBeVisible();
  await expect(usePart).toBeDisabled();
  // Placing a slot needs a WebGL click on the preview; headless Chromium
  // has SwiftShader, so this part runs wherever that holds.
  if (await page.evaluate(() => !!document.createElement("canvas").getContext("webgl"))) {
    await dialog.locator("canvas").click();
    await expect(usePart).toBeEnabled();
    await usePart.click();
    // An unnamed bench asks for a name before its first export.
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("cube");
    const exported = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download config", exact: true }).click();
    const config = JSON.parse((await downloadBytes(await exported)).toString());
    expect(config.imports).toHaveLength(1);
    expect(config.imports[0].name).toBe("rounded-cube.step");
    expect(extents(Buffer.from(config.imports[0].stl, "base64"))).toEqual([10, 10, 10]);
  }
});

test("a multi-body STEP file asks which body to import", async ({ page }) => {
  test.setTimeout(120_000);
  await catalogue(page);
  await page.goto("/");
  await page.getByTitle("Bench (2)").click();
  await page.getByRole("button", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator('input[type=file][accept=".stl,.step,.stp,.3mf"]').click();
  const fixture = fileURLToPath(new URL("../../node_modules/occt-import-js/test/testfiles/cax-if/as1_pe_203.stp", import.meta.url));
  await (await chooser).setFiles(fixture);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("This file holds 18 bodies.")).toBeVisible({ timeout: 90_000 });
  await dialog.getByLabel("SOLID (1)", { exact: true }).check();
  await dialog.getByRole("button", { name: "Use SOLID (1)", exact: true }).click();
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use as base part", exact: true })).toBeVisible();
});

function extents(bytes) {
  const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [max.x - min.x, max.y - min.y, max.z - min.z].map((n) => Math.round(n * 100) / 100);
}
