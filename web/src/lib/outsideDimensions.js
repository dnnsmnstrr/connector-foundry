// Human-readable outside bounding-box dimensions. STL axes map to the
// product vocabulary as X = width, Z = height, and Y = depth.
function formatMillimetres(value) {
  // OpenSCAD/three.js calculations can leave tiny floating-point tails
  // (for example 39.9999999997). Three decimals keeps useful precision
  // without presenting those implementation details to makers.
  return Number(value.toFixed(3)).toString();
}

export function outsideDimensions(extents) {
  if (!extents || extents.length !== 3 || extents.some((value) => !Number.isFinite(value))) return null;
  const [width, depth, height] = extents;
  return {
    width: formatMillimetres(width),
    height: formatMillimetres(height),
    depth: formatMillimetres(depth),
  };
}
