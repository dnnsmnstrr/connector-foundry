import { expect, test } from "@playwright/test";

// public/gate.js against the built app: an engine that lacks what the app
// needs gets the "update" message and no app, a chunk that fails to
// download gets "reload", and a stylesheet that fails changes nothing.

test("an engine without Array.prototype.at is told to update, and no app mounts", async ({ page }) => {
  await page.addInitScript(() => {
    delete Array.prototype.at;
  });
  await page.goto("/app/");
  await expect(page.getByRole("alert")).toContainText("This browser can't run Connector Foundry");
  await expect(page.getByRole("alert")).toContainText("Safari or iOS 15.4");
  await expect(page.locator(".mode-tabs")).toHaveCount(0);
});

test("the app's chunk failing to download asks for a reload, not an update", async ({ page }) => {
  await page.route(/\/assets\/app-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/app/");
  await expect(page.getByRole("alert")).toContainText("couldn't load");
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("a stylesheet that fails to download leaves the app running", async ({ page }) => {
  await page.route(/\/assets\/app-[^/]+\.css$/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/app/");
  await expect(page.locator(".mode-tabs")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
