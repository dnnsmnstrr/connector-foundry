import { expect, test } from "@playwright/test";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// The Library's resize handles (StlViewer's `handles`, lib/resize.js):
// drag, arrow keys, the click-to-type size box, Esc, undo, the Grid
// select and the camera keys. The mock worker answers every render with
// the same 10 × 10 × 4 mm cube, so these check the parameters and the
// sliders' values a gesture produces, never the geometry.

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
    id: "basics/post",
    name: "Round post",
    system: "Basics",
    confidence: "exact",
    file: "parts/basics/post.scad",
    module: "basics_post",
    defaults: { dia: 10, h: 20 },
    anchors: ["bot"],
    resize: { xy: { param: "dia" }, z: { param: "h" } },
  },
];

async function catalogue(page) {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
}

// As app.spec.js's: renders wait for finish(index) unless `auto`. Every
// render is the 10 mm cube, or `bytes`.
async function mockWorker(page, auto = false, bytes = cubeBytes) {
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
    { bytes, auto },
  );
}

const jobCount = (page) => page.evaluate(() => window.__renders.jobs.length);
const finish = (page, index, error) =>
  page.evaluate(({ index, error }) => window.__renders.finish(index, error), { index, error });
const hasWebgl = (page) => page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
// The sidebar's w field (first of the plate's); its accessible name grows
// a "differs from the default" note once it changes.
const widthField = (page) => page.locator(".params-panel").getByRole("spinbutton").first();
const widthHandle = (page) => page.getByRole("slider", { name: "Width (w)" });
const center = (box) => [box.x + box.width / 2, box.y + box.height / 2];

// The plate on screen, its first render finished, and the handles up.
async function openPlate(page) {
  await catalogue(page);
  await mockWorker(page);
  await page.goto("/app/");
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  await expect.poll(() => jobCount(page)).toBe(1);
  await finish(page, 0);
  await expect(widthHandle(page)).toBeVisible();
}

// Where the width handle is, and the screen direction that pulls it
// outward: from its mirror on the far side towards it.
async function widthPull(page, px) {
  const near = center(await widthHandle(page).boundingBox());
  const far = center(await page.locator('[data-handle-id="x-"]').boundingBox());
  const len = Math.hypot(near[0] - far[0], near[1] - far[1]);
  return {
    from: near,
    to: [near[0] + ((near[0] - far[0]) / len) * px, near[1] + ((near[1] - far[1]) / len) * px],
  };
}

test("dragging a handle commits one parameter change and renders it at once", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  await openPlate(page);
  const { from, to } = await widthPull(page, 80);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  // The ghost's label follows the drag; nothing is committed yet.
  await expect(page.locator(".viewer-drag-label")).toContainText(/^W [\d.]+ mm \(\+[\d.]+ each side\)$/);
  expect(await jobCount(page)).toBe(1);
  await page.mouse.up();

  const committed = Number(await widthField(page).inputValue());
  expect(committed).toBeGreaterThan(40);
  // Snapped to the default 0.5 mm grid.
  expect(committed % 0.5).toBe(0);
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", String(committed));
  // No 400 ms debounce, and exactly one render for the whole gesture.
  await expect.poll(() => jobCount(page), { timeout: 300 }).toBe(2);
  // Until it lands: the ghost of the new size, and the header's size muted.
  await expect(page.locator(".viewer-drag-label")).toContainText("rendering…");
  await expect(page.locator(".outside-dimensions.is-predicted")).toBeVisible();
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(2);
  await finish(page, 1);
  await expect(page.locator(".viewer-drag-label")).toBeHidden();
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a drag measures from where the handle was grabbed", async ({ page }) => {
  await openPlate(page);
  // The grab target sits a few px outside the edge it stands for; pressing
  // it and moving past the click slop and back is no resize at all.
  const { from, to } = await widthPull(page, 30);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 4 });
  await expect(page.locator(".viewer-drag-label")).toBeVisible();
  await page.mouse.move(...from, { steps: 4 });
  await expect(page.locator(".viewer-drag-label")).toHaveText(/^W 10 mm\b/);
  await page.mouse.up();
  await expect(widthField(page)).toHaveValue("40");
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(1);
  // A press takes no focus: the arrow keys stay with whatever had them.
  await expect(widthHandle(page)).not.toBeFocused();
});

test("keys belong to a running drag", async ({ page }) => {
  await openPlate(page);
  const { from, to } = await widthPull(page, 60);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  // H would hide the helpers (and the handle being dragged) mid-gesture.
  await page.keyboard.press("h");
  await expect(page.getByRole("button", { name: "Helpers" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".viewer-drag-label")).toBeVisible();
  await page.mouse.up();
  expect(Number(await widthField(page).inputValue())).toBeGreaterThan(40);
});

test("a handle that goes away mid-drag takes the drag with it", async ({ page }) => {
  await openPlate(page);
  let pull = await widthPull(page, 60);
  await page.mouse.move(...pull.from);
  await page.mouse.down();
  await page.mouse.move(...pull.to, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => jobCount(page)).toBe(2);
  const first = await widthField(page).inputValue();
  // A second drag starts on the predicted box while that render runs...
  pull = await widthPull(page, 40);
  await page.mouse.move(...pull.from);
  await page.mouse.down();
  await page.mouse.move(...pull.to, { steps: 6 });
  await expect(page.locator(".viewer-drag-label")).toContainText("each side");
  // ...and the render fails: the handles make way for the note, and the
  // drag ends without a commit.
  await finish(page, 1, "Deliberate render failure");
  await expect(widthHandle(page)).toHaveCount(0);
  await expect(page.locator(".viewer-drag-label")).toBeHidden();
  await page.mouse.up();
  await expect(widthField(page)).toHaveValue(first);
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(2);
});

test("the right button and the wheel on a handle move the view, not the size", async ({ page }) => {
  await openPlate(page);
  const near = () => widthHandle(page).boundingBox().then(center);
  const far = () => page.locator('[data-handle-id="x-"]').boundingBox().then(center);
  const span = async () => {
    const [a, b] = [await near(), await far()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  const start = await near();
  // Right-drag pans (OrbitControls takes the press the handle hands on).
  await page.mouse.move(...start);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(start[0] - 80, start[1] + 60, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await expect
    .poll(async () => Math.hypot(...(await near()).map((v, i) => v - start[i])))
    .toBeGreaterThan(40);
  // The wheel zooms in: the box grows on screen.
  const before = await span();
  await page.mouse.move(...(await near()));
  await page.mouse.wheel(0, -400);
  await expect.poll(span).toBeGreaterThan(before * 1.1);
  await expect(widthField(page)).toHaveValue("40");
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("a finger drags a handle", async ({ page }) => {
    await openPlate(page);
    const { from, to } = await widthPull(page, 60);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, at) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: at ? [{ x: at[0], y: at[1] }] : [],
      });
    await touch("touchStart", from);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [
        from[0] + ((to[0] - from[0]) * i) / 8,
        from[1] + ((to[1] - from[1]) * i) / 8,
      ]);
    }
    await expect(page.locator(".viewer-drag-label")).toContainText("each side");
    await touch("touchEnd");
    await expect.poll(async () => Number(await widthField(page).inputValue())).toBeGreaterThan(40);
    await expect.poll(() => jobCount(page), { timeout: 300 }).toBe(2);
  });

  // Fingers by id, as CDP tracks them: each call lists every finger down.
  const fingers = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    return (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id })),
      });
  };

  test("a second finger turns a handle drag into a pinch: the view zooms, nothing resizes", async ({
    page,
  }) => {
    await openPlate(page);
    const span = async () => {
      const a = center(await widthHandle(page).boundingBox());
      const b = center(await page.locator('[data-handle-id="x-"]').boundingBox());
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    const before = await span();
    const { from, to } = await widthPull(page, 30);
    const viewer = await page.locator(".viewer-canvas canvas").boundingBox();
    // The second finger lands on the canvas, clear of the handles.
    const second = [viewer.x + 60, viewer.y + viewer.height - 60];
    const touch = await fingers(page);
    await touch("touchStart", [from]);
    await touch("touchMove", [to]);
    await expect(page.locator(".viewer-drag-label")).toContainText("each side");
    await touch("touchStart", [to, second]);
    // The drag is over, uncommitted, the moment the second finger lands.
    await expect(page.locator(".viewer-drag-label")).toBeHidden();
    // Fingers spread apart: a pinch out zooms in.
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [
        [to[0] + i * 8, to[1] - i * 8],
        [second[0] - i * 8, second[1] + i * 8],
      ]);
    }
    await touch("touchEnd", []);
    await expect.poll(span).toBeGreaterThan(before * 1.1);
    await expect(widthField(page)).toHaveValue("40");
    await page.waitForTimeout(600);
    expect(await jobCount(page)).toBe(1);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });

  test("a tap that wanders a few pixels still opens the size box", async ({ page }) => {
    await openPlate(page);
    const at = center(await widthHandle(page).boundingBox());
    const touch = await fingers(page);
    await touch("touchStart", [at]);
    // Further than a mouse click may travel (5 px), as near as a finger's.
    await touch("touchMove", [[at[0] + 7, at[1] + 3]]);
    await touch("touchEnd", []);
    await expect(page.getByRole("spinbutton", { name: "Width (mm)" })).toBeFocused();
    await expect(widthField(page)).toHaveValue("40");
    expect(await jobCount(page)).toBe(1);
  });
});

test("a failed resize offers its undo in the viewer", async ({ page }) => {
  await openPlate(page);
  const { from, to } = await widthPull(page, 60);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1, "Deliberate render failure");
  const note = page.locator(".viewer-error-note");
  await expect(note).toContainText("Couldn't render that size.");
  // The handles make way for it.
  await expect(widthHandle(page)).toHaveCount(0);
  await note.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(widthField(page)).toHaveValue("40");
  await expect(note).toHaveCount(0);
  // The first render is still cached: the handles are back at once.
  await expect(widthHandle(page)).toBeVisible();
});

test("arrow keys step a Tab-focused handle and keep its focus", async ({ page }) => {
  await openPlate(page);
  // Tab from the toolbar's last control reaches the first handle.
  await page.getByRole("button", { name: "Helpers" }).focus();
  await page.keyboard.press("Tab");
  await expect(widthHandle(page)).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  // Three steps of the 0.5 mm grid; the handle survived each render
  // the steps started, so the keys kept reaching it.
  await expect(widthField(page)).toHaveValue("41.5");
  await expect(widthHandle(page)).toBeFocused();
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "41.5");
  // Debounced like typing: one render for the run of presses.
  await expect.poll(() => jobCount(page)).toBe(2);
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(2);
  // And one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(widthField(page)).toHaveValue("40");
});

test("Esc in the middle of a drag cancels it", async ({ page }) => {
  await openPlate(page);
  const { from, to } = await widthPull(page, 80);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await expect(page.locator(".viewer-drag-label")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".viewer-drag-label")).toBeHidden();
  await page.mouse.up();
  await expect(widthField(page)).toHaveValue("40");
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(1);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("clicking a handle types an exact size, and Cmd/Ctrl+Z takes it back", async ({ page }) => {
  await openPlate(page);
  // A moment's hover shows the size the handle stands for.
  await widthHandle(page).hover();
  await expect(page.locator(".viewer-handle-readout")).toHaveText("10 mm");

  await widthHandle(page).click();
  const size = page.getByRole("spinbutton", { name: "Width (mm)" });
  await expect(size).toBeFocused();
  await expect(size).toHaveValue("10");
  await size.fill("25");
  await page.keyboard.press("Enter");
  // The measured 10 mm grows by 15: w 40 → 55, rendered at once.
  await expect(widthField(page)).toHaveValue("55");
  await expect(size).toHaveCount(0);
  await expect(widthHandle(page)).toBeFocused();
  await expect.poll(() => jobCount(page), { timeout: 300 }).toBe(2);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(widthField(page)).toHaveValue("40");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(widthField(page)).toHaveValue("55");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();

  // Esc in the box throws the typing away.
  await widthHandle(page).click();
  await size.fill("30");
  await page.keyboard.press("Escape");
  await expect(size).toHaveCount(0);
  await expect(widthField(page)).toHaveValue("55");

  // A press anywhere else — another handle here — commits it instead. The
  // 55 hasn't rendered, so the box is the predicted 25 mm: 30 is +5.
  await widthHandle(page).click();
  await expect(size).toHaveValue("25");
  await size.fill("30");
  await page.getByRole("slider", { name: "Height (t)" }).click();
  await expect(size).toHaveCount(0);
  await expect(widthField(page)).toHaveValue("60");

  // So does a press on the canvas, which then does nothing else.
  await widthHandle(page).click();
  await size.fill("31");
  const viewer = await page.locator(".viewer-canvas canvas").boundingBox();
  await page.mouse.click(viewer.x + 30, viewer.y + viewer.height - 30);
  await expect(size).toHaveCount(0);
  await expect(widthField(page)).toHaveValue("61");
});

test("Enter opens the size box from the keyboard; Esc stays in it", async ({ page }) => {
  await openPlate(page);
  // Stands in for the Bench's and Holes' window Escape, which would drop
  // the selection the box belongs to.
  await page.evaluate(() => {
    window.__escapes = 0;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") window.__escapes += 1;
    });
  });
  await widthHandle(page).focus();
  await page.keyboard.press("Enter");
  const size = page.getByRole("spinbutton", { name: "Width (mm)" });
  await expect(size).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(size).toHaveCount(0);
  await expect(widthHandle(page)).toBeFocused();
  expect(await page.evaluate(() => window.__escapes)).toBe(0);

  // A digit typed and deleted again: the box shows no size, so Enter
  // sets none (DecimalInput's last report would still be the 3).
  await page.keyboard.press("Enter");
  await page.keyboard.type("3");
  await page.keyboard.press("Backspace");
  await expect(size).toHaveValue("");
  await page.keyboard.press("Enter");
  await expect(size).toHaveCount(0);
  await expect(widthField(page)).toHaveValue("40");

  await page.keyboard.press("Enter");
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect(widthField(page)).toHaveValue("42");
  await expect(widthHandle(page)).toBeFocused();
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(2);
});

test("the Grid select sets the step lengths snap to", async ({ page }) => {
  await openPlate(page);
  const grid = page.getByRole("combobox", { name: "Grid" });
  await expect(grid).toHaveValue("0.5");
  await grid.selectOption("1");
  await expect(grid).toHaveValue("1");
  // Blurred, so the next arrow key isn't the select's.
  await expect(grid).not.toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("connector-foundry.gridSnap"))).toBe("1");
  await widthHandle(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(widthField(page)).toHaveValue("41");
});

test("F, Fit and the View menu move the camera without errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  await openPlate(page);
  await page.locator(".part-header h2").click();
  await page.keyboard.press("f");
  await page.getByRole("button", { name: "Fit view" }).click();
  const view = page.getByRole("button", { name: /^View/ });
  await view.click();
  const menu = page.getByRole("menu", { name: "View" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Home", "Top", "Front", "Right"]);
  await menu.getByRole("menuitem", { name: "Top" }).click();
  await expect(menu).toHaveCount(0);
  // Looking straight down, the height handle points at the camera: hidden.
  await expect(page.getByRole("slider", { name: "Height (t)" })).toBeHidden();
  await expect(widthHandle(page)).toBeVisible();
  await view.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(view).toBeFocused();
  await view.click();
  await menu.getByRole("menuitem", { name: "Home" }).click();
  await expect(page.getByRole("slider", { name: "Height (t)" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a round part gets one diameter handle per side and a height handle", async ({ page }) => {
  await openPlate(page);
  await page.getByRole("button", { name: "Round post exact", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1);
  await expect(page.getByRole("slider", { name: "Diameter (dia)" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Height (h)" })).toBeVisible();
  await expect(widthHandle(page)).toHaveCount(0);
  // Switching parts is a step too.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("heading", { name: "Flat plate" })).toBeVisible();
});

// Every shown handle whose hit area isn't wholly inside the viewer and
// clear of the toolbar and the download buttons: one that can't be grabbed.
const outOfReach = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(".viewer-canvas").getBoundingClientRect();
    const chrome = [...document.querySelectorAll(".viewer-toolbar > *, .viewer-actions")].map((el) =>
      el.getBoundingClientRect(),
    );
    const overlaps = (a, b) =>
      !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    return [...document.querySelectorAll('.viewer-handle[data-state="shown"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const inside =
          r.left >= canvas.left &&
          r.right <= canvas.right &&
          r.top >= canvas.top &&
          r.bottom <= canvas.bottom;
        return !inside || chrome.some((c) => overlaps(r, c));
      })
      .map((el) => el.dataset.handleId);
  });
const insideViewer = (page, selector) =>
  page.evaluate((selector) => {
    const canvas = document.querySelector(".viewer-canvas").getBoundingClientRect();
    const r = document.querySelector(selector).getBoundingClientRect();
    return (
      r.left >= canvas.left && r.right <= canvas.right && r.top >= canvas.top && r.bottom <= canvas.bottom
    );
  }, selector);

test("a part that grows keeps its handles in reach before its render lands", async ({ page }) => {
  await openPlate(page);
  expect(await outOfReach(page)).toEqual([]);
  // The measured 10 mm typed up to 120: far past the view. The render
  // hasn't landed (the mock waits), so the handles stand on the predicted
  // box — and the camera has already backed out to keep them grabbable.
  await widthHandle(page).click();
  await page.getByRole("spinbutton", { name: "Width (mm)" }).fill("120");
  await page.keyboard.press("Enter");
  await expect(widthField(page)).toHaveValue("150");
  await expect(page.locator(".outside-dimensions.is-predicted")).toBeVisible();
  expect(await outOfReach(page)).toEqual([]);
  // Arrow steps walk the focused handle outward (Shift: 5 mm on the 0.5 mm
  // grid); it, and the rest, stay in reach on every press.
  await expect(widthHandle(page)).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+ArrowRight");
    expect(await outOfReach(page)).toEqual([]);
  }
  await expect(widthField(page)).toHaveValue("190");
  // A shrink never pulls the camera in: the height handle, which a width
  // change doesn't move, stays put.
  const height = page.getByRole("slider", { name: "Height (t)" });
  const before = center(await height.boundingBox());
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(widthField(page)).toHaveValue("185");
  expect(center(await height.boundingBox())).toEqual(before);
});

test("a handle's readout and the drag label stay inside the viewer", async ({ page }) => {
  await openPlate(page);
  // Grown so the camera backs out only as far as it must: the outermost
  // handles end up a few px from the viewer's edge.
  await widthHandle(page).click();
  await page.getByRole("spinbutton", { name: "Width (mm)" }).fill("120");
  await page.keyboard.press("Enter");
  await expect(widthField(page)).toHaveValue("150");
  const shown = page.locator('.viewer-handle[data-state="shown"]');
  for (let i = 0; i < (await shown.count()); i++) {
    await shown.nth(i).hover();
    await expect(page.locator(".viewer-handle-readout")).toBeVisible();
    expect(await insideViewer(page, ".viewer-handle-readout")).toBe(true);
  }
  // Dragged out past the edge, the label stays in.
  const { from, to } = await widthPull(page, 200);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 10 });
  await expect(page.locator(".viewer-drag-label")).toContainText("each side");
  expect(await insideViewer(page, ".viewer-drag-label")).toBe(true);
  await page.keyboard.press("Escape");
  await page.mouse.up();
});

test("the drag label keeps off the handles as the part narrows", async ({ page }) => {
  await openPlate(page);
  // The post's diameter matches the mock's 10 mm cube, so its handles are
  // where they would be.
  await page.getByRole("button", { name: "Round post exact", exact: true }).click();
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1);
  const handle = page.locator('[data-handle-id="xy:x+"]');
  await expect(handle).toBeVisible();
  const from = center(await handle.boundingBox());
  const far = center(await page.locator('[data-handle-id="xy:x-"]').boundingBox());
  await page.mouse.move(...from);
  await page.mouse.down();
  // Inward to the floor: the mirror comes in to meet the dragged handle,
  // passing under where the label first sat.
  const covered = [];
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(from[0] + ((far[0] - from[0]) * i) / 24, from[1] + ((far[1] - from[1]) * i) / 24);
    await expect(page.locator(".viewer-drag-label")).toBeVisible();
    covered.push(
      ...(await page.evaluate(() => {
        const label = document.querySelector(".viewer-drag-label").getBoundingClientRect();
        return [...document.querySelectorAll('.viewer-handle[data-state="shown"] .viewer-handle-dot')]
          .filter((dot) => {
            const r = dot.getBoundingClientRect();
            return !(
              r.right <= label.left ||
              r.left >= label.right ||
              r.bottom <= label.top ||
              r.top >= label.bottom
            );
          })
          .map((dot) => `${dot.parentElement.dataset.handleId} at ${label.textContent}`);
      })),
    );
  }
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(covered).toEqual([]);
});

test("seen from above, the footprint handles sit outside the part's top edge", async ({ page }) => {
  await openPlate(page);
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("menu", { name: "View" }).getByRole("menuitem", { name: "Top" }).click();
  // The mock cube is 10 × 10 × 4 mm, centred on the origin; the Top view
  // looks down on it from Home's distance, 1.6·√3 × its 10 mm radius. Its
  // top edge (2 mm up) is nearer the camera than the bottom edge the
  // handles stand on, so it projects further out: the grab target goes
  // 12 px past that, not past the bottom edge.
  const canvas = await page.locator(".viewer-canvas canvas").boundingBox();
  const middle = canvas.x + canvas.width / 2;
  const pxPerMmAt = (depth) => canvas.height / 2 / (depth * Math.tan(Math.PI / 8));
  const distance = 10 * 1.6 * Math.sqrt(3);
  const topEdge = 5 * pxPerMmAt(distance - 2);
  const x = center(await widthHandle(page).boundingBox())[0] - middle;
  expect(x).toBeGreaterThan(topEdge + 12 - 1);
  expect(x).toBeLessThan(topEdge + 12 + 1);
});

// The cube a hair wider than 10 mm, as a float STL often measures: the
// size box prefills the 3-decimal 10, which is not quite the mesh's size.
const wideCube = new STLExporter().parse(new Mesh(new BoxGeometry(10.0004, 10, 4)), { binary: true });
const wideCubeBytes = [...new Uint8Array(wideCube.buffer, wideCube.byteOffset, wideCube.byteLength)];

test("a size box closed as it opened changes nothing, even for a value off the 0.01 mm lattice", async ({
  page,
}) => {
  await catalogue(page);
  await mockWorker(page, false, wideCubeBytes);
  await page.goto("/app/");
  test.skip(!(await hasWebgl(page)), "the handles are drawn over a WebGL preview");
  await expect.poll(() => jobCount(page)).toBe(1);
  await finish(page, 0);
  await widthField(page).fill("30.333");
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1);
  const size = page.getByRole("spinbutton", { name: "Width (mm)" });
  // Enter on the untouched box...
  await widthHandle(page).click();
  await expect(size).toHaveValue("10");
  await page.keyboard.press("Enter");
  await expect(size).toHaveCount(0);
  // ...and a press elsewhere, which closes it the way a blur does: neither
  // re-rounds 30.333 to the 30.33 the 10 mm would make of it.
  await widthHandle(page).click();
  await expect(size).toBeFocused();
  const viewer = await page.locator(".viewer-canvas canvas").boundingBox();
  await page.mouse.click(viewer.x + 30, viewer.y + viewer.height - 30);
  await expect(size).toHaveCount(0);
  await expect(widthField(page)).toHaveValue("30.333");
  await page.waitForTimeout(600);
  expect(await jobCount(page)).toBe(2);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute(
    "title",
    /^Undo edit w/,
  );
});

test("a handle press takes the focus from a sidebar field, so Cmd/Ctrl+Z then undoes the drag", async ({
  page,
}) => {
  await openPlate(page);
  const depthField = page.locator(".params-panel").getByRole("spinbutton").nth(1);
  await depthField.fill("44");
  await expect(depthField).toBeFocused();
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1);
  const { from, to } = await widthPull(page, 60);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await widthField(page).inputValue())).toBeGreaterThan(40);
  await expect(depthField).not.toBeFocused();
  // The drag's step, not the field's typing.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(widthField(page)).toHaveValue("40");
  await expect(depthField).toHaveValue("44");
});

test("Cmd/Ctrl+Z in a number field the arrows stepped undoes the steps; typing keeps its own undo", async ({
  page,
}) => {
  await openPlate(page);
  await widthField(page).click();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await expect(widthField(page)).toHaveValue("43");
  // The browser has no typing to undo there: the steps are the tab's.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(widthField(page)).toHaveValue("40");
  await expect(widthField(page)).toBeFocused();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
  // Typed into, the field undoes its own text — some or all of the typing,
  // as the browser groups keystrokes — where the tab's undo would have
  // gone back to the 40 before it.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("50");
  await expect(widthField(page)).toHaveValue("50");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(widthField(page)).toHaveValue(/^5?$/);
});

test("a Tab-focused handle on the far side is shown in full, not faded", async ({ page }) => {
  await openPlate(page);
  // Home looks from the front: the depth slider's Tab stop is the back
  // edge's handle, faded behind its mirror.
  const depth = page.getByRole("slider", { name: "Depth (d)" });
  await expect(depth).toHaveAttribute("data-state", "faded");
  await depth.focus();
  await expect(depth).toHaveAttribute("data-state", "shown");
  await expect.poll(() => depth.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expect(page.locator(".viewer-handle-readout")).toHaveText("10 mm");
  await depth.blur();
  await expect(depth).toHaveAttribute("data-state", "faded");
});

test("a handle's readout goes with it when Helpers hides the handles", async ({ page }) => {
  await openPlate(page);
  await widthHandle(page).hover();
  await expect(page.locator(".viewer-handle-readout")).toHaveText("10 mm");
  await page.keyboard.press("h");
  await expect(widthHandle(page)).toHaveCount(0);
  // The pointer leaves while the handle is gone: React hears of no leave.
  const viewer = await page.locator(".viewer-canvas canvas").boundingBox();
  await page.mouse.move(viewer.x + 20, viewer.y + viewer.height - 20);
  await page.keyboard.press("h");
  await expect(widthHandle(page)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator(".viewer-handle-readout")).toHaveCount(0);
});

test("Fit right after a pan flick stays where it put the view", async ({ page }) => {
  await openPlate(page);
  const viewer = await page.locator(".viewer-canvas canvas").boundingBox();
  const at = [viewer.x + viewer.width * 0.25, viewer.y + viewer.height * 0.75];
  // A quick right-drag: OrbitControls' damping carries the pan on after
  // the release.
  await page.mouse.move(...at);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(at[0] + 120, at[1] - 60, { steps: 3 });
  await page.mouse.up({ button: "right" });
  await page.keyboard.press("f");
  const where = async () => center(await widthHandle(page).boundingBox());
  await page.waitForTimeout(100);
  const fitted = await where();
  await page.waitForTimeout(1200);
  const later = await where();
  expect(Math.hypot(later[0] - fitted[0], later[1] - fitted[1])).toBeLessThan(1);
});

test("a Settings change re-renders a committed size without its ghost or its error note", async ({
  page,
}) => {
  await openPlate(page);
  const { from, to } = await widthPull(page, 60);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
  const label = page.locator(".viewer-drag-label");
  await expect(label).toContainText("rendering…");
  await expect.poll(() => jobCount(page)).toBe(2);
  await finish(page, 1);
  await expect(label).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Fit clearance (mm)", exact: true }).fill("0.3");
  await expect.poll(() => jobCount(page)).toBe(3);
  // The render is the setting's, not the resize's.
  await expect(label).toBeHidden();
  await page.keyboard.press("Escape");
  await finish(page, 2, "Deliberate render failure");
  await expect(page.getByRole("alert")).toContainText("Deliberate render failure");
  await expect(page.locator(".viewer-error-note")).toHaveCount(0);
});
