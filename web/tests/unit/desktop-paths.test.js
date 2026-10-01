import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const { assetPath, isAppURL } = createRequire(import.meta.url)('../../desktop/paths.cjs');

// The bundle root as the main process sees it: a POSIX path on macOS and
// Linux, a drive-letter path with backslashes on Windows.
const root = path.resolve('/bundle/dist');

test('desktop protocol serves only bundled assets, including encoded names', () => {
  assert.equal(assetPath('foundry://app/', root), path.join(root, 'index.html'));
  assert.equal(assetPath('foundry://app/assets/a%20b.js', root), path.join(root, 'assets', 'a b.js'));
  for (const url of ['https://app/index.html', 'foundry://elsewhere/index.html', 'foundry://app/%2e%2e%2fsecret', 'foundry://app/%00', 'foundry://app/%ZZ', 'foundry://app/a%5c..%5csecret', 'foundry://user@app/']) {
    assert.equal(assetPath(url, root), null, url);
  }
  assert.equal(isAppURL('foundry://app/#mode=bench'), true);
  assert.equal(isAppURL('file:///etc/passwd'), false);
  assert.equal(isAppURL('broken'), false);
});

test('desktop protocol never serves a file outside the bundle', () => {
  // The URL parser folds literal dot segments before the path check sees
  // them, so these stay inside the bundle and are served.
  assert.equal(assetPath('foundry://app/../dist-secrets/key', root), path.join(root, 'dist-secrets', 'key'));
  assert.equal(assetPath('foundry://app/assets/../../other/index.html', root), path.join(root, 'other', 'index.html'));
  // Encoded slashes hide the traversal from the parser; the resolved path
  // is compared against the bundle root with a trailing separator, so a
  // sibling directory sharing the root's name prefix is outside as well.
  assert.equal(assetPath('foundry://app/..%2f..%2fetc%2fpasswd', root), null);
  assert.equal(assetPath('foundry://app/assets%2f..%2f..%2fother', root), null);
  assert.equal(assetPath('foundry://app/..%2fdist-secrets%2fkey', root), null);
  // A traversal that lands back inside the bundle is fine.
  assert.equal(assetPath('foundry://app/assets%2f..%2findex.html', root), path.join(root, 'index.html'));
});
