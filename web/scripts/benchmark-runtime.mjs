// Run against `npm run dev -- --port 4176`. Uses fresh pages and unique
// source strings to measure actual renders, not the application's mesh cache.
import { chromium, webkit } from '@playwright/test';

const url = process.env.BENCHMARK_URL || 'http://127.0.0.1:4176';
for (const [name, runtime] of Object.entries({ chromium, webkit })) {
  let browser;
  try {
    browser = await runtime.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector('.render-button:disabled'));
    const results = await page.evaluate(async () => {
      const { renderPart, cancelRenders } = await import('/src/lib/openscad-client.js');
      cancelRenders();
      const results = [];
      for (const [part, source] of [
        ['plate', 'include <../parts/basics/plate.scad>; basics_plate(w=40,d=40,t=4,r=3);'],
        ['gridfinity', 'include <../parts/gridfinity/base.scad>; gf_base(gx=2,gy=2);'],
      ]) {
        for (let i = 0; i < 4; i++) {
          const start = performance.now();
          const stl = await renderPart({ scadSource: `${source}\n// trial ${i}` });
          results.push({ part, trial: i, ms: Math.round(performance.now() - start), bytes: stl.byteLength });
        }
      }
      return results;
    });
    console.log(JSON.stringify({ runtime: name, version: browser.version(), results }));
  } catch (error) {
    console.log(JSON.stringify({ runtime: name, error: error.message }));
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}
