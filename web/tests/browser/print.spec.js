import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// "Print with EasyPrint…" (components/PrintSheet.jsx): the sheet opens
// from each tab's button and from the palette, hands the file over — a
// download in Chromium, which refuses model files in its share sheet, or
// the share sheet where one takes them (stubbed here) — and opens
// EasyPrint with a tap of its own.

const cube = new STLExporter().parse(new Mesh(new BoxGeometry(10, 10, 4)), { binary: true });
const cubeBytes = [...new Uint8Array(cube.buffer, cube.byteOffset, cube.byteLength)];
const parts = [
  {
    id: "basics/plate",
    name: "Flat plate",
    system: "Basics",
    confidence: "exact",
    file: "parts/basics/plate.scad",
    module: "basics_plate",
    defaults: { w: 40, d: 40, t: 4, r: 3 },
    anchors: ["bot"],
  },
];

async function setUp(page) {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
  await page.addInitScript((bytes) => {
    window.Worker = class {
      postMessage(request) {
        if (request?.type === "warm") return;
        queueMicrotask(() =>
          this.onmessage({ data: { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer } }),
        );
      }
      terminate() {}
    };
    // What the sheet opens, without opening it.
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(url);
      return null;
    };
  }, cubeBytes);
}

// A share sheet that takes model files, as Safari's does: no
// userAgentData (the sign of Chromium's allowlist), and canShare/share
// that record what they were given.
async function safariShareSheet(page) {
  await page.addInitScript(() => {
    delete Navigator.prototype.userAgentData;
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      window.__shared.push(data.files.map((file) => ({ name: file.name, type: file.type, size: file.size })));
    };
  });
}

const sheet = (page) => page.getByRole("dialog", { name: "Print with EasyPrint" });

test("the Library's sheet downloads the STL where the share sheet refuses it, and opens EasyPrint", async ({
  page,
}) => {
  await setUp(page);
  await page.goto("/app/");
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Print…", exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expect(sheet(page)).toContainText("Upload model");

  const saved = page.waitForEvent("download");
  await sheet(page).getByRole("button", { name: "Download STL", exact: true }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("basics_plate.stl");
  expect((await readFile(await download.path())).length).toBe(cubeBytes.length);

  await sheet(page).getByRole("button", { name: "Open EasyPrint ↗" }).click();
  expect(await page.evaluate(() => window.__opened)).toEqual(["https://www.printables.com/slice"]);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
});

test("where the share sheet takes model files, the sheet shares the STL and a 3MF", async ({ page }) => {
  await setUp(page);
  await safariShareSheet(page);
  await page.goto("/app/");
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Print…", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Share STL…", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  expect(await page.evaluate(() => window.__shared[0])).toEqual([
    { name: "basics_plate.stl", type: "model/stl", size: cubeBytes.length },
  ]);

  await sheet(page).getByRole("button", { name: "3MF", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(2);
  const [threeMf] = await page.evaluate(() => window.__shared[1]);
  expect(threeMf.name).toBe("basics_plate.3mf");
  expect(threeMf.type).toBe("model/3mf");
  expect(threeMf.size).toBeGreaterThan(0);
});

test("the palette opens the sheet, and only the sheet", async ({ page }) => {
  await setUp(page);
  await page.goto("/app/");
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("combobox", { name: "Search commands" }).fill("print with easyprint");
  await page.keyboard.press("Enter");
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
});

test("the Bench's sheet has a file per body, named after the bench", async ({ page }) => {
  await setUp(page);
  await page.goto("/app/#mode=bench");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("option", { name: "Import config…", exact: true })
    .or(page.getByRole("button", { name: "Import config…", exact: true }))
    .click();
  await (
    await chooser
  ).setFiles({
    name: "test.bench.json",
    mimeType: "application/json",
    // Named, so the sheet opens at once rather than asking for a name.
    buffer: Buffer.from(
      JSON.stringify({
        format: "connector-foundry/bench",
        version: 1,
        name: "desk",
        root: { partId: "basics/plate", params: { w: 40, d: 40, t: 4, r: 3 } },
        nodes: [],
        imports: [],
      }),
    ),
  });
  await page.getByRole("button", { name: "Print with EasyPrint…", exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  const saved = page.waitForEvent("download");
  await sheet(page).getByRole("button", { name: "Download STL", exact: true }).click();
  expect((await saved).suggestedFilename()).toBe("desk_root.stl");
});

test("after a render fails with the old part still shown, Print… is off and the palette says why", async ({
  page,
}) => {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
  // The first render succeeds, every later one fails.
  await page.addInitScript((bytes) => {
    let renders = 0;
    window.Worker = class {
      postMessage(request) {
        if (request?.type === "warm") return;
        const first = renders++ === 0;
        queueMicrotask(() =>
          this.onmessage({
            data: first
              ? { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer }
              : { id: request.id, type: "error", message: "Assertion failed: too wide" },
          }),
        );
      }
      terminate() {}
    };
  }, cubeBytes);
  await page.goto("/app/");
  const print = page.getByRole("button", { name: "Print…", exact: true });
  await expect(print).toBeEnabled();
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("400");
  await expect(page.getByText("Assertion failed: too wide").first()).toBeVisible();
  await expect(print).toBeDisabled();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByRole("combobox", { name: "Search commands" }).fill("print with easyprint");
  await expect(page.getByRole("option", { name: /Print with EasyPrint/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
