import { expect, test } from "@playwright/test";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// The Bench's root selection, its resize handles, the children guard and
// undo (Bench.jsx, lib/benchResize.js). The mock worker answers every
// render — the root's own extents and the assembly alike — with the same
// 10 × 10 × 4 mm cube, so these check the parameters a gesture commits
// and the renders it starts, never the geometry.

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
    resize: { x: { param: "w", min: 8 }, y: { param: "d", min: 8 }, z: { param: "t" } },
  },
  {
    // As catalogue.yaml's: one slot per 28 mm cell, named by centre-relative
    // index, so 2 cells are ±0.5 and 3 cells −1, 0, 1.
    id: "opengrid/board",
    name: "Board",
    system: "openGrid",
    confidence: "exact",
    file: "parts/opengrid/board.scad",
    module: "og_board",
    slots: { pitch: 28, count_params: ["cells_x", "cells_y"] },
    defaults: { cells_x: 2, cells_y: 2, variant: "full" },
    options: { variant: ["full", "lite", "heavy"] },
    resize: {
      x: { param: "cells_x", per: 28, step: 1, max: 6 },
      y: { param: "cells_y", per: 28, step: 1, max: 6 },
    },
  },
];

async function catalogue(page) {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
}

// As app.spec.js's: renders wait for finish(index) unless `auto`.
async function mockWorker(page, auto = false) {
  await page.addInitScript(
    ({ bytes, auto }) => {
      window.__renders = {
        auto,
        jobs: [],
        finish(index, error) {
          const job = this.jobs[index];
          job.worker.onmessage({
            data: error
              ? { id: job.request.id, type: "error", message: error }
              : { id: job.request.id, type: "result", stl: new Uint8Array(bytes).buffer },
          });
        },
      };
      window.Worker = class {
        terminated = false;
        postMessage(request) {
          // The client's warm-ups are not jobs and get no answer.
          if (request?.type === "warm") return;
          const index = window.__renders.jobs.push({ request, worker: this }) - 1;
          if (window.__renders.auto) queueMicrotask(() => window.__renders.finish(index));
        }
        terminate() {
          this.terminated = true;
        }
      };
    },
    { bytes: cubeBytes, auto },
  );
}

const jobCount = (page) => page.evaluate(() => window.__renders.jobs.length);
const finish = (page, index, error) =>
  page.evaluate(({ index, error }) => window.__renders.finish(index, error), { index, error });
const job = (page, index) =>
  page.evaluate((index) => {
    const { request } = window.__renders.jobs[index];
    return { params: request.params ?? null, scadSource: request.scadSource ?? null };
  }, index);
const hasWebgl = (page) => page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
const center = (box) => [box.x + box.width / 2, box.y + box.height / 2];

const plateConfig = {
  format: "connector-foundry/bench",
  version: 1,
  name: "bench",
  root: { partId: "basics/plate", params: { w: 40, d: 40, t: 4, r: 3 } },
  nodes: [],
  imports: [],
};
// A 2 × 2 board with a plate on one of its four slots.
const boardConfig = {
  ...plateConfig,
  root: { partId: "opengrid/board", params: { cells_x: 2, cells_y: 2, variant: "full" } },
  nodes: [
    {
      id: "c1",
      parentId: "root",
      partId: "basics/plate",
      params: { w: 20, d: 20, t: 2, r: 1 },
      slotName: "mount_0.5_0.5",
      joint: "fused",
      childAnchor: "mount",
    },
  ],
};

async function importConfig(page, config) {
  const chooser = page.waitForEvent("filechooser");
  // The start picker's row over an empty bench, the sidebar's button on one.
  await page
    .getByRole("option", { name: "Import config…", exact: true })
    .or(page.getByRole("button", { name: "Import config…", exact: true }))
    .click();
  await (
    await chooser
  ).setFiles({
    name: "test.bench.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(config)),
  });
}

// A bench from `config` on screen, its renders finished one by one (the
// nodes' own extents first, then the assembly).
async function openBench(page, config) {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/#mode=bench");
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  await importConfig(page, config);
  const renders = config.nodes.length + 2;
  for (let i = 0; i < renders; i++) {
    await expect.poll(() => jobCount(page)).toBe(i + 1);
    await finish(page, i);
  }
  await expect(page.locator(".viewer-canvas canvas")).toBeVisible();
}

// The root's first parameter field (w, cells_x); its accessible name grows
// a "differs from the default" note once it changes.
const firstRootField = (page) =>
  page.locator('details[data-node-params="root"]').getByRole("spinbutton").first();
const selectRoot = (page) => page.getByRole("button", { name: "Select root", exact: true });
const widthHandle = (page, param = "w") => page.getByRole("slider", { name: `Width (${param})` });

test("the root is selected from the sidebar or the scene, and shows its handles", async ({ page }) => {
  await openBench(page, boardConfig);
  await expect(widthHandle(page, "cells_x")).toHaveCount(0);

  await selectRoot(page).click();
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");
  // The root's pill is in the viewer's toolbar, not floating over its top
  // face, where the slot markers and the far edge's handle are.
  const overlay = page.locator(".viewer-toolbar .bench-rotate-panel");
  await expect(overlay).toContainText("Board · root");
  await expect(page.locator(".viewer-overlay")).toHaveCount(0);
  await expect(overlay.getByRole("button", { name: /^Crop everything else/ })).toBeVisible();
  // Nothing in it that would move, turn or remove the root.
  await expect(overlay.getByRole("button", { name: /^(Remove|Move|Rotate)/ })).toHaveCount(0);
  await expect(widthHandle(page, "cells_x")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Depth (cells_y)" })).toBeVisible();
  // The root params stay folded until asked for (the tests open them by
  // their summary).
  await expect(page.locator('details[data-node-params="root"]')).not.toHaveAttribute("open", "");
  await overlay.getByRole("button", { name: "Deselect", exact: true }).click();
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "false");
  await expect(widthHandle(page, "cells_x")).toHaveCount(0);

  // From the scene: looking straight down, the middle of the view is the
  // board's top face (its slots sit off-centre, at ±14 mm). Selecting
  // there opens the root's parameters too.
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("menu", { name: "View" }).getByRole("menuitem", { name: "Top" }).click();
  await page.locator(".viewer-canvas canvas").click({ position: await canvasMiddle(page) });
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('details[data-node-params="root"]')).toHaveAttribute("open", "");
  await expect(page.getByRole("spinbutton", { name: "cells_x", exact: true })).toBeVisible();

  // An attached part's pill floats over it, and says where it is resized.
  await page.locator(".bench-node-name", { hasText: "Flat plate" }).click();
  await expect(page.locator(".viewer-overlay .bench-rotate-panel")).toContainText("Flat plate");
  await expect(page.locator(".viewer-toolbar .bench-rotate-panel")).toHaveCount(0);
  await expect(page.locator(".bench-overlay-hint")).toHaveText("Resize in the sidebar");
  await expect(widthHandle(page, "cells_x")).toHaveCount(0);
});

async function canvasMiddle(page) {
  const box = await page.locator(".viewer-canvas canvas").boundingBox();
  return { x: box.width / 2, y: box.height / 2 };
}

test("Delete, M and the arrows leave a selected root alone", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  await openBench(page, boardConfig);
  await selectRoot(page).click();
  // Pressed on the page, not on a handle.
  await page.locator(".part-header h2").click();
  for (const key of ["Delete", "Backspace", "m", "ArrowRight"]) await page.keyboard.press(key);
  await expect(page.getByRole("heading", { name: "Attached (1 of 3)" })).toBeVisible();
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await jobCount(page)).toBe(3);
  // Esc still drops the selection.
  await page.keyboard.press("Escape");
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

// Where the width handle is, and the screen direction that pulls it
// outward: from its mirror on the far side towards it.
async function widthPull(page, px, param = "w") {
  const near = center(await widthHandle(page, param).boundingBox());
  const far = center(await page.locator('[data-handle-id="x-"]').boundingBox());
  const len = Math.hypot(near[0] - far[0], near[1] - far[1]);
  return {
    from: near,
    to: [near[0] + ((near[0] - far[0]) / len) * px, near[1] + ((near[1] - far[1]) / len) * px],
    span: len,
  };
}

test("dragging a root handle commits one parameter change, rendered at once", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  await openBench(page, plateConfig);
  await selectRoot(page).click();
  await expect(widthHandle(page)).toBeVisible();
  const { from, to } = await widthPull(page, 80);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await expect(page.locator(".viewer-drag-label")).toContainText(/^W [\d.]+ mm \(\+[\d.]+ each side\)$/);
  expect(await jobCount(page)).toBe(2);
  await page.mouse.up();

  const valueNow = async () => Number(await widthHandle(page).getAttribute("aria-valuenow"));
  await expect.poll(valueNow).toBeGreaterThan(40);
  const committed = await valueNow();
  expect(committed % 0.5).toBe(0);
  // No typing debounce: the root's own render starts at once (the 250 ms
  // debounce would miss this window)...
  await expect.poll(() => jobCount(page), { timeout: 200, intervals: [20] }).toBe(3);
  expect((await job(page, 2)).params.w).toBe(committed);
  // ...the ghost of the new size stays up, and the handles stand on it...
  await expect(page.locator(".viewer-drag-label")).toContainText("rendering…");
  await finish(page, 2);
  // ...then the assembly, once, with the new width.
  await expect.poll(() => jobCount(page)).toBe(4);
  expect((await job(page, 3)).scadSource).toContain(`w=${committed}`);
  await finish(page, 3);
  await expect(page.locator(".viewer-drag-label")).toBeHidden();
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(4);

  // The sidebar has it too, and one undo takes it back.
  await page.getByText("Root parameters", { exact: true }).click();
  await expect(firstRootField(page)).toHaveValue(String(committed));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(firstRootField(page)).toHaveValue("40");
  // The first render is still cached: no new job, the handles straight back.
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "40");
  expect(await jobCount(page)).toBe(4);
  expect(errors).toEqual([]);
});

test("arrow keys step a focused root handle, which keeps its focus", async ({ page }) => {
  await openBench(page, plateConfig);
  await selectRoot(page).click();
  await widthHandle(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  // Two steps of the 0.5 mm grid; the handle survived the render the
  // first one started.
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "41");
  await expect(widthHandle(page)).toBeFocused();
  // The pending label counts the run (one undo step, one render) from the
  // measured 10 mm, not from the first press's predicted box.
  await expect(page.locator(".viewer-drag-label")).toHaveText("W 11 mm (+0.5 each side) · rendering…");
  // The window's arrow keys (step the selected part to a slot) left them alone.
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");
  // One undo step for the run of presses.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "40");
});

test("the guard keeps an attached part's slot: a 2-cell board steps to 4", async ({ page }) => {
  await openBench(page, boardConfig);
  await selectRoot(page).click();
  const handle = widthHandle(page, "cells_x");
  await handle.focus();
  // 3 cells would rename every slot (−1, 0, 1), dropping mount_0.5_0.5.
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "4");
  await expect(handle).toHaveAttribute("aria-valuetext", /— 3 would move attached parts$/);
  // Back down: 3 is refused again, 2 keeps it.
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "2");
  // Below 2 nothing keeps it: the step does nothing, and says why.
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuetext", /— 1 would move attached parts$/);
  await expect(handle).toHaveAttribute("aria-valuenow", "2");
  await expect(handle).toBeFocused();
  await page.getByText("Root parameters", { exact: true }).click();
  await expect(firstRootField(page)).toHaveValue("2");
  // The note explained that press: with the handle's focus gone, so is it.
  await expect(handle).not.toHaveAttribute("aria-valuetext", /would move/);
});

test("a guard note lasts as long as the gesture it explains", async ({ page }) => {
  await openBench(page, boardConfig);
  await selectRoot(page).click();
  const handle = widthHandle(page, "cells_x");
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuetext", /— 1 would move attached parts$/);
  // Deselecting ends it: selected again, the handle reads plainly.
  await page.keyboard.press("Escape");
  await expect(handle).toHaveCount(0);
  await selectRoot(page).click();
  await expect(handle).toHaveAttribute("aria-valuetext", /^[^—]+$/);

  // A drag says why on its label while it runs, and leaves nothing behind:
  // a mouse user's handle has no focus to lose, so a note would linger.
  // Past the far handle: the board would shrink by more than half a cell.
  const { span } = await widthPull(page, 0, "cells_x");
  const { from, to } = await widthPull(page, -1.2 * span, "cells_x");
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await expect(page.locator(".viewer-drag-label")).toContainText("1 would move attached parts");
  await page.mouse.up();
  await expect(page.locator(".viewer-drag-label")).toBeHidden();
  await expect(handle).toHaveAttribute("aria-valuenow", "2");
  await expect(handle).toHaveAttribute("aria-valuetext", /^[^—]+$/);
  await page.waitForTimeout(400);
  expect(await jobCount(page)).toBe(3);
});

test("Start over can be undone from the start picker", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page, true);
  await page.goto("/app/#mode=bench");
  await importConfig(page, boardConfig);
  const attached = page.getByRole("heading", { name: "Attached (1 of 3)" });
  const start = page.getByRole("heading", { name: "Start a bench" });
  await expect(attached).toBeVisible();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(start).toBeVisible();
  await page.getByRole("option", { name: "Undo start over", exact: true }).click();
  await expect(attached).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("bench");

  // The keys go both ways too, straight away: the picker focuses its
  // search box, which has nothing of its own to undo until it is typed in.
  const search = page.getByRole("combobox", { name: "Search parts" });
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(start).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(attached).toBeVisible();

  // Typed into, the box keeps Cmd/Ctrl+Z for its own text: the bench
  // stays gone until the picker is put away.
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(search).toBeFocused();
  await search.pressSequentially("plate");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(200);
  await expect(start).toBeVisible();
  await search.fill("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Choose a base part…/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(attached).toBeVisible();
});

test("Open in Bench is a named undo step", async ({ page }) => {
  await catalogue(page);
  await mockWorker(page, true);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Open in Bench", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select root", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute(
    "title",
    /^Undo open in bench /,
  );
});

test("a click on a root handle types its size; Esc in the box keeps the root selected", async ({ page }) => {
  await openBench(page, plateConfig);
  await selectRoot(page).click();
  const size = page.getByRole("spinbutton", { name: "Width (mm)" });
  // Esc closes the box and goes no further: the Bench's own Esc would
  // drop the selection, and the handles with it.
  await widthHandle(page).click();
  await expect(size).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(size).toHaveCount(0);
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");

  // A corner drives two sizes, so it has no box, and a click on it does
  // nothing else either: it is not the click on the empty canvas beside
  // the plate, which would drop the selection and the handles with it.
  await page.locator('.viewer-handle-corner[data-state="shown"]').first().click();
  await expect(size).toHaveCount(0);
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");
  await expect(widthHandle(page)).toBeVisible();

  // The measured 10 mm grows by 15: w 40 → 55, the root's own render at once.
  await widthHandle(page).click();
  await expect(size).toHaveValue("10");
  await size.fill("25");
  await page.keyboard.press("Enter");
  await expect(size).toHaveCount(0);
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "55");
  await expect.poll(() => jobCount(page), { timeout: 200, intervals: [20] }).toBe(3);
  expect((await job(page, 2)).params.w).toBe(55);
  await expect(selectRoot(page)).toHaveAttribute("aria-pressed", "true");
});

test("a size that fails to render offers its Undo by the error", async ({ page }) => {
  await openBench(page, plateConfig);
  await selectRoot(page).click();
  await widthHandle(page).focus();
  // A keyboard step waits out the debounce, then the assembly's render and
  // the root's own, one after the other (the preview first: Bench.jsx's
  // extents effect).
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => jobCount(page)).toBe(3);
  await finish(page, 2, "Assertion failed: too wide");
  await expect.poll(() => jobCount(page)).toBe(4);
  await finish(page, 3);

  const alert = page.locator(".bench-error");
  await expect(alert).toContainText("Couldn't render that size.");
  // The handles make way for it: no drag can start from a size that failed.
  await expect(widthHandle(page)).toHaveCount(0);
  await alert.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(alert).toHaveCount(0);
  // 40 mm is still in the cache: its mesh and handles are straight back.
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "40");
  await page.waitForTimeout(400);
  expect(await jobCount(page)).toBe(4);
});

test("an undo or redo that takes the selected part away takes the selection too", async ({ page }) => {
  await openBench(page, boardConfig);
  const child = page.locator(".bench-node-name", { hasText: "Flat plate" });
  const pill = page.locator(".bench-rotate-panel");
  await child.click();
  await expect(pill).toContainText("Flat plate");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("heading", { name: "Attached (0 of 3)" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("heading", { name: "Attached (1 of 3)" })).toBeVisible();

  // Selected again, then the delete redone: the selection goes with the
  // part, so undoing once more brings the part back unselected — not its
  // controls popping up again out of nowhere.
  await child.click();
  await expect(pill).toContainText("Flat plate");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("heading", { name: "Attached (0 of 3)" })).toBeVisible();
  await expect(pill).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("heading", { name: "Attached (1 of 3)" })).toBeVisible();
  await expect(child).toHaveAttribute("aria-pressed", "false");
  await expect(pill).toHaveCount(0);
});

test("typing a parameter or the bench's name is one undo step each", async ({ page }) => {
  await openBench(page, plateConfig);
  await page.getByText("Root parameters", { exact: true }).click();
  const field = firstRootField(page);
  await field.click();
  await field.press("ControlOrMeta+a");
  // Three keystrokes, each reported (DecimalInput parses every one).
  await field.pressSequentially("125");
  await expect(field).toHaveValue("125");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.click();
  await name.press("End");
  await name.pressSequentially("-two");
  await expect(name).toHaveValue("bench-two");

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await expect(name).toHaveValue("bench");
  await expect(field).toHaveValue("125");
  await undo.click();
  await expect(field).toHaveValue("40");
  await expect(name).toHaveValue("bench");
  // What's left is the config load itself.
  await expect(undo).toHaveAttribute("title", /load config/);
});

test("the error's Undo is the resize's only while the failed bench is the one it made", async ({ page }) => {
  await openBench(page, boardConfig);
  await selectRoot(page).click();
  await widthHandle(page, "cells_x").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => jobCount(page)).toBe(4);
  await finish(page, 3, "Assertion failed: too wide");
  await expect.poll(() => jobCount(page)).toBe(5);
  await finish(page, 4);
  const alert = page.locator(".bench-error");
  await expect(alert.getByRole("button", { name: "Undo", exact: true })).toBeVisible();

  // An edit elsewhere fails too: its error is no longer the size's, and an
  // Undo there would take back the edit, not the resize.
  await page.getByRole("spinbutton", { name: "Offset (mm)" }).fill("1");
  await expect.poll(() => jobCount(page)).toBe(6);
  await finish(page, 5, "Assertion failed: too wide");
  await expect(alert).toContainText("too wide");
  await expect(alert).not.toContainText("Couldn't render that size.");
  await expect(alert.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
});

test("a root resize's ghost goes once its render lands: a later edit elsewhere doesn't bring it back", async ({
  page,
}) => {
  await openBench(page, boardConfig);
  await selectRoot(page).click();
  await widthHandle(page, "cells_x").focus();
  await page.keyboard.press("ArrowRight");
  const label = page.locator(".viewer-drag-label");
  await expect(label).toContainText("rendering…");
  await expect.poll(() => jobCount(page)).toBe(4);
  await finish(page, 3);
  await expect.poll(() => jobCount(page)).toBe(5);
  await finish(page, 4);
  await expect(label).toBeHidden();
  // An edit to the attached part keeps the root's parameters as they are;
  // its render is the edit's, and shows no outline or "rendering…" of the
  // resize before it.
  await page.getByRole("spinbutton", { name: "Offset (mm)" }).fill("1");
  await expect.poll(() => jobCount(page)).toBe(6);
  await expect(label).toBeHidden();
  await finish(page, 5);
});
