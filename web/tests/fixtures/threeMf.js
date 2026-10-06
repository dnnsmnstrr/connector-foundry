import { zipSync, strToU8 } from "three/examples/jsm/libs/fflate.module.js";

// A minimal, spec-shaped 3MF: one mesh object (a box of `size` model
// units, corner at the origin) placed once by the build, with the given
// `unit`. Enough to exercise the reader end to end without a binary
// fixture in the repo.
export function make3mf({ unit = "millimeter", size = [10, 10, 4], name = "Box", placements = [null] } = {}) {
  const [sx, sy, sz] = size;
  const v = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  // Outward-wound triangles of the box.
  const t = [
    [0, 2, 1], [0, 3, 2], // bottom (-z)
    [4, 5, 6], [4, 6, 7], // top (+z)
    [0, 1, 5], [0, 5, 4], // front (-y)
    [1, 2, 6], [1, 6, 5], // right (+x)
    [2, 3, 7], [2, 7, 6], // back (+y)
    [3, 0, 4], [3, 4, 7], // left (-x)
  ];
  const items = placements
    .map((m) => `<item objectid="1"${m ? ` transform="${m.join(" ")}"` : ""}/>`)
    .join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model" name="${name}">
      <mesh>
        <vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>
        <triangles>${t.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles>
      </mesh>
    </object>
  </resources>
  <build>${items}</build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
}
