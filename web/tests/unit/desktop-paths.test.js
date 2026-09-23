import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { assetPath, isAppURL } = createRequire(import.meta.url)('../../desktop/paths.cjs');

test('desktop protocol serves only bundled assets, including encoded names', () => {
  assert.equal(assetPath('foundry://app/', '/bundle/dist'), '/bundle/dist/index.html');
  assert.equal(assetPath('foundry://app/assets/a%20b.js', '/bundle/dist'), '/bundle/dist/assets/a b.js');
  for (const url of ['https://app/index.html', 'foundry://elsewhere/index.html', 'foundry://app/%2e%2e%2fsecret', 'foundry://app/%00', 'foundry://app/%ZZ', 'foundry://app/a%5c..%5csecret', 'foundry://user@app/']) {
    assert.equal(assetPath(url, '/bundle/dist'), null, url);
  }
  assert.equal(isAppURL('foundry://app/#mode=bench'), true);
  assert.equal(isAppURL('file:///etc/passwd'), false);
  assert.equal(isAppURL('broken'), false);
});
