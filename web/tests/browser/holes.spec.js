import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { make3mf } from "../fixtures/threeMf.js";

// The Holes tab against a mocked render worker (every render answers
// with a 10 x 10 x 4 mm box), the same arrangement app.spec.js uses —
// see its mockWorker() for the shape of window.__renders.
const cube = new STLExporter().parse(new Mesh(new BoxGeometry(10, 10, 4)), { binary: true });
const cubeBytes = [...new Uint8Array(cube.buffer, cube.byteOffset, cube.byteLength)];
const parts = [
  { id: "basics/plate", name: "Flat plate", system: "Basics", confidence: "exact", file: "parts/basics/plate.scad", module: "basics_plate", defaults: { w: 40, d: 40, t: 4, r: 3 }, anchors: ["bot"] },
];

async function catalogue(page) {
  await page.route("**/catalogue.yaml", (route) => route.fulfill({ json: { parts } }));
}

async function mockWorker(page) {
  await page.addInitScript(({ bytes }) => {
    window.__renders = { jobs: [] };
    window.Worker = class {
      postMessage(request) {
        window.__renders.jobs.push({ request });
        queueMicrotask(() => this.onmessage({ data: { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer } }));
      }
      terminate() {}
    };
  }, { bytes: cubeBytes });
}

const jobs = (page) => page.evaluate(() => window.__renders.jobs.map((j) => j.request));
const hasWebgl = (page) => page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));

test("the Holes tab opens on 3, takes a catalogue part, and exports the base as .scad", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/");
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/mode=holes/);
  await expect(page.getByRole("heading", { name: "Drill screw holes" })).toBeVisible();
  await page.getByRole("button", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  expect((await jobs(page))[0].module).toBe("basics_plate");
  await expect(page.getByText("Outside: W 10 × H 4 × D 10 mm")).toBeVisible();

  // The part's parameters are under a toggle; a change re-renders the base.
  await page.getByText("Part parameters", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("50");
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  expect((await jobs(page))[1].params.w).toBe(50);

  // The preset grid is there, M3 socket cap selected by default.
  await expect(page.getByRole("option", { name: /^M3 socket cap/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("option", { name: /^M4 countersunk/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Diameter (mm)" })).toHaveValue("4.5");
  await expect(page.getByRole("combobox", { name: "Head" })).toHaveValue("countersink");

  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .scad", exact: true }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("Flat-plate_holes.scad");
  const scad = (await readFile(await download.path())).toString();
  expect(scad).toContain("include <../parts/basics/plate.scad>");
  expect(scad).toContain("basics_plate(w=50, d=40, t=4, r=3);");
  expect(scad).not.toContain("difference");

  // The document survives a trip to another tab.
  await page.keyboard.press("1");
  await page.keyboard.press("3");
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
});

test("a click on a face drills a snapped hole and the render carries it", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/#mode=holes");
  await page.getByRole("button", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");

  // The camera looks at the box's center from above and to the side, so
  // the canvas center lands on its top face a little off that face's
  // center. Walk the pointer up the screen until the hint names the
  // face center as the snap point, then click there.
  const canvas = page.locator(".bench-viewer canvas");
  const box = await canvas.boundingBox();
  const hint = page.locator(".holes-snap-hint");
  let target = null;
  for (let dy = 0; dy <= 120 && !target; dy += 6) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2 - dy;
    await page.mouse.move(x, y);
    // The hint follows the hover through a state update; give it a beat.
    await page.waitForTimeout(50);
    if ((await hint.count()) && (await hint.textContent()).includes("face center")) target = { x, y };
  }
  expect(target, "a canvas point snapping to the face center").not.toBeNull();

  // Option held: the face's size and the snapped point's distances to
  // the edges appear as labels; released, they go.
  await page.keyboard.down("Alt");
  await expect(page.locator(".viewer-label", { hasText: "10.0 × 10.0 mm" })).toBeVisible();
  await expect(page.locator(".viewer-label", { hasText: /^5\.0 mm$/ })).toHaveCount(4);
  await page.keyboard.up("Alt");
  await expect(page.locator(".viewer-label")).toHaveCount(0);

  await page.mouse.click(target.x, target.y);
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
  const row = page.locator(".holes-row").first();
  await expect(row).toContainText("1. M3 socket cap");
  await expect(row).toContainText("[0.0, 0.0, 2.0]"); // snapped to the top face's center

  // The holed render goes through the worker as generated source.
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  const holed = (await jobs(page))[1];
  expect(holed.scadSource).toContain("difference()");
  expect(holed.scadSource).toContain("cylinder(d = 3.4");
  expect(holed.scadSource).toContain("cylinder(d = 6.1, h = 4)");

  // Editing the selected hole re-renders with the new spec.
  await page.getByRole("spinbutton", { name: "Diameter (mm)" }).fill("5");
  await expect.poll(async () => (await jobs(page)).length).toBe(3);
  expect((await jobs(page))[2].scadSource).toContain("cylinder(d = 5,");

  // The screw edited last is what the next hole gets.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Escape");
  // Move to a spot clear of hole 1's ring (a marker under the pointer
  // takes the click), let the hover report its snap, then click — as a
  // hand does.
  const second = { x: box.x + box.width / 2, y: box.y + box.height / 2 + 30 };
  await page.mouse.move(second.x, second.y);
  await expect(page.locator(".holes-snap-hint")).toContainText("Snap:");
  await page.mouse.click(second.x, second.y);
  await expect(page.locator(".holes-row")).toHaveCount(2);
  await expect.poll(async () => (await jobs(page)).length).toBe(4);
  expect((await jobs(page))[3].scadSource.match(/cylinder\(d = 5,/g)).toHaveLength(2);
  await page.locator(".holes-row").nth(1).getByRole("button", { name: "Remove hole 2" }).click();
  await page.locator(".holes-row-main").first().click();
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();

  // A connector slot is a kind of hole: picking the openConnect preset
  // turns the selected hole into one, with its own fields, cut by the
  // repo's own library in the generated source.
  await page.getByRole("option", { name: /^openConnect slot$/ }).click();
  await expect(page.getByRole("combobox", { name: "Lock nub" })).toHaveValue("left");
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("0");
  await expect(page.locator(".holes-row").first()).toContainText("1. openConnect slot");
  await expect.poll(async () => (await jobs(page)).length).toBe(5);
  const slotted = (await jobs(page))[4].scadSource;
  expect(slotted).toContain("use <../lib/openconnect.scad>");
  expect(slotted).toContain('oc_slot(lock = "left", side_clearance = 0.1, depth_clearance = 0.1, overshoot = 1);');
  expect(slotted).not.toContain("cylinder(");

  // Its direction turns with the same quarter-turn buttons as a Bench
  // part's rotation, wrapping round rather than going negative.
  await page.getByRole("button", { name: "Turn the slot 90° clockwise" }).click();
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("270");
  await expect(page.locator(".holes-row").first()).toContainText("turned 270°");
  await page.getByRole("button", { name: "Turn the slot 90° counter-clockwise" }).click();
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("0");

  // Delete removes it (once focus has left the field — in a field the
  // key edits the value); the view goes back to the plain base.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Delete");
  await expect(page.locator(".holes-row")).toHaveCount(0);
  await expect(page.getByText("None yet — click a face in the scene.")).toBeVisible();
});

test("an imported mesh is drilled through import() with its bytes mounted alongside", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/#mode=holes");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  await page.locator('input[type=file]').click();
  await (await chooser).setFiles({ name: "bracket.stl", mimeType: "model/stl", buffer: Buffer.from(cubeBytes) });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible();
  await dialog.getByRole("button", { name: "Use this mesh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "bracket.stl", exact: true })).toBeVisible();
  // No render for a mesh with no holes: the bytes are shown as they are.
  expect((await jobs(page)).length).toBe(0);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");

  await page.locator(".bench-viewer canvas").click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  const request = (await jobs(page))[0];
  expect(request.scadSource).toContain('import("imports/bracket.stl");');
  // A Map doesn't survive page.evaluate's serialisation; ask in the page.
  expect(await page.evaluate(() => [...window.__renders.jobs[0].request.importedFiles.keys()])).toEqual(["imports/bracket.stl"]);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .scad", exact: true }).click();
  expect((await saved).suggestedFilename()).toBe("bracket_holes.scad");
});

test("a 3MF is unpacked, scaled by its unit and grounded on the grid", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/#mode=holes");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  await page.locator('input[type=file]').click();
  // A 1 x 1 x 0.4 cm box, placed 5 cm off the origin by the build item.
  const bytes = make3mf({ unit: "centimeter", size: [1, 1, 0.4], name: "Lid", placements: [[1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 5, 2]] });
  await (await chooser).setFiles({ name: "lid.3mf", mimeType: "model/3mf", buffer: Buffer.from(bytes) });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Clean — watertight, single solid, no repairs needed.")).toBeVisible();
  await expect(dialog.getByText("lid.3mf: 10 × 10 × 4 mm.")).toBeVisible(); // centimetres → millimetres
  await dialog.getByRole("button", { name: "Use this mesh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "lid.3mf", exact: true })).toBeVisible();
  await expect(page.getByText("Outside: W 10 × H 4 × D 10 mm")).toBeVisible();
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");

  // Grounded: the build's 50 mm offset is gone, so a hole on the top face
  // sits at z = 4 within the 10 mm footprint around the origin.
  await page.locator(".bench-viewer canvas").click();
  const meta = await page.locator(".holes-row-meta").first().textContent();
  const [x, y, z] = meta.match(/\[(.*)\]/)[1].split(", ").map(Number);
  expect(Math.abs(x)).toBeLessThanOrEqual(5);
  expect(Math.abs(y)).toBeLessThanOrEqual(5);
  expect(z).toBe(4);

  // Flipping the mesh turns it over and takes the hole with it: it is now
  // on the underside, at z = 0, and the part is re-rendered.
  await page.getByText("Part parameters", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Flip upside down" }).check();
  await expect(page.locator(".holes-row-meta").first()).toContainText(", 0.0]");
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  await page.getByRole("checkbox", { name: "Flip upside down" }).uncheck();
  await expect(page.locator(".holes-row-meta").first()).toContainText(", 4.0]");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .scad", exact: true }).click();
  expect((await saved).suggestedFilename()).toBe("lid_holes.scad");
});
