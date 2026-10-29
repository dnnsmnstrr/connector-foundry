// iOS launch screens for the app opened from the Home Screen. iOS ignores
// the manifest's background colour and shows a blank white screen while
// an installed web app starts, unless the page lists an
// `apple-touch-startup-image` whose media query matches the device and
// orientation exactly and whose image is exactly the screen's size in
// device pixels. So: one per screen size and orientation, rendered at
// build time from the icon master (desktop/icon.svg) by
// vite-plugin-ios-splash.mjs, never committed.
//
// Each is the app's background (#111214, styles.css's body) with the icon
// centred at min(28vmin, 160 pt): the same box app/index.html's boot
// splash draws, so the launch screen, the page before the app has loaded
// and the app's loading screen are one picture.
//
// Rendering a whole 2868 px screen with resvg took half a second and
// wrote 90 KB per image, 42 times a build. Only the icon is rendered; the
// PNG is assembled here, a row at a time, with PNG's "up" filter: every
// row of plain background equals the one above and filters to zeros,
// which deflate to almost nothing. Rendering the icon is still ~200 ms
// whatever its size, so the 22 sizes it is drawn at (an orientation's
// pair shares one) render at once on resvg's threads: the whole set of 44
// is ~2 MB and ~2.5 s.
import { renderAsync } from "@resvg/resvg-js";
import zlib from "node:zlib";

export const SPLASH_BACKGROUND = [0x11, 0x12, 0x14];
const BACKGROUND_HEX = "#111214";
// The icon's share of the screen's shorter side, and its cap in points.
export const SPLASH_ICON_SHARE = 0.28;
export const SPLASH_ICON_MAX_PT = 160;

// Every iPhone and iPad screen iOS 15.4 (the app's floor, public/gate.js)
// and later run on, in points (portrait) and their pixel ratio. Devices
// that share a screen share an entry.
export const IOS_SCREENS = Object.freeze([
  // iPhones
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max
  { width: 420, height: 912, ratio: 3 }, // Air
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus / Pro Max, 16 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 428, height: 926, ratio: 3 }, // 12 / 13 Pro Max, 14 Plus
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 16e (and Pros of 12 / 13)
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 / 13 mini
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 736, ratio: 3 }, // 6s–8 Plus
  { width: 375, height: 667, ratio: 2 }, // 6s–8, SE 2nd / 3rd gen
  { width: 320, height: 568, ratio: 2 }, // SE 1st gen
  // iPads
  { width: 1032, height: 1376, ratio: 2 }, // Pro 13" (M4)
  { width: 1024, height: 1366, ratio: 2 }, // Pro 12.9", Air 13"
  { width: 834, height: 1210, ratio: 2 }, // Pro 11" (M4)
  { width: 834, height: 1194, ratio: 2 }, // Pro 11", Air 11" (M2)
  { width: 820, height: 1180, ratio: 2 }, // Air 10.9", iPad 10th gen
  { width: 834, height: 1112, ratio: 2 }, // Air 10.5", Pro 10.5"
  { width: 810, height: 1080, ratio: 2 }, // iPad 10.2"
  { width: 744, height: 1133, ratio: 2 }, // mini 6th / 7th gen
  { width: 768, height: 1024, ratio: 2 }, // mini 5th gen, iPad 9.7"
]);

/**
 * Every launch image: its file name (under icons/splash/), its size in
 * pixels, its screen's pixel ratio and the media query that picks it.
 * @returns {{ file: string, width: number, height: number, ratio: number, media: string }[]}
 */
export function splashImages() {
  const images = [];
  for (const { width, height, ratio } of IOS_SCREENS) {
    for (const orientation of ["portrait", "landscape"]) {
      const landscape = orientation === "landscape";
      const w = (landscape ? height : width) * ratio;
      const h = (landscape ? width : height) * ratio;
      images.push({
        file: `splash-${w}x${h}.png`,
        width: w,
        height: h,
        ratio,
        media:
          `(device-width: ${width}px) and (device-height: ${height}px) and ` +
          `(-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
      });
    }
  }
  return images;
}

/**
 * The icon's edge in pixels on a screen of this many pixels at this ratio.
 * @param {number} width
 * @param {number} height
 * @param {number} ratio
 */
export function splashIconSize(width, height, ratio) {
  return Math.round(Math.min(SPLASH_ICON_SHARE * Math.min(width, height), SPLASH_ICON_MAX_PT * ratio));
}

/**
 * The icon master rendered on the background, `size` pixels square, as RGB
 * rows (alpha flattened: the background is opaque).
 * @param {string} masterSvg desktop/icon.svg's text, viewBox 0 0 1024 1024
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
async function iconPixels(masterSvg, size) {
  const inner = masterSvg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!inner) throw new Error("desktop/icon.svg: no <svg> element found");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${BACKGROUND_HEX}"/>${inner[1]}</svg>`;
  const rendered = await renderAsync(svg, { fitTo: { mode: "width", value: size } });
  const rgba = rendered.pixels;
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Every launch image (splashImages()) as PNG bytes, by file name.
 * @param {string} masterSvg desktop/icon.svg's text
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function renderSplashes(masterSvg) {
  /** @type {Map<number, Promise<Buffer>>} */
  const icons = new Map();
  const images = splashImages();
  const pngs = await Promise.all(
    images.map(async ({ width, height, ratio }) => {
      const size = splashIconSize(width, height, ratio);
      if (!icons.has(size)) icons.set(size, iconPixels(masterSvg, size));
      return splashPng(await icons.get(size), size, width, height);
    }),
  );
  return new Map(images.map((image, i) => [image.file, pngs[i]]));
}

/**
 * A launch image: `width` × `height` pixels of background with the icon
 * (`size` pixels square, RGB) centred, as PNG bytes (8-bit RGB).
 * @param {Buffer} icon
 * @param {number} size
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function splashPng(icon, size, width, height) {
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);
  const stride = width * 3;
  const background = Buffer.alloc(stride);
  for (let x = 0; x < width; x++) background.set(SPLASH_BACKGROUND, x * 3);

  // Each row is its filter byte, then the row minus the one above ("up").
  // A row of background under another is all zeros, as allocated: only
  // the first row, the icon's rows and the one after them are computed.
  const raw = Buffer.alloc((stride + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const out = (stride + 1) * y;
    raw[out] = 2;
    const inIcon = y >= top && y < top + size;
    if (!inIcon && previous === background) continue;
    let row = background;
    if (inIcon) {
      row = Buffer.from(background);
      icon.copy(row, left * 3, (y - top) * size * 3, (y - top + 1) * size * 3);
    }
    for (let x = 0; x < stride; x++) raw[out + 1 + x] = (row[x] - previous[x]) & 0xff;
    previous = row;
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
