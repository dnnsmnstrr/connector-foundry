import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import {
  IOS_SCREENS,
  SPLASH_BACKGROUND,
  splashIconSize,
  splashImages,
  splashPng,
} from "../../scripts/ios-splash.mjs";
import iosSplashPlugin, { SPLASH_DIR, splashTags } from "../../scripts/vite-plugin-ios-splash.mjs";

/** The pixels of an 8-bit RGB PNG written with filter 0 or 2 on every row. */
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    assert.equal(png.readUInt32BE(at + 8 + length), zlib.crc32(png.subarray(at + 4, at + 8 + length)), type);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.deepEqual([body[8], body[9]], [8, 2]);
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * 3;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const up = y > 0 && filter === 2 ? pixels[(y - 1) * stride + x] : 0;
      pixels[y * stride + x] = (value + up) & 0xff;
    }
  }
  return { width, height, pixels };
}

test("one launch image per screen and orientation, each named for its size", () => {
  const images = splashImages();
  assert.equal(images.length, IOS_SCREENS.length * 2);
  assert.equal(new Set(images.map((image) => image.file)).size, images.length);
  const pro = images.filter((image) => image.media.includes("(device-width: 402px)"));
  assert.deepEqual(
    pro.map(({ file, width, height }) => ({ file, width, height })),
    [
      { file: "splash-1206x2622.png", width: 1206, height: 2622 },
      { file: "splash-2622x1206.png", width: 2622, height: 1206 },
    ],
  );
  // device-width and device-height are the portrait size in either
  // orientation; only the orientation feature tells them apart.
  assert.equal(
    pro[1].media,
    "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
  );
});

test("the icon is 28 % of the shorter side, capped at 160 pt — the boot splash's min(28vmin, 160px)", () => {
  assert.equal(splashIconSize(1206, 2622, 3), Math.round(0.28 * 1206));
  assert.equal(splashIconSize(2622, 1206, 3), Math.round(0.28 * 1206));
  assert.equal(splashIconSize(2048, 2732, 2), 320);
});

test("a launch image is the background with the icon's pixels in the middle", () => {
  const size = 4;
  const icon = Buffer.alloc(size * size * 3, 0xee);
  const { width, height, pixels } = decode(splashPng(icon, size, 10, 12));
  assert.deepEqual([width, height], [10, 12]);
  const at = (x, y) => [...pixels.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
  assert.deepEqual(at(0, 0), SPLASH_BACKGROUND);
  assert.deepEqual(at(9, 11), SPLASH_BACKGROUND);
  // Centred: (10 - 4) / 2 = 3 across, (12 - 4) / 2 = 4 down.
  assert.deepEqual(at(3, 4), [0xee, 0xee, 0xee]);
  assert.deepEqual(at(6, 7), [0xee, 0xee, 0xee]);
  assert.deepEqual(at(2, 4), SPLASH_BACKGROUND);
  assert.deepEqual(at(3, 8), SPLASH_BACKGROUND);
});

test("the app's page links every image under the site's base, in builds only", () => {
  const tags = splashTags("/connector-foundry/");
  assert.equal(tags.length, splashImages().length);
  assert.deepEqual(tags[0].attrs, {
    rel: "apple-touch-startup-image",
    media: splashImages()[0].media,
    href: `/connector-foundry/${SPLASH_DIR}/${splashImages()[0].file}`,
  });

  const plugin = iosSplashPlugin();
  plugin.configResolved(/** @type {any} */ ({ base: "/", command: "serve" }));
  assert.deepEqual(plugin.transformIndexHtml("", { path: "/app/index.html" }), []);
  plugin.configResolved(/** @type {any} */ ({ base: "/", command: "build" }));
  assert.equal(plugin.transformIndexHtml("", { path: "/app/index.html" }).length, tags.length);
  // The landing page and the guides are never what a Home Screen icon opens.
  assert.deepEqual(plugin.transformIndexHtml("", { path: "/index.html" }), []);
});
