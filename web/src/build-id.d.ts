// Defined at build time (an empty object under the dev server) by
// scripts/vite-plugin-sw.mjs: an unhashed public file's name → a hash of
// its content, which lib/publicAsset.js puts in the file's URL so the
// service worker (src/sw.js) can keep it until it changes.
declare const __PUBLIC_VERSIONS__: Record<string, string>;
// This build's id (the commit on CI), which names the service worker's
// cache and which a worker that took over reports (lib/webApp.js); "dev"
// under the dev server.
declare const __BUILD_ID__: string;
