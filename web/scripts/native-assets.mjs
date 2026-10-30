// The iOS and Android store apps' icons and launch screens (Capacitor:
// ios/, android/), rendered from desktop/icon.svg, the one icon master.
// `npm run icons:native` after the master changes; the results are
// committed in the native projects, as the web icons are in public/icons/.
//
// This renders the sources @capacitor/assets wants into a scratch folder
// under web/ (it joins --assetPath onto the project's root, so an absolute
// path elsewhere is not found), runs it on them (through npx, pinned: it brings sharp, which the web
// build has no other use for). From them it writes every size of the
// iOS app icon and launch image, and Android's legacy, round and adaptive
// icons and splash.
//
// - icon-only (iOS, and Android's legacy icons): the master's charcoal
//   tile scaled to fill the square. The tile spans 896 of the master's
//   1024 units with corners of radius 202; at 1024/896 the corners land at
//   radius 231, where iOS's own mask (about 22.4 %) cuts anyway, and
//   Android's masks cut further in. Store icons may not be transparent, so
//   the corners outside the tile are the theme colour.
// - icon-foreground / icon-background (Android's adaptive icon): the same
//   filled tile over the theme colour. The plates sit within the central
//   66 % every launcher shape shows.
// - splash: the app's background (#111214, styles.css's body) with the
//   icon at the size the web app's launch screens use
//   (scripts/ios-splash.mjs), so the store apps start on the same picture.
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THEME = "#17181b";
const BACKGROUND = "#111214";
const SIZE = 1024;
const SPLASH = 2732;
// The master's tile, in its own units: x and y from 64 to 960.
const TILE = 896;
const ASSETS_VERSION = "3.0.5";

const master = await readFile(path.join(WEB, "desktop", "icon.svg"), "utf8");
const inner = master.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/);
if (!inner) throw new Error("desktop/icon.svg: no <svg> element found");
const artwork = inner[1];

/** The master scaled by `scale` about its centre, on `fill` (or nothing). */
function square(scale, fill) {
  const offset = (SIZE * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  ${fill ? `<rect width="${SIZE}" height="${SIZE}" fill="${fill}"/>` : ""}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${artwork}</g>
</svg>`;
}

/** The icon at min(28vmin, 160pt) of a square splash, as the launch screens have it. */
function splash() {
  const icon = Math.min(0.28 * SPLASH, 160 * 3);
  const offset = (SPLASH - icon) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPLASH} ${SPLASH}">
  <rect width="${SPLASH}" height="${SPLASH}" fill="${BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${icon / SIZE})">${artwork}</g>
</svg>`;
}

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
const solid = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${fill}"/></svg>`;

const filled = SIZE / TILE;
const SCRATCH = ".native-assets";
const dir = path.join(WEB, SCRATCH);
await rm(dir, { recursive: true, force: true });
await mkdir(dir);
try {
  await writeFile(path.join(dir, "icon-only.png"), png(square(filled, THEME), SIZE));
  await writeFile(path.join(dir, "icon-foreground.png"), png(square(filled, null), SIZE));
  await writeFile(path.join(dir, "icon-background.png"), png(solid(THEME), SIZE));
  await writeFile(path.join(dir, "splash.png"), png(splash(), SPLASH));
  await writeFile(path.join(dir, "splash-dark.png"), png(splash(), SPLASH));
  execFileSync(
    "npx",
    [
      "--yes",
      `@capacitor/assets@${ASSETS_VERSION}`,
      "generate",
      "--assetPath",
      SCRATCH,
      "--iconBackgroundColor",
      THEME,
      "--iconBackgroundColorDark",
      THEME,
      "--splashBackgroundColor",
      BACKGROUND,
      "--splashBackgroundColorDark",
      BACKGROUND,
      "--ios",
      "--android",
    ],
    { cwd: WEB, stdio: "inherit" },
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
