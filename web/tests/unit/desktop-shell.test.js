import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { shellHash } from "../../scripts/shell-hash.mjs";

const { SHELL_HASH, SHELL_VERSION } = createRequire(import.meta.url)("../../desktop/shell.cjs");

// desktop/shell.cjs: an interface update loads only in apps of the shell
// version it was built with, so a change to the shell must move that
// version on, or installed apps would load an interface their shell can't
// serve and never get the shell's fix.

test("the shell's recorded fingerprint is its sources' (after a change: npm run desktop:shell)", async () => {
  assert.ok(Number.isSafeInteger(SHELL_VERSION) && SHELL_VERSION > 0);
  assert.equal(
    await shellHash(),
    SHELL_HASH,
    "The desktop shell changed (desktop/*.cjs, electron-builder.yml or Electron's version). Run `npm run desktop:shell` in web/ to move its version on.",
  );
});
