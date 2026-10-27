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
  {
    id: "basics/plate",
    name: "Flat plate",
    system: "Basics",
    confidence: "exact",
    file: "parts/basics/plate.scad",
    module: "basics_plate",
    defaults: { w: 40, d: 40, t: 4, r: 3 },
    anchors: ["bot"],
    // As the real catalogue has it: the Library's handles. Holes resizes
    // holes, never the base, so nothing here may depend on it.
    resize: { x: { param: "w", min: 8 }, y: { param: "d", min: 8 }, z: { param: "t" } },
  },
];

async function catalogue(page) {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
}

// `failing`: a render whose source contains this text fails, as the
// worker reports a compile error (the way a size the WASM renderer can't
// cut would).
async function mockWorker(page, { failing = null, bytes = cubeBytes } = {}) {
  await page.addInitScript(
    ({ bytes, failing }) => {
      window.__renders = { jobs: [] };
      window.Worker = class {
        postMessage(request) {
          // A warm-up is not a job and gets no answer (see app.spec.js).
          if (request?.type === "warm") return;
          window.__renders.jobs.push({ request });
          const data =
            failing && request.scadSource?.includes(failing)
              ? { id: request.id, type: "error", message: "the mock refuses this one" }
              : { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer };
          queueMicrotask(() => this.onmessage({ data }));
        }
        terminate() {}
      };
    },
    { bytes, failing },
  );
}

// A 40 x 40 mm face, room for a system's next holes round its middle.
const slab = new STLExporter().parse(new Mesh(new BoxGeometry(40, 40, 4)), { binary: true });
const slabBytes = [...new Uint8Array(slab.buffer, slab.byteOffset, slab.byteLength)];

const jobs = (page) => page.evaluate(() => window.__renders.jobs.map((j) => j.request));
const hasWebgl = (page) => page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));

// Walk the pointer up the canvas from its center until the hint names the
// face center as the snap point (the camera looks at the box from above
// and to the side), then click there: a hole at [0, 0, 2], selected.
// Returns the spot clicked.
async function drillAtFaceCenter(page) {
  const box = await page.locator(".bench-viewer canvas").boundingBox();
  const hint = page.locator(".holes-snap-hint");
  let target = null;
  for (let dy = 0; dy <= 120 && !target; dy += 6) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2 - dy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(50);
    if ((await hint.count()) && (await hint.textContent()).includes("face center")) target = { x, y };
  }
  expect(target, "a canvas point snapping to the face center").not.toBeNull();
  await page.mouse.click(target.x, target.y);
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
  return target;
}

// Hover from (x, y) down the canvas until the hint names a snap, and
// return that spot. The guide face's snap dots stay up across a hole's
// render, and a dot under the pointer takes the hover (it lights up
// instead), so a fixed spot may be on one. A pointer that stays put gets
// no second pointermove, hence the nudge before each look.
async function hoverSnap(page, x, y) {
  const hint = page.locator(".holes-snap-hint");
  let spot = null;
  await expect(async () => {
    for (let dy = 0; dy <= 30 && !spot; dy += 5) {
      await page.mouse.move(x, y + dy - 2);
      await page.mouse.move(x, y + dy);
      await page.waitForTimeout(50);
      if ((await hint.count()) && (await hint.textContent()).includes("Snap:")) spot = { x, y: y + dy };
    }
    expect(spot, "a spot near the pointer with a snap hint").not.toBeNull();
  }).toPass();
  return spot;
}

// The first hole's position, from its row in the sidebar's list.
async function holePoint(page) {
  const meta = await page.locator(".holes-row-meta").first().textContent();
  return meta
    .match(/\[(.*)\]/)[1]
    .split(", ")
    .map(Number);
}

const handle = (page, id) => page.locator(`[data-handle-id="${id}"]`);
const center = (box) => [box.x + box.width / 2, box.y + box.height / 2];

// Where handle `id` is on screen, and a point `px` further out along the
// line from handle `away` to it — a pull outward, whichever way the camera
// turned the hole.
async function pull(page, id, away, px) {
  const near = center(await handle(page, id).boundingBox());
  const far = center(await handle(page, away).boundingBox());
  const len = Math.hypot(near[0] - far[0], near[1] - far[1]);
  return {
    from: near,
    to: [near[0] + ((near[0] - far[0]) / len) * px, near[1] + ((near[1] - far[1]) / len) * px],
  };
}

test("the Holes tab opens on 3, takes a catalogue part, and exports the base as .scad", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  // The shell's keys listen once the app is up; a press before that (a
  // busy machine running the suite in parallel) would go nowhere.
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/mode=holes/);
  await expect(page.getByRole("heading", { name: "Drill screw holes" })).toBeVisible();
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
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
  // Groups start closed, but for the one holding the preset in effect;
  // a heading opens its group, and it stays open.
  const countersunk = page.getByRole("button", { name: /^Countersunk \(ISO 10642\)/ });
  await expect(countersunk).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("option", { name: /^M4 countersunk/ })).toHaveCount(0);
  await countersunk.click();
  await expect(countersunk).toHaveAttribute("aria-expanded", "true");
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

test("the Library's Add Holes opens the part, with its parameters, in the Holes tab", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  await page.getByRole("spinbutton", { name: "w", exact: true }).fill("55");
  await page.getByRole("button", { name: "Add Holes", exact: true }).click();
  await expect(page).toHaveURL(/mode=holes/);
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await expect.poll(async () => (await jobs(page)).at(-1)?.params?.w).toBe(55);
  // An undo step named like every other.
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute(
    "title",
    /^Undo add holes /,
  );
  // Nothing drilled yet, so a second hand-over replaces the base without asking.
  let asked = false;
  page.on("dialog", (dialog) => {
    asked = true;
    dialog.dismiss();
  });
  await page.keyboard.press("1");
  await page.getByRole("button", { name: "Add Holes", exact: true }).click();
  await expect(page).toHaveURL(/mode=holes/);
  expect(asked).toBe(false);
});

test("a click on a face drills a snapped hole and the render carries it", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
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
  const second = await hoverSnap(page, box.x + box.width / 2, box.y + box.height / 2 + 30);
  await page.mouse.click(second.x, second.y);
  await expect(page.locator(".holes-row")).toHaveCount(2);
  await expect.poll(async () => (await jobs(page)).length).toBe(4);
  expect((await jobs(page))[3].scadSource.match(/cylinder\(d = 5,/g)).toHaveLength(2);

  // Several at once: Shift-click adds to the selection, the editor edits
  // what they share, and one Delete removes them all.
  const lastJob = async () => (await jobs(page)).at(-1);
  await page.locator(".holes-row-main").nth(0).click();
  await page
    .locator(".holes-row-main")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect(page.getByRole("heading", { name: "2 holes" })).toBeVisible();
  await expect(page.locator(".holes-row.is-selected")).toHaveCount(2);
  await expect(page.getByText("2 holes selected")).toBeVisible();
  const jobsBefore = (await jobs(page)).length;
  await page.getByRole("spinbutton", { name: "Diameter (mm)" }).fill("6");
  await expect.poll(async () => (await jobs(page)).length).toBeGreaterThan(jobsBefore);
  expect((await lastJob()).scadSource.match(/cylinder\(d = 6,/g)).toHaveLength(2);
  // Shift-click takes one back out; Select all puts it back, and has
  // nothing left to do once everything is selected.
  await page
    .locator(".holes-row-main")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
  const selectAll = page.getByRole("button", { name: "Select all" });
  await expect(selectAll).toBeEnabled();
  await selectAll.click();
  await expect(page.getByRole("button", { name: "Delete 2 holes" })).toBeVisible();
  await expect(selectAll).toBeDisabled();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Delete");
  await expect(page.locator(".holes-row")).toHaveCount(0);

  // Drill one again at the face center for what follows. The render
  // without holes replaced the mesh (and with it the hover), so come in
  // from beside the spot, as a hand does.
  await page.mouse.move(target.x + 12, target.y + 12);
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await expect(page.locator(".holes-snap-hint")).toContainText("face center");
  await page.mouse.click(target.x, target.y);
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();

  // A connector slot is a kind of hole: picking the openConnect preset
  // turns the selected hole into one, with its own fields, cut by the
  // repo's own library in the generated source.
  // Search finds it whichever group it is in, and opens that group.
  const search = page.getByRole("searchbox", { name: "Search hole types" });
  await search.fill("openconnect");
  await expect(page.getByRole("option", { name: /^openConnect slot/ })).toHaveCount(3);
  await expect(page.getByRole("option", { name: /^M3 socket cap/ })).toHaveCount(0);
  await page.getByRole("option", { name: /^openConnect slot$/ }).click();
  await search.fill("");
  await expect(page.getByRole("combobox", { name: "Lock nub" })).toHaveValue("left");
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("0");
  await expect(page.locator(".holes-row").first()).toContainText("1. openConnect slot");
  await expect.poll(async () => (await lastJob()).scadSource).toContain("oc_slot(");
  const slotted = (await lastJob()).scadSource;
  expect(slotted).toContain("use <../lib/openconnect.scad>");
  expect(slotted).toContain(
    'oc_slot(lock = "left", side_clearance = 0.1, depth_clearance = 0.1, overshoot = 1);',
  );
  expect(slotted).not.toContain("cylinder(");

  // Its direction turns with the same quarter-turn buttons as a Bench
  // part's rotation, wrapping round rather than going negative.
  await page.getByRole("button", { name: "Turn the slot 90° clockwise" }).click();
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("270");
  await expect(page.locator(".holes-row").first()).toContainText("turned 270°");
  // Another openConnect preset sets its own lock and keeps the rest: the
  // direction stays, and turning it isn't an edit of the preset.
  await page.getByRole("option", { name: "openConnect slot, lock both sides" }).click();
  await expect(page.getByRole("combobox", { name: "Lock nub" })).toHaveValue("both");
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("270");
  await expect(page.locator(".holes-row").first()).toContainText("1. openConnect slot, lock both sides");
  await expect(page.locator(".holes-row").first()).not.toContainText("(edited)");
  await page.getByRole("button", { name: "Turn the slot 90° counter-clockwise" }).click();
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveValue("0");

  // Delete removes it (once focus has left the field — in a field the
  // key edits the value); the view goes back to the plain base.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Delete");
  await expect(page.locator(".holes-row")).toHaveCount(0);
  await expect(page.getByText("None yet — click a face in the scene.")).toBeVisible();
});

test("a MagSafe pocket takes a charger puck with its cable channel, or a ring", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");
  await drillAtFaceCenter(page);
  const lastJob = async () => (await jobs(page)).at(-1);

  // The puck: its pocket, and a cable channel the way the arrow points.
  await page.getByRole("searchbox", { name: "Search hole types" }).fill("magsafe");
  await expect(page.locator(".holes-presets").getByRole("option")).toHaveCount(3);
  await page.getByRole("option", { name: /^MagSafe charger puck/ }).click();
  await expect(page.getByRole("combobox", { name: "Insert" })).toHaveValue("puck");
  await expect(page.getByRole("spinbutton", { name: "Cable channel (mm)" })).toHaveValue("5");
  await expect(page.getByRole("spinbutton", { name: "Inner diameter (mm)" })).toHaveCount(0);
  await expect(page.locator(".holes-row").first()).toContainText("1. MagSafe charger puck");
  await expect.poll(async () => (await lastJob()).scadSource).toContain("cylinder(d = 56.3, h = 6.5");
  expect((await lastJob()).scadSource).toContain("cube([5, 58.15, 6.5]);");
  // It turns, and turned it is still the preset.
  await page.getByRole("button", { name: "Turn the cable channel 90° clockwise" }).click();
  await expect(page.locator(".holes-row").first()).toContainText("turned 270°");
  await expect(page.locator(".holes-row").first()).not.toContainText("(edited)");

  // A ring instead: its own sizes come along, the middle stands, and
  // the channel and the direction go.
  await page.getByRole("combobox", { name: "Insert" }).selectOption("ring");
  await expect(page.getByRole("spinbutton", { name: "Inner diameter (mm)" })).toHaveValue("45.8");
  await expect(page.getByRole("spinbutton", { name: "Depth (mm)" })).toHaveValue("1.2");
  await expect(page.getByRole("spinbutton", { name: "Cable channel (mm)" })).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Direction (°)" })).toHaveCount(0);
  await expect.poll(async () => (await lastJob()).scadSource).toContain("cylinder(d = 45.8, h = 4.2");
  expect((await lastJob()).scadSource).not.toContain("cube(");
});

// A holed render with many more triangles than the plain base, so a
// guide face picked on it has an index the base doesn't have.
const detailed = new STLExporter().parse(new Mesh(new BoxGeometry(10, 10, 4, 20, 20, 1)), { binary: true });
const detailedBytes = [...new Uint8Array(detailed.buffer, detailed.byteOffset, detailed.byteLength)];

test("deleting a hole while the guide lines are on the holed mesh doesn't crash the tab", async ({
  page,
}) => {
  await catalogue(page);
  await page.addInitScript(
    ({ plain, holed }) => {
      window.__renders = { jobs: [] };
      window.Worker = class {
        postMessage(request) {
          // Not a job, as in mockWorker() above.
          if (request?.type === "warm") return;
          window.__renders.jobs.push({ request });
          const bytes = request.scadSource?.includes("difference()") ? holed : plain;
          queueMicrotask(() =>
            this.onmessage({ data: { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer } }),
          );
        }
        terminate() {}
      };
    },
    { plain: cubeBytes, holed: detailedBytes },
  );
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");

  const canvas = page.locator(".bench-viewer canvas");
  const box = await canvas.boundingBox();
  const hint = page.locator(".holes-snap-hint");
  let target = null;
  for (let dy = 0; dy <= 120 && !target; dy += 6) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2 - dy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(50);
    if ((await hint.count()) && (await hint.textContent()).includes("face center")) target = { x, y };
  }
  expect(target, "a canvas point snapping to the face center").not.toBeNull();
  await page.mouse.click(target.x, target.y);
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
  await expect.poll(async () => (await jobs(page)).length).toBe(2);

  // Rest on the holed mesh's top face long enough for its guide lines to
  // take over — a face whose triangles are numbered far past the plain
  // base's twelve. Clear of the new hole's move handle, which stands on
  // its centre (where the click snapped to, a few px from `target`): a
  // handle under the pointer takes the hover off the model.
  const move = await page.locator('[data-handle-id="h1:move"]').boundingBox();
  const rest = move ? [move.x + move.width * 3.5, move.y + move.height / 2] : [target.x + 4, target.y + 4];
  await page.mouse.move(rest[0] + 6, rest[1] + 6);
  await page.mouse.move(rest[0], rest[1], { steps: 3 });
  await expect(hint).toBeVisible();
  await page.waitForTimeout(500);

  // Delete it: the view goes back to the plain base, and the tab stays up.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Delete");
  await expect(page.locator(".holes-row")).toHaveCount(0);
  await expect(page.getByText("None yet — click a face in the scene.")).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  await expect(page.getByRole("heading", { name: "Holes", exact: true })).toBeVisible();
});

test("an imported mesh is drilled through import() with its bytes mounted alongside", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("option", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  await page.locator("input[type=file]").click();
  await (
    await chooser
  ).setFiles({ name: "bracket.stl", mimeType: "model/stl", buffer: Buffer.from(cubeBytes) });
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
  expect(await page.evaluate(() => [...window.__renders.jobs[0].request.importedFiles.keys()])).toEqual([
    "imports/bracket.stl",
  ]);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .scad", exact: true }).click();
  expect((await saved).suggestedFilename()).toBe("bracket_holes.scad");
});

test("a 3MF is unpacked, scaled by its unit and grounded on the grid", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("option", { name: "Import STL / STEP / 3MF…", exact: true }).click();
  await page.locator("input[type=file]").click();
  // A 1 x 1 x 0.4 cm box, placed 5 cm off the origin by the build item.
  const bytes = make3mf({
    unit: "centimeter",
    size: [1, 1, 0.4],
    name: "Lid",
    placements: [[1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 5, 2]],
  });
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
  const [x, y, z] = meta
    .match(/\[(.*)\]/)[1]
    .split(", ")
    .map(Number);
  expect(Math.abs(x)).toBeLessThanOrEqual(5);
  expect(Math.abs(y)).toBeLessThanOrEqual(5);
  expect(z).toBe(4);
  // The hole's render runs after a 250 ms debounce; flipping inside it
  // would fold both edits into one render, so let it start first.
  await expect.poll(async () => (await jobs(page)).length).toBe(1);

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

test("a rectangle's handles resize it from the opposite edge, with Alt from its center, and undo puts it back", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  const search = page.getByRole("searchbox", { name: "Search hole types" });
  await search.fill("rectangular");
  await page.getByRole("option", { name: /^Rectangular cutout/ }).click();
  await search.fill("");
  await drillAtFaceCenter(page);
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  expect(await holePoint(page)).toEqual([0, 0, 2]);
  const width = page.getByRole("spinbutton", { name: "Width (mm)" });
  const height = page.getByRole("spinbutton", { name: "Height (mm)" });
  await expect(width).toHaveValue("20");
  // Each edge is a slider of its own, prefixed with the hole's id; the
  // pill hangs below the hole, clear of them.
  await expect(page.getByRole("slider", { name: "Hole 1 width (right edge)" })).toBeVisible();
  await expect(page.locator(".viewer-handle")).toHaveCount(9);

  // The right edge pulled out: a ghost and a label while it moves, one
  // change on release. The left edge stays where it was, so the hole's
  // center moves by half the growth.
  let { from, to } = await pull(page, "h1:w+", "h1:w-", 60);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await expect(page.locator(".viewer-drag-label")).toHaveText(/^W [\d.]+ mm \(\+[\d.]+\)$/);
  expect((await jobs(page)).length).toBe(2);
  await page.mouse.up();
  const grown = Number(await width.inputValue());
  expect(grown).toBeGreaterThan(20);
  expect(grown % 0.5).toBe(0); // the default 0.5 mm grid
  const [x, y, z] = await holePoint(page);
  // (The list shows a tenth of a millimetre.)
  expect(x).toBe(Math.round(((grown - 20) / 2) * 10) / 10);
  expect([y, z]).toEqual([0, 2]);
  // Rendered once for the whole gesture, with the new size.
  await expect.poll(async () => (await jobs(page)).length).toBe(3);
  expect((await jobs(page))[2].scadSource).toContain(`square([${grown}, 10], center = true)`);
  await page.waitForTimeout(400);
  expect((await jobs(page)).length).toBe(3);

  // With Alt (Option) held the top edge grows about the center: the point
  // stays, and the Option-held measurements keep out of the drag's way.
  ({ from, to } = await pull(page, "h1:h+", "h1:h-", 40));
  const before = await holePoint(page);
  await page.keyboard.down("Alt");
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await expect(page.locator(".viewer-drag-label")).toHaveText(/^H [\d.]+ mm \(\+[\d.]+ each side\)$/);
  await expect(page.locator(".viewer-label")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(Number(await height.inputValue())).toBeGreaterThan(10);
  expect(await holePoint(page)).toEqual(before);

  // Undo takes each resize back in turn, the point with it.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("ControlOrMeta+z");
  await expect(height).toHaveValue("10");
  expect(await holePoint(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(width).toHaveValue("20");
  expect(await holePoint(page)).toEqual([0, 0, 2]);
  // Redo from the viewer's toolbar.
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(width).toHaveValue(String(grown));
  expect(errors).toEqual([]);
});

test("the center handle drags a hole across its face, never off it; the arrow keys nudge it", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  await drillAtFaceCenter(page);
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  // A screw is its hardware's size: it only moves.
  await expect(page.locator(".viewer-handle")).toHaveCount(1);
  const move = handle(page, "h1:move");
  await expect(move).toBeVisible();

  // A short drag: the hole follows in whole grid steps on its face.
  let at = center(await move.boundingBox());
  await page.mouse.move(...at);
  await page.mouse.down();
  await page.mouse.move(at[0] + 40, at[1] + 10, { steps: 8 });
  await expect(page.locator(".viewer-drag-label")).toHaveText(/mm (right|left|up|down)/);
  await page.mouse.up();
  const moved = await holePoint(page);
  expect(moved).not.toEqual([0, 0, 2]);
  expect(moved[2]).toBe(2);
  for (const v of moved.slice(0, 2)) expect(Math.abs(v % 0.5)).toBe(0);
  await expect.poll(async () => (await jobs(page)).length).toBe(3);
  expect((await jobs(page))[2].scadSource).toContain("difference()");

  // Far past the face's edge: refused, with a word why.
  at = center(await move.boundingBox());
  await page.mouse.move(...at);
  await page.mouse.down();
  await page.mouse.move(at[0] + 400, at[1], { steps: 10 });
  await expect(page.locator(".viewer-drag-label")).toHaveText("Off the face");
  await page.mouse.up();
  await expect(page.locator(".holes-notice")).toContainText("Off the face");
  expect(await holePoint(page)).toEqual(moved);

  // Undo puts it back where it was drilled.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => holePoint(page)).toEqual([0, 0, 2]);

  // The arrows nudge it one grid step along the face (its sideways is +X
  // and its up +Y on a face lying flat); Shift is ten steps. A run of
  // nudges is one undo step.
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => holePoint(page)).toEqual([0.5, 0, 2]);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => holePoint(page)).toEqual([0.5, 5, 2]);
  // A nudge that would take it off the 10 mm face is refused.
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".holes-notice")).toContainText("Not moved");
  expect(await holePoint(page)).toEqual([0.5, 5, 2]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => holePoint(page)).toEqual([0, 0, 2]);

  // "Pick another model" is a step too: the start picker offers it back.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Pick another model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drill screw holes" })).toBeVisible();
  await page.getByRole("option", { name: "Undo pick another model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  expect(await holePoint(page)).toEqual([0, 0, 2]);
  expect(errors).toEqual([]);
});

// The move handle stands on the hole's centre, where a click on the
// canvas picks the hole; a press on the handle that never becomes a drag
// must still be that click. Shift-clicking the only selected hole there
// takes it out of the selection, and drills nothing.
test("a click on the move handle is the click on the hole under it: Shift takes it out of the selection", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  // One hole only: a second one's ring can pass through this one's
  // centre (an M3 counterbore's is 3.55 mm round), and a click there,
  // on the canvas or the handle, picks the ring's hole.
  await drillAtFaceCenter(page);
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  const move = handle(page, "h1:move");
  await expect(move).toHaveAttribute("data-state", "shown");

  // A plain click on it: still that hole, and no second one drilled.
  await move.click();
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
  await expect(page.locator(".holes-row")).toHaveCount(1);

  // Shift: out of the selection, so its handles go — and nothing drilled
  // or rendered. The plain click made the top face the guide, so the
  // face centre's snap marker is under the handle now: Shift counts
  // there too.
  await move.click({ modifiers: ["Shift"] });
  await expect(page.locator(".holes-row.is-selected")).toHaveCount(0);
  await expect(page.locator(".viewer-handle")).toHaveCount(0);
  await expect(page.locator(".holes-row")).toHaveCount(1);
  expect((await jobs(page)).length).toBe(2);
  expect(errors).toEqual([]);
});

// The Library's handles' keyboard and size-box tests, for a hole: each
// edge resizes from the opposite one.
test("a hole's focused handle steps its size, a run of steps one undo step; a click types a size", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  const search = page.getByRole("searchbox", { name: "Search hole types" });
  await search.fill("rectangular");
  await page.getByRole("option", { name: /^Rectangular cutout/ }).click();
  await search.fill("");
  const faceCenter = await drillAtFaceCenter(page);
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  const width = page.locator(".holes-sidebar").getByRole("spinbutton", { name: "Width (mm)" });

  // Three steps of the 0.5 mm grid on the right edge: the left edge stays
  // at x = -10, the handle keeps the focus, and the run renders once.
  const right = page.getByRole("slider", { name: "Hole 1 width (right edge)" });
  await right.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(width).toHaveValue("21.5");
  expect(await holePoint(page)).toEqual([0.8, 0, 2]);
  await expect(right).toBeFocused();
  await expect.poll(async () => (await jobs(page)).length).toBe(3);
  await page.waitForTimeout(400);
  expect((await jobs(page)).length).toBe(3);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toHaveAttribute("title", /^Undo resize W/);
  // One undo takes the whole run back (the focused handle leaves Cmd/Ctrl+Z
  // to the tab).
  await page.keyboard.press("ControlOrMeta+z");
  await expect(width).toHaveValue("20");
  expect(await holePoint(page)).toEqual([0, 0, 2]);
  await expect(undo).toHaveAttribute("title", /^Undo drill a hole/);

  // Shift: ten steps, here in from the left edge; the right one stays at 10.
  await page.getByRole("slider", { name: "Hole 1 width (left edge)" }).focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(width).toHaveValue("15");
  expect(await holePoint(page)).toEqual([2.5, 0, 2]);

  // A click on the right edge opens the size box with its size; Enter sets
  // it exactly, from the left edge (x = -5), and gives the handle back its focus.
  await right.click();
  const size = page.locator(".viewer-handle-editor").getByRole("spinbutton");
  await expect(size).toBeFocused();
  await expect(size).toHaveValue("15");
  await size.fill("24");
  await page.keyboard.press("Enter");
  await expect(width).toHaveValue("24");
  expect(await holePoint(page)).toEqual([7, 0, 2]);
  await expect(size).toHaveCount(0);
  await expect(right).toBeFocused();

  // With the box open, a click on the model only closes it (committing
  // what was typed) — it never drills a hole there.
  await right.click();
  await size.fill("26");
  await page.mouse.click(faceCenter.x, faceCenter.y);
  await expect(size).toHaveCount(0);
  await expect(width).toHaveValue("26");
  await expect(page.locator(".holes-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a hole size that doesn't render offers its undo by the error", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page, { failing: "square([28, 10]" });
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  const search = page.getByRole("searchbox", { name: "Search hole types" });
  await search.fill("rectangular");
  await page.getByRole("option", { name: /^Rectangular cutout/ }).click();
  await search.fill("");
  await drillAtFaceCenter(page);
  const width = page.locator(".holes-sidebar").getByRole("spinbutton", { name: "Width (mm)" });

  await page.getByRole("slider", { name: "Hole 1 width (right edge)" }).click();
  await page.locator(".viewer-handle-editor").getByRole("spinbutton").fill("28");
  await page.keyboard.press("Enter");
  const error = page.getByRole("alert");
  await expect(error).toContainText("Couldn't render that change.");
  await expect(error).toContainText("the mock refuses this one");
  const undoResize = error.getByRole("button", { name: "Undo resize W" });
  await expect(undoResize).toBeVisible();
  // A rename leaves the failed holes as they are, but it is what Undo
  // would take back now: the error stops offering it, until the rename is
  // undone.
  await page.getByRole("textbox", { name: "Name" }).fill("lid");
  await expect(error).toContainText("the mock refuses this one");
  await expect(error.getByRole("button")).toHaveCount(0);
  await page.locator(".viewer-toolbar").getByRole("button", { name: "Undo", exact: true }).click();
  await undoResize.click();
  await expect(width).toHaveValue("20");
  // The 20 mm hole rendered before: back at once, error and all gone.
  await expect(error).toHaveCount(0);
});

test("an undone pick leaves its redo on the start picker", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("heading", { name: "Drill screw holes" })).toBeVisible();
  // Nothing before the pick to undo, but the pick to redo.
  await expect(page.getByRole("option", { name: /^Undo/ })).toHaveCount(0);
  await page.getByRole("option", { name: "Redo pick a model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flat plate", exact: true })).toBeVisible();
});

test("Cmd/Ctrl+Z on the start picker brings back the model Pick another model dropped", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  const plate = page.getByRole("heading", { name: "Flat plate", exact: true });
  const start = page.getByRole("heading", { name: "Drill screw holes" });
  await expect(plate).toBeVisible();
  await page.getByRole("button", { name: "Pick another model", exact: true }).click();
  await expect(start).toBeVisible();
  // The search box has the focus, with nothing of its own to undo: the
  // keys are the tab's, both ways, straight away.
  const search = page.getByRole("combobox", { name: "Search parts" });
  await expect(search).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(plate).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(start).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(plate).toBeVisible();

  // Typed into, the box keeps Cmd/Ctrl+Z for its own text.
  await page.getByRole("button", { name: "Pick another model", exact: true }).click();
  await expect(search).toBeFocused();
  await search.pressSequentially("plate");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  await expect(start).toBeVisible();
});

test("after a handle commit, typing a base parameter still waits for the typing to pause", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  await drillAtFaceCenter(page);
  await expect.poll(async () => (await jobs(page)).length).toBe(2);
  // A move: committed and rendered at once.
  const at = center(await handle(page, "h1:move").boundingBox());
  await page.mouse.move(...at);
  await page.mouse.down();
  await page.mouse.move(at[0] + 40, at[1] + 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await jobs(page)).length).toBe(3);

  // The holes stay as they are while the base changes: that render is
  // not the move's, and waits out the typing as any base edit does.
  await page.getByText("Part parameters", { exact: true }).click();
  const w = page.getByRole("spinbutton", { name: "w", exact: true });
  await w.fill("");
  // Keys a little apart, as typed: well inside the 250 ms debounce, but
  // each long enough for a render with no delay to start.
  await w.pressSequentially("120", { delay: 60 });
  await page.waitForTimeout(800);
  // One render for the run of keys: the base, then the base with its hole.
  const all = await jobs(page);
  expect(all.length).toBe(5);
  expect(all[3].params.w).toBe(120);
  expect(all[4].scadSource).toContain("w=120");
});

test("an open View menu keeps the plain keys: they don't nudge or delete the hole behind it", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");
  await drillAtFaceCenter(page);
  await page.getByRole("button", { name: /^View/ }).click();
  const menu = page.getByRole("menu", { name: "View" });
  await expect(menu.getByRole("menuitem", { name: "Home" })).toBeFocused();
  for (const key of ["ArrowRight", "ArrowLeft", "Delete", "Backspace"]) await page.keyboard.press(key);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Right" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Home" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
  expect(await holePoint(page)).toEqual([0, 0, 2]);
});

test("the sidebar's Grid is the viewer's, and the arrows nudge by it straight after a pick", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");
  await drillAtFaceCenter(page);
  const sidebarGrid = page.locator(".holes-sidebar").getByRole("combobox", { name: "Grid" });
  const viewerGrid = page.locator(".viewer-toolbar").getByRole("combobox", { name: "Grid" });
  await expect(viewerGrid).toHaveValue("0.5");

  // The pick lets go of the select, so the next arrow nudges the hole on
  // the new grid rather than changing the grid again. (selectOption()
  // alone doesn't focus it; a click on it would.)
  await sidebarGrid.focus();
  await sidebarGrid.selectOption("1");
  await expect(viewerGrid).toHaveValue("1");
  await expect(sidebarGrid).not.toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => holePoint(page)).toEqual([1, 0, 2]);
  await expect(sidebarGrid).toHaveValue("1");

  // Off: a nudge still moves, half a millimetre.
  await sidebarGrid.selectOption("0");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => holePoint(page)).toEqual([1.5, 0, 2]);
});

test("the header's hint keeps two lines, so selecting holes never moves the viewer", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");
  const canvas = page.locator(".bench-viewer canvas");
  const note = page.locator(".holes-note");
  const top = async () => (await canvas.boundingBox()).y;
  const twoLines = await note.evaluate((el) => 2 * parseFloat(getComputedStyle(el).lineHeight));
  // Where the viewer starts, the note's height, and whether its text fits
  // (none is cut short with an ellipsis), in each state.
  const looks = [];
  const look = async () =>
    looks.push({
      top: await top(),
      height: (await note.boundingBox()).height,
      fits: await note.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      text: await note.textContent(),
    });
  await look();

  // One hole selected, then none, then two: three texts of different
  // lengths (the multi-select one used to wrap to a third line and push
  // the viewer down 18 px).
  await drillAtFaceCenter(page);
  await look();
  await page.keyboard.press("Escape");
  await expect(note).toContainText("1 hole.");
  await look();
  const box = await canvas.boundingBox();
  // The drilled hole's render replaces the mesh, and with it the face under
  // the pointer (its triangles are renumbered): hover once that render is in.
  await expect.poll(async () => (await jobs(page)).length).toBeGreaterThanOrEqual(2);
  const second = await hoverSnap(page, box.x + box.width / 2, box.y + box.height / 2 + 30);
  await page.mouse.click(second.x, second.y);
  await expect(page.locator(".holes-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(note).toContainText("2 holes selected");
  await look();
  for (const l of looks) {
    expect(l.top, l.text).toBe(looks[0].top);
    expect(Math.abs(l.height - twoLines), l.text).toBeLessThan(0.5);
    expect(l.fits, l.text).toBe(true);
  }
});

test("a small hole's move handle shows its readout clear of the rim handles around it", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  const search = page.getByRole("searchbox", { name: "Search hole types" });
  await search.fill("round");
  await page.getByRole("option", { name: /^Round cutout/ }).click();
  await search.fill("");
  await drillAtFaceCenter(page);
  await page.getByRole("spinbutton", { name: "Diameter (mm)" }).fill("2");
  await page.evaluate(() => document.activeElement.blur());
  await expect(page.locator(".viewer-handle")).toHaveCount(5);
  await expect(handle(page, "h1:move")).toHaveAttribute("data-state", "shown");

  // Resting on the move handle shows what it does; the rim handles a few
  // tens of pixels round it stay in sight.
  await page.mouse.move(...center(await handle(page, "h1:move").boundingBox()));
  const readout = page.locator(".viewer-handle-readout");
  await expect(readout).toHaveText(/Drag to move/);
  const r = await readout.boundingBox();
  for (const side of ["d:x+", "d:x-", "d:y+", "d:y-"]) {
    const [x, y] = center(await handle(page, `h1:${side}`).boundingBox());
    const hidden = x > r.x - 7 && x < r.x + r.width + 7 && y > r.y - 7 && y < r.y + r.height + 7;
    expect(hidden, `${side} at ${[x, y]} under the readout ${JSON.stringify(r)}`).toBe(false);
  }
});

test("Measure spacing puts a system's next holes round the selected one, to drill on pitch", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page, { bytes: slabBytes });
  await page.goto("/app/#mode=holes");
  await page.getByRole("option", { name: "Flat plate exact", exact: true }).click();
  await expect.poll(async () => (await jobs(page)).length).toBe(1);
  test.skip(!(await hasWebgl(page)), "placing a hole needs a WebGL click on the preview");
  const target = await drillAtFaceCenter(page);

  // Picked, the spacing shows nothing until Measure is on.
  const spacing = page.locator(".holes-sidebar").getByRole("combobox", { name: "Measure spacing" });
  await spacing.selectOption("modgrid");
  await expect(spacing).not.toBeFocused();
  await expect(page.locator(".viewer-label", { hasText: /^8\.0 mm$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Measure distances" }).click();
  await expect(page.locator(".viewer-label", { hasText: /^8\.0 mm$/ })).toHaveCount(1);
  await expect(page.locator(".viewer-label", { hasText: /^11\.3 mm$/ })).toHaveCount(1);

  // The 8 mm label sits halfway along the line to one of them, so the
  // point is about twice as far out. Along that line, the spots that take
  // it: the hint names it, or (over its marker, which reports no hover)
  // the cursor says a marker is there. Off the model between tries, so a
  // hint is never one left from the spot before. A click in the middle of
  // that run drills it, a step on — at the run's edge, a click can
  // resolve a hair outside the snap's reach.
  const hint = page.locator(".holes-snap-hint");
  const canvas = page.locator(".bench-viewer canvas");
  const corner = await canvas.boundingBox();
  const label = await page.locator(".viewer-label", { hasText: /^8\.0 mm$/ }).boundingBox();
  const half = [label.x + label.width / 2 - target.x, label.y + label.height / 2 - target.y];
  const at = (s) => [target.x + s * half[0], target.y + s * half[1]];
  const run = [];
  for (let s = 1.3; s <= 2.7; s += 0.05) {
    await page.mouse.move(corner.x + 4, corner.y + 4);
    await expect(hint).toHaveCount(0);
    await page.mouse.move(...at(s));
    await page.waitForTimeout(30);
    const named = (await hint.count()) && (await hint.textContent()).includes("MOD-GRID pitch, 8 mm on");
    const onMarker = (await canvas.evaluate((c) => c.style.cursor)) === "pointer";
    if (named || (onMarker && run.length && run.at(-1) > s - 0.06)) run.push(s);
    else if (run.length) break;
  }
  expect(run.length, "spots along the label's line that snap to a MOD-GRID neighbour").toBeGreaterThan(0);
  await page.mouse.click(...at((run[0] + run.at(-1)) / 2));
  await expect(page.getByText(/Hole 2 selected/)).toBeVisible();
  const meta = await page.locator(".holes-row-meta").nth(1).textContent();
  const [x, y, z] = meta
    .match(/\[(.*)\]/)[1]
    .split(", ")
    .map(Number);
  expect([Math.abs(x) + Math.abs(y), z]).toEqual([8, 2]);

  // None takes them away again.
  await spacing.selectOption("");
  await expect(page.locator(".viewer-label", { hasText: /^8\.0 mm$/ })).toHaveCount(0);
});
