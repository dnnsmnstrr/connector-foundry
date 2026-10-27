import { expect, test } from "@playwright/test";
import { BoxGeometry, Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

// The app on a phone and a tablet: the stacked layout (styles.css, the
// max-width: 900px block), the coarse-pointer sizes, and what a finger can
// reach. Chromium with touch and a phone's viewport — not iOS Safari: the
// safe areas, double-tap zoom and the keyboard are not testable here.

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
  {
    id: "basics/post",
    name: "Round post",
    system: "Basics",
    confidence: "exact",
    file: "parts/basics/post.scad",
    module: "basics_post",
    defaults: { d: 12, h: 20 },
    anchors: ["bot"],
  },
];

// As app.spec.js's, every render answered with the cube unless `auto` is
// false, when renders wait (a render in flight, for the nav's state).
async function setUp(page, { auto = true } = {}) {
  await page.route("**/catalogue.json", (route) => route.fulfill({ json: { parts } }));
  await page.addInitScript(
    ({ bytes, auto }) => {
      window.Worker = class {
        postMessage(request) {
          if (request?.type === "warm" || !auto) return;
          queueMicrotask(() =>
            this.onmessage({ data: { id: request.id, type: "result", stl: new Uint8Array(bytes).buffer } }),
          );
        }
        terminate() {}
      };
    },
    { bytes: cubeBytes, auto },
  );
  // Playwright's touch emulation does not switch the pointer media
  // queries the stylesheet and the viewer key on; a phone matches both.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "pointer", value: "coarse" },
      { name: "hover", value: "none" },
    ],
  });
}

const box = async (locator) =>
  /** @type {{ x: number, y: number, width: number, height: number }} */ (await locator.boundingBox());

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test("the 3D view comes first, then the form, then the part list", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/");
    await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    const viewer = await box(page.locator(".viewer-panel"));
    const params = await box(page.locator(".params-panel"));
    const sidebar = await box(page.locator(".sidebar"));
    // The whole viewer on the first screen, under the nav and the header.
    expect(viewer.y).toBeLessThan(844 * 0.4);
    expect(viewer.y + viewer.height).toBeLessThanOrEqual(844);
    expect(params.y).toBeGreaterThanOrEqual(viewer.y + viewer.height - 1);
    expect(sidebar.y).toBeGreaterThanOrEqual(params.y + params.height - 1);
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)).toBe(true);

    // The header's buttons on one row, none of them wrapped.
    const buttons = page.locator(".part-header-actions button");
    const tops = new Set();
    for (const button of await buttons.all()) {
      const b = await box(button);
      tops.add(Math.round(b.y));
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeLessThan(50);
    }
    expect(tops.size).toBe(1);
    // The viewer's toolbar on one row.
    expect((await box(page.locator(".viewer-toolbar"))).height).toBeLessThanOrEqual(50);
  });

  test("Find a part goes to the part list's search", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/");
    await page.getByRole("button", { name: "Find a part", exact: true }).tap();
    const search = page.locator(".sidebar .search-input");
    await expect(search).toBeFocused();
    await expect(search).toBeInViewport();
    await search.fill("post");
    await page.getByRole("button", { name: /^Round post/ }).tap();
    await expect(page.getByRole("heading", { name: "Round post", level: 2 })).toBeVisible();
  });

  test("while a render runs the nav keeps every button on the screen", async ({ page }) => {
    await setUp(page, { auto: false });
    await page.goto("/app/");
    const cancel = page.locator(".render-cancel");
    await expect(cancel).toBeVisible();
    await expect(page.locator(".render-cancel-label")).toBeHidden();
    const nav = page.locator(".mode-tabs");
    expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const gear = await box(page.locator(".settings-tab"));
    expect(gear.x + gear.width).toBeLessThanOrEqual(390);
    await cancel.tap();
    await expect(cancel).toBeHidden();
  });

  test("the controls a finger uses are at least 44 px", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/");
    await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
    const small = await page.evaluate(() => {
      const scope =
        ".mode-tabs button, .mode-tabs a, .part-header-actions button, .viewer-toolbar button, .viewer-actions button";
      return [...document.querySelectorAll(scope)]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({
          label: el.getAttribute("aria-label") || el.textContent.trim(),
          rect: el.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.width < 44 || rect.height < 44)
        .map(({ label, rect }) => `${label} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    });
    expect(small).toEqual([]);
    // A number field's arrows: the only way to step a value by touch.
    const arrow = await box(page.locator(".decimal-input-arrow").first());
    expect(arrow.width).toBeGreaterThanOrEqual(30);
  });

  test("a tap on a ? opens its explanation, and a tap elsewhere closes it", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/");
    await page.locator(".settings-tab").tap();
    const tip = page.locator(".info-tip").first();
    const text = tip.locator(".info-tip-text");
    await expect(text).toBeHidden();
    await tip.locator(".info-tip-button").tap();
    await expect(text).toBeVisible();
    await page.getByRole("dialog").locator("h3").first().tap();
    await expect(text).toBeHidden();
  });

  test("the Holes tab: a first tap on a face shows its guides, the second drills", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/#mode=holes");
    await page.getByRole("option", { name: "Flat plate exact", exact: true }).tap();
    const canvas = page.locator(".bench-viewer canvas");
    await expect(canvas).toBeVisible();
    test.skip(
      !(await page.evaluate(() => !!document.createElement("canvas").getContext("webgl"))),
      "a tap on the model needs WebGL",
    );
    await expect(page.getByText(/again to drill a hole/).first()).toBeVisible();
    const view = await box(canvas);
    const spot = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    // Wait for the mesh: a tap before it is up hits nothing at all.
    await page.waitForTimeout(500);
    await page.touchscreen.tap(spot.x, spot.y);
    await page.waitForTimeout(300);
    await expect(page.locator(".holes-row")).toHaveCount(0);
    await page.touchscreen.tap(spot.x, spot.y);
    await expect(page.getByText(/Hole 1 selected/)).toBeVisible();
    await expect(page.locator(".holes-row")).toHaveCount(1);

    // Measure on, the toolbar stays one row: its Spacing menu stays out,
    // as the Grid does (the palette sets it).
    await page.getByRole("button", { name: "Measure distances" }).tap();
    await expect(page.locator(".viewer-toolbar").getByRole("combobox", { name: "Spacing" })).toBeHidden();
    expect((await box(page.locator(".viewer-toolbar"))).height).toBeLessThanOrEqual(50);

    // The snapping bar sits over the Print button, inside the view, with
    // a finger's 44 px for its toggle.
    const bar = await box(page.getByRole("group", { name: "Snapping" }));
    const print = await box(page.locator(".viewer-actions-mobile").getByRole("button", { name: "Print…" }));
    expect(bar.y + bar.height).toBeLessThanOrEqual(print.y);
    expect(bar.x).toBeGreaterThanOrEqual(view.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(view.x + view.width);
    const toggle = await box(page.getByRole("button", { name: "Snap to face features and guide lines" }));
    expect(toggle.height).toBeGreaterThanOrEqual(44);
  });

  test("the Bench's Print button is over the viewer, where a phone can reach it", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/");
    await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Open in Bench", exact: true }).tap();
    const print = page
      .locator(".bench-viewer .viewer-actions-mobile")
      .getByRole("button", { name: "Print…" });
    await expect(print).toBeInViewport();
    await print.tap();
    // A bench opened from the Library has no name yet: it is asked for
    // first, as for every export, and the sheet follows.
    await page.getByRole("dialog", { name: "Name this bench" }).getByRole("button", { name: "Export" }).tap();
    await expect(page.getByRole("dialog", { name: "Print with EasyPrint" })).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(1);
  });
});

test.describe("on a tablet in portrait", () => {
  test.use({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test("the form sits beside a viewer wide enough to use", async ({ page }) => {
    await setUp(page);
    await page.goto("/app/");
    await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
    const viewer = await box(page.locator(".viewer-panel"));
    const params = await box(page.locator(".params-panel"));
    expect(Math.abs(viewer.y - params.y)).toBeLessThan(2);
    expect(params.x).toBeLessThan(viewer.x);
    expect(viewer.width).toBeGreaterThanOrEqual(400);
    expect(viewer.y + viewer.height).toBeLessThanOrEqual(1180);
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test("the desktop layout keeps the phone-only buttons out of sight", async ({ page }) => {
  await setUp(page);
  await page.goto("/app/");
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Find a part", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Open in Bench", exact: true }).click();
  await expect(page.locator(".viewer-actions-mobile")).toBeHidden();
});
