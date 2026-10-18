const path = require("node:path");

const APP_URL = "foundry://app/";
// The build's index.html is the website's landing page; the app itself is
// app/index.html. The desktop shell serves the app at the origin's root, so
// its URL (and every bench link written into it) stays foundry://app/#…
// and the landing page is never shown. The app's own assets are absolute
// paths (Vite's base is "/" outside the Pages build), so they resolve the
// same from either directory.
const APP_PAGE = "/app/index.html";
function assetPath(url, root) {
  const parsed = new URL(url);
  if (parsed.protocol !== "foundry:" || parsed.host !== "app" || parsed.username || parsed.password)
    return null;
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const target = path.resolve(root, `.${pathname === "/" ? APP_PAGE : pathname}`);
  return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
}

function isAppURL(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "foundry:" && parsed.host === "app" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
module.exports = { APP_URL, assetPath, isAppURL };
