import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
const config = (root = { partId: "basics/plate", params: { w: 40, d: 40, t: 4, r: 3 } }) => ({
  format: "connector-foundry/bench", version: 1, root, nodes: [], imports: [],
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

test("parameter edits cancel obsolete previews and require a matching render", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/");
  await expect.poll(() => jobCount(page)).toBe(1);
  await finish(page, 0);
  const download = page.getByRole("button", { name: "Download STL", exact: true });
  await expect(download).toBeEnabled();
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("50");
  await expect(download).toBeDisabled();
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(2);
  await page.getByRole("spinbutton", { name: /w/ }).first().fill("60");
  expect(await page.evaluate(() => window.__renders.jobs[1].worker.terminated)).toBe(true);
  await finish(page, 1); // a late message from the terminated worker
  await expect(download).toBeDisabled();
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(3);
  await finish(page, 2);
  await expect(download).toBeEnabled();
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
  await page.getByRole("spinbutton", { name: "FIT_CLEARANCE (mm)", exact: true }).fill("0.3");
  await expect.poll(() => jobCount(page)).toBe(2);
  expect(await page.evaluate(() => window.__renders.jobs[1].request.globalOverrides.FIT_CLEARANCE)).toBe(0.3);
  await page.keyboard.press("Escape");
  await expect(download).toBeDisabled();
  await finish(page, 1);
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
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download config", exact: true }).click();
  const doc = JSON.parse((await downloadBytes(await saved)).toString());
  expect(doc.root.params.w).toBe(57);
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

function extents(bytes) {
  const geometry = new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [max.x - min.x, max.y - min.y, max.z - min.z].map((n) => Math.round(n * 100) / 100);
}
