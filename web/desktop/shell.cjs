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

const SHELL_VERSION = 1;
const SHELL_HASH = "43a39210d53de6061f2928dec38bbc9ab3c6070f38ed777ebe95df0621d7eeff";

module.exports = { SHELL_HASH, SHELL_VERSION };
