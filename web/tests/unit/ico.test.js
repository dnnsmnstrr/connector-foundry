import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { buildIco, pngSize, readIco } from '../../scripts/ico.mjs';

const svg = await readFile(new URL('../../desktop/icon.svg', import.meta.url));
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

test('a Windows icon lists every rendered size and stores each as the PNG it was given', () => {
  const sizes = [16, 32, 256];
  const images = sizes.map(render);
  const ico = buildIco(images);
  // ICONDIR: reserved 0, type 1 (icon), count.
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3]);
  const entries = readIco(ico);
  assert.deepEqual(entries.map((e) => e.width), sizes);
  assert.deepEqual(entries.map((e) => e.height), sizes);
  // 256 is encoded as 0 in the one-byte width field, and is a PNG like the rest.
  assert.equal(ico[6 + 16 * 2], 0);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.png, true);
    assert.ok(entry.image.equals(images[index]), `image ${index} is stored unchanged`);
    assert.deepEqual(pngSize(entry.image), { width: sizes[index], height: sizes[index] });
  }
  // Images are packed back to back right after the directory.
  assert.equal(entries[0].offset, 6 + 16 * 3);
  assert.equal(entries.at(-1).offset + entries.at(-1).bytes, ico.length);
});

test('a Windows icon refuses what Windows would not display', () => {
  assert.throws(() => buildIco([]), RangeError);
  assert.throws(() => buildIco([render(512)]), /at most 256/);
  assert.throws(() => buildIco([Buffer.from('not a png')]), TypeError);
  assert.throws(() => readIco(Buffer.from([0, 0, 2, 0, 1, 0])), /Not an icon/); // type 2 is a cursor
  assert.throws(() => readIco(buildIco([render(16)]).subarray(0, 20)), RangeError);
});
