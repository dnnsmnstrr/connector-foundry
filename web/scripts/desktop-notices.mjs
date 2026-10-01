import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep notices next to the compiled application, including upstream SCAD
// notices that a JS bundler cannot discover.
const root = new URL('../../', import.meta.url).pathname;
let notices = '# Connector Foundry — bundled third-party notices\n\n';
notices += 'The OpenSCAD WASM package declares GPL-2.0. The STEP reader (occt-import-js, bundling Open CASCADE Technology) is LGPL-2.1 with the OCCT exception. Geometry sources and meshes have separate licenses; see SOURCE-README.md in this app bundle. This file does not relicense them.\n\n';
for (const base of ['vendor', 'web/node_modules']) {
  // occt-import-js keeps its own licence at the package root and OCCT's
  // (plus the exception text) under dist/, so that directory is scanned too.
  const names = base === 'vendor' ? (await readdir(path.join(root, base), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : ['react', 'react-dom', 'scheduler', 'loose-envify', 'js-tokens', 'three', 'js-yaml', 'argparse', 'openscad-wasm', 'occt-import-js', 'occt-import-js/dist'];
  for (const name of names) {
    const directory = path.join(root, base, name);
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)(\.|$)/i.test(entry.name))) {
      notices += `\n## ${base}/${name}/${file.name}\n\n${await readFile(path.join(directory, file.name), 'utf8')}\n`;
    }
  }
}
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/THIRD-PARTY-NOTICES.txt', import.meta.url), notices);
