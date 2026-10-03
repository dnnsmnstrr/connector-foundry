import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIco } from './ico.mjs';

const directory = new URL('../desktop/generated/', import.meta.url);
const svg = await readFile(new URL('../desktop/icon.svg', import.meta.url));
await mkdir(directory, { recursive: true });

// Render every size from the vectors, rather than repeatedly resampling a PNG.
const images = new Map();
function render(size) {
  if (!images.has(size)) images.set(size, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  return images.get(size);
}

// Windows: one .ico carrying the sizes Explorer, the taskbar, the Start menu
// and the installer pick from. electron-builder needs the 256 px entry.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
await writeFile(new URL('icon.ico', directory), buildIco(ICO_SIZES.map(render)));
// Full-size preview, the development Dock icon on macOS, and the Linux icon.
await writeFile(new URL('icon.png', directory), render(1024));
const generated = ['icon.ico', 'icon.png'];

// macOS: Apple's iconutil assembles the .icns from standard and Retina PNGs.
// It only exists on a Mac, which is also the only place the .icns is needed.
if (process.platform === 'darwin') {
  const iconset = new URL('ConnectorFoundry.iconset/', directory);
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await writeFile(new URL(`icon_${size}x${size}.png`, iconset), render(size));
    await writeFile(new URL(`icon_${size}x${size}@2x.png`, iconset), render(size * 2));
  }
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', fileURLToPath(new URL('icon.icns', directory)), fileURLToPath(iconset)], { stdio: 'inherit' });
  generated.push('icon.icns', 'ConnectorFoundry.iconset');
}
console.log(`Generated ${generated.join(', ')} in desktop/generated/ from desktop/icon.svg`);
