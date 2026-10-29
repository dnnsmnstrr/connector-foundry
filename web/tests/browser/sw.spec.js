import { expect, test } from "@playwright/test";
import fs from "node:fs";

// The service worker (src/sw.js, emitted as sw.js at the base) and the home-screen
// files, against the built app. The suite blocks service workers for every
// other test, so that a worker left over from one test cannot serve a
// cached page to the next; this file wants the real thing.
test.use({ serviceWorkers: "allow" });
// One at a time: the deploy test below rewrites dist/sw.js, which a test
// running beside it would register halfway through.
test.describe.configure({ mode: "serial" });

// The built worker, which `vite preview` reads from disk on every request.
const SW_FILE = new URL("../../dist/sw.js", import.meta.url);

test("the worker caches the app's hashed chunks for the next visit", async ({ page }) => {
  await page.goto("/app/");
  // Registration happens after load; `ready` resolves once the worker is
  // active, and it claims the page then (no reload needed for that), but
  // the chunks loaded before it took over were not seen by it.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  // The app has no h1; the Library's part list is its first content.
  await expect(page.locator(".part-button").first()).toBeVisible();

  const chunk = await page.evaluate(() =>
    [...document.scripts].map((s) => s.src).find((src) => src.includes("/assets/")),
  );
  expect(chunk).toMatch(/\/assets\/.+\.js$/);
  expect(await page.evaluate(() => caches.keys())).toEqual([expect.stringMatching(/^cf-[0-9a-z]+$/)]);
  // Stored behind the response, so a moment after the page had it. Vite's
  // preview answers with `Vary: Origin` and a module script is requested
  // with an Origin header, so a lookup from here, without one, ignores
  // Vary as the worker's own do.
  const cached = (url, options = {}) =>
    page.evaluate(
      ([url, options]) => caches.match(url, { ignoreVary: true, ...options }).then((hit) => !!hit),
      [url, options],
    );
  await expect.poll(() => cached(chunk)).toBe(true);
  // The page itself, for the offline fallback.
  await expect
    .poll(() => page.evaluate(() => location.href).then((href) => cached(href, { ignoreSearch: true })))
    .toBe(true);

  // The render worker is under assets/, so it is in the worker's scope
  // too: once a part has rendered, the engine it compiled, its own chunk
  // and the .scad bundle (versioned by its content) are kept as well —
  // the bulk of what a returning phone would otherwise download again.
  await expect(page.getByRole("button", { name: "Download STL", exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  const keys = () =>
    page.evaluate(async () => {
      const names = await caches.keys();
      const all = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
      return all.flat().map((request) => new URL(request.url).pathname + new URL(request.url).search);
    });
  await expect
    .poll(keys)
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/assets\/openscad-[0-9a-f]+-[\w-]+\.wasm$/),
        expect.stringMatching(/^\/assets\/openscad-worker-[\w-]+\.js$/),
        expect.stringMatching(/^\/scad-bundle\.json\?v=[0-9a-f]{10}$/),
      ]),
    );
});

test("the manifest and its icons are served, and agree with the page", async ({ page, request }) => {
  await page.goto("/app/");
  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((link) => link.href);
  const manifest = await request.get(manifestUrl);
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toMatch(/json/);
  const json = await manifest.json();
  expect(json.name).toBe("Connector Foundry");
  expect(json.display).toBe("standalone");
  expect(json.icons.map((icon) => icon.purpose ?? "any")).toEqual(["any", "any", "maskable"]);
  // Relative to the manifest, so the same file works under any base.
  for (const icon of json.icons) {
    const response = await request.get(new URL(icon.src, manifestUrl).href);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"], icon.src).toBe("image/png");
  }
  expect(json.theme_color).toBe(
    await page.locator('meta[name="theme-color"]').evaluate((meta) => meta.getAttribute("content")),
  );
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').evaluate((link) => link.href);
  const response = await request.get(touchIcon);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  // Chrome's own verdict, what Android's install offer needs: the manifest
  // parses cleanly and nothing stands in the way of installing (the
  // worker, the icons, the display mode). Its checks run once the worker
  // controls the page.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await page.context().newCDPSession(page);
  const { errors } = await cdp.send("Page.getAppManifest");
  expect(errors).toEqual([]);
  await expect
    .poll(async () => (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors)
    .toEqual([]);

  // The install's identity, and Android's launch screen in the page's own colour.
  expect(new URL(json.id, manifestUrl).href).toBe(new URL(json.start_url, manifestUrl).href);
  expect(json.background_color).toBe("#111214");

  // iOS's launch screens (scripts/ios-splash.mjs): every one listed is
  // served, at the size its media query is for.
  const splashes = await page
    .locator('link[rel="apple-touch-startup-image"]')
    .evaluateAll((links) => links.map((link) => ({ href: link.href, media: link.media })));
  expect(splashes.length).toBe(44);
  const iphone16Pro = splashes.find(
    (splash) => splash.media.includes("(device-width: 402px)") && splash.media.includes("portrait"),
  );
  expect(iphone16Pro.href).toMatch(/\/icons\/splash\/splash-1206x2622\.png$/);
  const png = await request.get(iphone16Pro.href);
  expect(png.status()).toBe(200);
  const bytes = await png.body();
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1206, 2622]);
});

test("a deploy reaches an app left open: it offers to reload, and says it updated", async ({ page }) => {
  const original = fs.readFileSync(SW_FILE, "utf8");
  const id = original.match(/const BUILD_ID = "([^"]+)"/)[1];
  await page.goto("/app/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const reload = page.getByRole("button", { name: "Reload to update" });
  await expect(reload).toHaveCount(0);

  try {
    // The next deploy: the same worker under another build id (as long as
    // this one, though the preview server reads the file afresh anyway).
    fs.writeFileSync(SW_FILE, original.replace(`"${id}"`, `"${"z".repeat(id.length)}"`));
    // What coming back to the foreground does by itself, asked for by
    // hand: the palette's Check for updates.
    await page.getByRole("button", { name: "Command palette" }).click();
    await page.keyboard.type("check for updates");
    await page.keyboard.press("Enter");
    await expect(reload).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".command-hud")).toHaveText("A new version is ready. Reload to update.");

    // Nothing on the Holes tab to lose, so no question first.
    await Promise.all([page.waitForEvent("load"), reload.click()]);
    await expect(page.locator(".command-hud")).toHaveText("Updated to the latest version");
    await expect(reload).toHaveCount(0);
  } finally {
    fs.writeFileSync(SW_FILE, original);
  }
});
