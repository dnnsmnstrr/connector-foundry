// Home-screen icons for the web app, rendered from desktop/icon.svg (the
// one icon master) into public/icons/. They are committed — the build does
// not run this — so `npm run icons:web` after the master changes.
//
// The manifest (public/app/manifest.webmanifest) points at them with
// relative URLs ("../icons/icon-192.png"), resolved against the manifest's
// own URL, so the one file works at "/" and under "/connector-foundry/".
// JSON has no comments, so that fact lives here, and these:
// - `id` is "./" (the app's address): the identity an install keeps, so
//   a later change to start_url does not make it another app.
// - background_color is the page's own (#111214, styles.css's body),
//   Android's launch screen behind the icon; theme_color is the nav's
//   (#17181b), the status bar over it. The iOS launch screens are built,
//   not listed here (scripts/ios-splash.mjs).
// - No `shortcuts` (a long-press menu of Library, Bench, Holes): the
//   tab and the bench live in the URL's hash, so a shortcut's
//   "#mode=bench", opened in the running app, is a hash change from
//   outside — which App.jsx rightly reads as "load this bench instead"
//   and empties the bench.
//
// - icon-192 / icon-512: the master as is (a rounded tile with a
//   transparent margin), for launchers that show icons in any shape.
// - icon-maskable-512: Android cuts the icon to the launcher's shape and
//   only promises to show the central circle of 80 % diameter, so the
//   master is drawn at 74 % on a #17181b square (the app's theme colour).
//   At 74 % the tile's rounded corners reach 0.397 of the width from the
//   centre, just inside the 0.4 safe radius; at 80 % they would reach
//   0.43 and a circular mask would clip them.
// - apple-touch-icon (180 px): iOS composites a transparent icon onto
//   black and rounds the corners itself, so the master at full size on
//   the #17181b square.
import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const BACKGROUND = "#17181b";
// The master's viewBox is 0 0 SIZE SIZE.
const SIZE = 1024;
const directory = new URL("../public/icons/", import.meta.url);
const master = await readFile(new URL("../desktop/icon.svg", import.meta.url), "utf8");

// The master's drawing without its own <svg> element, so it can be placed
// scaled and offset inside another one.
const inner = master.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/);
if (!inner) throw new Error("desktop/icon.svg: no <svg> element found");
const artwork = inner[1];

/** The master drawn at `scale` of a filled square, centred. */
function onSquare(scale) {
  const offset = (SIZE * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${artwork}</g>
</svg>`;
}

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

const files = {
  "icon-192.png": png(master, 192),
  "icon-512.png": png(master, 512),
  "icon-maskable-512.png": png(onSquare(0.74), 512),
  "apple-touch-icon.png": png(onSquare(1), 180),
};
await mkdir(directory, { recursive: true });
for (const [name, bytes] of Object.entries(files)) await writeFile(new URL(name, directory), bytes);
console.log(`Generated ${Object.keys(files).join(", ")} in public/icons/ from desktop/icon.svg`);
