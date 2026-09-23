const path = require('node:path');

const APP_URL = 'foundry://app/';
function assetPath(url, root) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'foundry:' || parsed.host !== 'app' || parsed.username || parsed.password) return null;
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { return null; }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  return target.startsWith(`${path.resolve(root)}${path.sep}`) ? target : null;
}

function isAppURL(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'foundry:' && parsed.host === 'app' && !parsed.username && !parsed.password;
  } catch { return false; }
}
module.exports = { APP_URL, assetPath, isAppURL };
