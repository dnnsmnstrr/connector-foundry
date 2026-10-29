// iOS launch screens (scripts/ios-splash.mjs says why there are 44): a
// build renders them from desktop/icon.svg into <outDir>/icons/splash/
// and lists them in the app's page as `apple-touch-startup-image` links,
// each with the media query that picks it. Builds only: iOS reads them
// when the app is added to the Home Screen, which is never from the dev
// server, and rendering them takes a few seconds.
//
// The links are added here rather than written into app/index.html: 44
// of them would bury the page's own head, and their URLs need Vite's base
// ("/connector-foundry/" on GitHub Pages), which tags added at this stage
// are not rewritten to.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSplashes, splashImages } from "./ios-splash.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(WEB, "desktop", "icon.svg");
export const SPLASH_DIR = "icons/splash";

/**
 * The link tags for the app's page.
 * @param {string} base Vite's base, ending in "/"
 * @returns {import("vite").HtmlTagDescriptor[]}
 */
export function splashTags(base) {
  return splashImages().map(({ file, media }) => ({
    tag: "link",
    attrs: { rel: "apple-touch-startup-image", media, href: `${base}${SPLASH_DIR}/${file}` },
    injectTo: "head",
  }));
}

export default function iosSplashPlugin() {
  let base = "/";
  let building = false;
  return {
    name: "foundry-ios-splash",
    /** @param {import("vite").ResolvedConfig} config */
    configResolved(config) {
      base = config.base;
      building = config.command === "build";
    },
    transformIndexHtml(_html, ctx) {
      // The app's page only: the landing page and the guides are never
      // what a Home Screen icon opens.
      if (!building || !ctx.path.startsWith("/app/")) return [];
      return splashTags(base);
    },
    async generateBundle() {
      const pngs = await renderSplashes(fs.readFileSync(MASTER, "utf8"));
      for (const [file, source] of pngs) {
        this.emitFile({ type: "asset", fileName: `${SPLASH_DIR}/${file}`, source });
      }
    },
  };
}
