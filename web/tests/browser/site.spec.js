import { expect, test } from "@playwright/test";

// The website around the app: the landing page (index.html), the app's
// move to app/, and the guides rendered from docs/*.md. Nothing here is
// mocked — the landing page's catalogue figures are baked in at build time
// and its demos run the app's own lib/ code in the page.

test("the landing page explains the parts and leads into the app", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Connector Foundry/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /Connect any mounting system to any other/,
  );
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: /Open the app/ })
      .first(),
  ).toHaveAttribute("href", "/app/");
  // The gallery lists the catalogue's parts, as many as the "All" filter says.
  const total = Number(await page.locator('[data-filter="all"] .filter-chip-count').textContent());
  expect(total).toBeGreaterThan(30);
  await expect(page.locator(".part-card")).toHaveCount(total);
  await expect(page.locator(".part-card a").first()).toHaveAttribute("href", /^\/app\/#mode=bench&bench=/);
});

// The rest with the demos still (prefers-reduced-motion), as a visitor
// who asked for that sees them: the hero's software-rendered WebGL loop
// would otherwise slow every test it shares a machine with.
test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a link from before the app moved to app/ still opens the app", async ({ page }) => {
    await page.goto("/#mode=holes");
    await expect(page).toHaveURL(/\/app\/#mode=holes$/);
    await expect(page.getByRole("button", { name: /^Holes/ })).toBeVisible();
  });

  test("the system filter narrows the parts gallery", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator('[data-filter="gridfinity"]');
    const count = Number(await chip.locator(".filter-chip-count").textContent());
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".part-card:visible")).toHaveCount(count);
    await expect(page.locator('.part-card:visible:not([data-system="gridfinity"])')).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: `Showing ${count} parts` })).toBeAttached();
  });

  test("the Library demo resizes a bin with the app's own handle maths", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-demo="resize"]').scrollIntoViewIfNeeded();
    const width = page.getByRole("slider", { name: "Width" });
    await width.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('output[data-param="gx"]')).toHaveText("3");
    // 42 mm a unit less the 0.5 mm clearance, once the pretend render is in.
    await expect(page.locator("[data-resize-dimensions]")).toHaveText(
      "Outside: W 125.5 × H 24.55 × D 41.5 mm",
    );
    await expect(width).toHaveAttribute("aria-valuenow", "3");
    const depth = page.getByRole("slider", { name: "Depth" });
    await depth.focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('output[data-param="gy"]')).toHaveText("2");
    await expect(page.locator("[data-resize-dimensions]")).toHaveText(
      "Outside: W 125.5 × H 24.55 × D 83.5 mm",
    );
  });

  test("Cmd/Ctrl+K far from the palette demo opens the palette over the page", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox", { name: "Search the app's commands and parts" });
    await expect(input).toBeFocused();
    await input.fill("oib");
    await expect(dialog.getByRole("option").first()).toContainText("Open in Bench");
    await input.fill("gf bin");
    await expect(dialog.getByRole("option").first()).toContainText("Bin");
    await expect(dialog.locator(".palette-footer")).toContainText("opens it on the Bench");
    // Esc clears the search first, then closes, as in the app.
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("Cmd/Ctrl+K near the palette demo scrolls to it instead", async ({ page }) => {
    await page.goto("/");
    await page.locator(".palette-section .section-header").scrollIntoViewIfNeeded();
    await page.keyboard.press("ControlOrMeta+k");
    const input = page
      .locator('[data-demo="palette"]')
      .getByRole("combobox", { name: "Search the app's commands and parts" });
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });

  test("the guides are pages of their own, with their navigation", async ({ page }) => {
    await page.goto("/docs/");
    await expect(page.getByRole("heading", { level: 1, name: "Guides" })).toBeVisible();
    await page
      .getByRole("link", { name: /^Command line/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/docs\/cli\/$/);
    await expect(page).toHaveTitle("Command line · Connector Foundry");
    await expect(
      page.getByRole("navigation", { name: "Guides" }).getByRole("link", { name: "Command line" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Install" }),
    ).toBeVisible();
    // The next guide is a page on the website too.
    await page.getByRole("link", { name: "Next Bench" }).click();
    await expect(page).toHaveURL(/\/docs\/bench\/$/);
  });
});
