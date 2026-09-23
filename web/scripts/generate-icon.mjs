import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('macOS is required for iconutil. Run npm run icon on a Mac.');
}
const directory = new URL('../desktop/generated/', import.meta.url);
const iconset = new URL('ConnectorFoundry.iconset/', directory);
const svg = await readFile(new URL('../desktop/icon.svg', import.meta.url));
await mkdir(iconset, { recursive: true });

// Render every size from the vectors, rather than repeatedly resampling a PNG.
// Both standard and Retina representations are required by Apple's iconutil.
const images = new Map();
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  images.set(size, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
for (const size of [16, 32, 128, 256, 512]) {
  await writeFile(new URL(`icon_${size}x${size}.png`, iconset), images.get(size));
  await writeFile(new URL(`icon_${size}x${size}@2x.png`, iconset), images.get(size * 2));
}
await writeFile(new URL('icon.png', directory), images.get(1024));
execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', fileURLToPath(new URL('icon.icns', directory)), fileURLToPath(iconset)], { stdio: 'inherit' });
console.log('Generated desktop/generated/icon.icns, icon.png, and ConnectorFoundry.iconset from desktop/icon.svg');
