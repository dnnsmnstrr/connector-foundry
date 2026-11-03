// The shell's version: what an interface update (desktop/web-bundle.cjs)
// must have been built for to load in this app. The shell is everything
// the installed app runs from outside its web bundle: the main process,
// the preload, the packaging and Electron itself. A bundle carries the
// version it was built with, and the app loads only bundles of its own;
// any other release reaches it as the full update.
//
// SHELL_HASH is the fingerprint of those files (scripts/shell-hash.mjs),
// and tests/unit/desktop-shell.test.js fails when it no longer matches:
// after changing the shell, run `npm run desktop:shell` in web/, which
// moves the version on and records the new fingerprint. Not in the hash
// itself, so recording it doesn't change it.

const SHELL_VERSION = 2;
const SHELL_HASH = "b66a8baf8bd8e65e85c0c543ed772526273b5203185b9c35c21593379f8888f9";

module.exports = { SHELL_HASH, SHELL_VERSION };
