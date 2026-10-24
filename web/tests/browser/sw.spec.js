import { expect, test } from "@playwright/test";

// The service worker (src/sw.js, emitted as sw.js at the base) and the home-screen
// files, against the built app. The suite blocks service workers for every
// other test, so that a worker left over from one test cannot serve a
// cached page to the next; this file wants the real thing.
test.use({ serviceWorkers: "allow" });

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
});
