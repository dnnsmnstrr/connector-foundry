// Defined at build time (an empty object under the dev server) by
// scripts/vite-plugin-sw.mjs: an unhashed public file's name → a hash of
// its content, which lib/publicAsset.js puts in the file's URL so the
// service worker (src/sw.js) can keep it until it changes.
declare const __PUBLIC_VERSIONS__: Record<string, string>;
