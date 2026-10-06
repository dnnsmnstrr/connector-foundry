// Snapping for the Holes tab: the significant points on the flat face
// under the cursor — its center, the center of each quadrant, the center
// of every hole already through it, a point set in from each corner, and
// where the face's guide lines cross — so a screw hole lands exactly on
// one of those instead of wherever the click happened to fall. Edge
// midpoints are deliberately not offered: a screw on the edge of a face
// is never where one goes.
//
// Guide lines (`face.guides`) are drawn by the viewer while the face is
// hovered: the two center lines and four quarter lines of the face's
// bounding box, clipped to its outline; a radial line from the center
// out through each corner inset to its corner; and a circle of a chosen
// radius around the center (a bolt circle). Where the circle meets the
// center lines and the radials are snap points too, and a click that is
// near a line but not near any point slides onto the line
// (nearestGuide()) — a hole anywhere along the center line or around the
// circle, placed by eye but exactly on it.
//
// Built on faceCluster.js's flood fill: the cluster is the whole
// connected coplanar patch the hit triangle belongs to; its outline is
// the set of cluster edges with no cluster triangle on the other side,
// chained into loops. On a consistently wound mesh (meshValidate.js's
// output, or anything OpenSCAD exports) the outer loop runs
// counter-clockwise seen from outside and every hole loop clockwise, so
// the signed area tells them apart. Loops are simplified to their real
// corners (consecutive collinear segments merged — a flat face
// tessellates into many triangles, and a straight edge arrives as a
// chain of short pieces), so a side is one edge, not a chain of
// triangle edges. A rounded corner arrives as a fan of short segments,
// which the minimum-edge-length filter keeps from counting as sides of
// their own.
//
// Everything is cached per geometry: each analysed face is stored under
// a key (its lowest triangle index) and every triangle in it maps to
// that key, so hovering across a face costs a lookup, not a flood fill.
// The parts that depend on the settings (inset, radius) are redone when
// those change.
import { clusterFace } from "./faceCluster.js";
import { cross, distance, planeBasis, unit } from "./screwHoles.js";

// A corner's inset point (see cornerInsets) is this far from each edge
// unless the caller says otherwise — far enough for an M3 counterbore.
export const DEFAULT_CORNER_INSET_MM = 5;
// The center circle's radius unless the caller says otherwise; 0 draws
// none.
export const DEFAULT_CENTER_RADIUS_MM = 10;
// Two candidates closer than this are the same place; the one listed
// first (hole centers before everything else) wins.
const DEDUPE_MM = 0.3;
// Grid for free placement with snapping on: the click rounds to this
// in the face's own frame, measured from the face center.
export const FREE_GRID_MM = 0.5;
// A click sliding onto the circle rounds to this many degrees around it.
const CIRCLE_STEP_DEG = 1;
const CIRCLE_SEGMENTS = 72;

const cacheByGeometry = new WeakMap();

function cacheFor(geometry) {
  let cache = cacheByGeometry.get(geometry);
  if (!cache || cache.index !== geometry.index) {
    cache = { index: geometry.index, faceOf: new Map(), faces: new Map() };
    cacheByGeometry.set(geometry, cache);
  }
  return cache;
}

// The analysed face for the triangle `faceIndex` of an indexed, welded
// geometry (see faceCluster.js for why it has to be indexed). Returns
//   { key, center, normal, u, v, extent: [w, h], triangleCount,
//     loops: [{ outer, points: [[x,y,z], ...], uv, center, radius }],
//     candidates: [{ id, kind, point, label }],
//     guides: [...] }
// A guide is a straight piece — { kind: "center" | "quarter" | "radial",
// a, b (3D ends), auv, buv (the same in the face's frame) } — or the
// circle, { kind: "circle", radius, points: [[x,y,z], ...] } (a closed
// polyline, in order). A line that leaves and re-enters an L-shaped
// face is several pieces.
// `options.inset` is the corner inset in mm, `options.radius` the
// center circle's; candidates and guides are redone when either
// changes — as a fresh record replacing the cached one, so a caller
// comparing records by identity (a React memo) sees the change.
// null for a triangle index this geometry doesn't have — a face kept
// from a mesh since replaced — rather than reading past its end.
export function analyzeFace(geometry, faceIndex, options = {}) {
  const triangles = (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= triangles) return null;
  const inset = options.inset ?? DEFAULT_CORNER_INSET_MM;
  const radius = options.radius ?? DEFAULT_CENTER_RADIUS_MM;
  const cache = cacheFor(geometry);
  let key = cache.faceOf.get(faceIndex);
  let face = key !== undefined ? cache.faces.get(key) : null;
  if (!face) {
    face = buildFace(geometry, faceIndex);
    for (const t of face.triangles) cache.faceOf.set(t, face.key);
    cache.faces.set(face.key, face);
  }
  if (face.inset !== inset || face.radius !== radius) {
    face = { ...face, inset, radius };
    const corners = cornerInsets(face, inset);
    face.guides = buildGuides(face, corners, radius);
    face.candidates = buildCandidates(face, corners, radius);
    cache.faces.set(face.key, face);
  }
  return face;
}

function buildFace(geometry, faceIndex) {
  const cluster = clusterFace(geometry, faceIndex);
  const triangles = cluster.triangles;
  const key = Math.min(...triangles);
  const normal = unit(cluster.normal);
  const { u, v } = planeBasis(normal);
  const center = cluster.point;
  const position = geometry.attributes.position;
  const index = geometry.index;

  // Outline edges: each directed edge of a cluster triangle whose
  // reverse is not also a cluster edge.
  const directed = new Set(); // "a>b"
  const edges = [];
  for (const t of triangles) {
    const a = index.getX(3 * t), b = index.getX(3 * t + 1), c = index.getX(3 * t + 2);
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      directed.add(`${from}>${to}`);
      edges.push([from, to]);
    }
  }
  const next = new Map(); // boundary: from vertex -> to vertex
  for (const [a, b] of edges) {
    if (!directed.has(`${b}>${a}`)) next.set(a, b);
  }

  const point3 = (vi) => [position.getX(vi), position.getY(vi), position.getZ(vi)];
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      cur = next.get(cur);
    }
    if (loop.length >= 3) loops.push(loop);
  }

  const built = loops.map((vertexIds) => {
    const raw = vertexIds.map((vi) => {
      const p = point3(vi);
      return { p, uv: project(p, center, u, v) };
    });
    const simplified = simplifyLoop(raw);
    const area = signedArea(simplified.map((s) => s.uv));
    const centroid = averagePoint(simplified.map((s) => s.p));
    const radius = Math.max(...simplified.map((s) => distance(s.p, centroid)));
    return { points: simplified.map((s) => s.p), uv: simplified.map((s) => s.uv), area, center: centroid, radius, outer: false };
  });
  // Largest loop is the outline; it should be CCW (positive area) on a
  // consistently wound mesh, but go by size so a mirrored mesh still
  // has an outline.
  let outerIndex = -1;
  let biggest = -1;
  built.forEach((loop, i) => {
    if (Math.abs(loop.area) > biggest) {
      biggest = Math.abs(loop.area);
      outerIndex = i;
    }
  });
  if (outerIndex >= 0) built[outerIndex].outer = true;

  const extent = [0, 0];
  if (outerIndex >= 0) {
    const us = built[outerIndex].uv.map((q) => q[0]);
    const vs = built[outerIndex].uv.map((q) => q[1]);
    extent[0] = Math.max(...us) - Math.min(...us);
    extent[1] = Math.max(...vs) - Math.min(...vs);
  }

  return {
    key,
    triangles,
    triangleCount: triangles.length,
    normal,
    u,
    v,
    center,
    extent,
    loops: built,
    inset: undefined,
    radius: undefined,
    candidates: [],
    guides: [],
  };
}

// Is this uv point on the face: inside the outline and in no hole?
function onFace(face, q) {
  const outer = face.loops.find((l) => l.outer);
  if (!outer || !pointInPolygon(q, outer.uv)) return false;
  return !face.loops.some((l) => !l.outer && pointInPolygon(q, l.uv));
}

// --- guides ------------------------------------------------------------

// Center lines (u = 0, v = 0) and quarter lines (u = ±w/4, v = ±h/4),
// each cut to the pieces that lie on the face; a radial from the center
// through each corner inset to its corner; and the center circle.
function buildGuides(face, corners, radius) {
  const outer = face.loops.find((l) => l.outer);
  if (!outer) return [];
  const [w, h] = face.extent;
  const guides = [];
  const line = (kind, auv, buv) => guides.push({ kind, a: unproject(auv, face), b: unproject(buv, face), auv, buv });
  const axisLine = (kind, axis, offset) => {
    for (const [t0, t1] of clipLine(outer.uv, axis, offset)) {
      line(kind, axis === "u" ? [offset, t0] : [t0, offset], axis === "u" ? [offset, t1] : [t1, offset]);
    }
  };
  axisLine("center", "u", 0);
  axisLine("center", "v", 0);
  for (const s of [-1, 1]) {
    axisLine("quarter", "u", (s * w) / 4);
    axisLine("quarter", "v", (s * h) / 4);
  }
  for (const c of corners) line("radial", [0, 0], c.cornerUv);
  if (radius > 0 && radius <= Math.max(w, h) / 2) {
    const points = [];
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const t = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
      points.push(unproject([radius * Math.cos(t), radius * Math.sin(t)], face));
    }
    guides.push({ kind: "circle", radius, points });
  }
  return guides;
}

// Where the line `axis = offset` (in the face's uv frame) runs inside the
// polygon: the crossings with its edges, sorted along the line and
// paired off into inside intervals.
function clipLine(polygon, axis, offset) {
  const along = axis === "u" ? 1 : 0; // index of the coordinate that varies along the line
  const across = axis === "u" ? 0 : 1;
  const crossings = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % n];
    const dp = p[across] - offset;
    const dq = q[across] - offset;
    // Half-open test so a vertex exactly on the line counts once.
    if ((dp <= 0 && dq > 0) || (dq <= 0 && dp > 0)) {
      const t = dp / (dp - dq);
      crossings.push(p[along] + t * (q[along] - p[along]));
    }
  }
  crossings.sort((x, y) => x - y);
  const intervals = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    if (crossings[i + 1] - crossings[i] > 1e-6) intervals.push([crossings[i], crossings[i + 1]]);
  }
  return intervals;
}

// --- candidates --------------------------------------------------------

function buildCandidates(face, corners, radius) {
  const out = [];
  const push = (kind, point, label, extra = {}) => {
    if (out.some((c) => distance(c.point, point) < DEDUPE_MM)) return;
    out.push({ id: `${face.key}:${out.length}`, kind, point, label, ...extra });
  };
  const pushUv = (kind, q, label) => {
    if (onFace(face, q)) push(kind, unproject(q, face), label);
  };

  // Hole centers first: a hole that happens to sit at the face center
  // should read as "hole", not "center".
  for (const loop of face.loops) {
    if (loop.outer) continue;
    push("hole", loop.center, `existing hole Ø${(loop.radius * 2).toFixed(1)}`, { radius: loop.radius });
  }
  push("center", face.center, "face center");

  const outer = face.loops.find((l) => l.outer);
  if (!outer) return out;
  const [w, h] = face.extent;

  // Corner insets before quadrant centers: where the two coincide (a
  // face about four insets across) the corner reading wins.
  for (const c of corners) push("corner", unproject(c.uv, face), `${face.inset} mm in from the corner`);

  // The center of each quadrant of the face's bounding box — four
  // screws spread over a plate.
  for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    pushUv("quarter", [(su * w) / 4, (sv * h) / 4], "quadrant center");
  }

  // Where a center line crosses a quarter line: halfway out along each
  // axis. (Quarter × quarter is the quadrant center above, center ×
  // center the face center.)
  for (const q of [[w / 4, 0], [-w / 4, 0], [0, h / 4], [0, -h / 4]]) {
    pushUv("intersection", q, "center line × quarter line");
  }

  // Around the center circle: where it meets the center lines and each
  // radial — a bolt circle of up to eight.
  if (radius > 0) {
    for (const q of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      pushUv("circle", q, "center circle × center line");
    }
    for (const c of corners) {
      const d = norm2(c.cornerUv);
      pushUv("circle", [d[0] * radius, d[1] * radius], "center circle × radial");
    }
  }
  return out;
}

// For each corner of the outline, the point `inset` mm from both of
// its edges, on the inside — where a screw in the corner of a plate
// goes — together with the corner itself. A "corner" is where two
// consecutive long edges meet, whether they touch or a fillet/chamfer
// (a run of short segments) sits between them: the two edges' lines are
// intersected, so a rounded plate gets its four corner points exactly
// where a sharp one would. Skipped when the point would land outside
// the outline (a reflex corner, or one tighter than the inset allows)
// or inside a hole. Returns [{ uv, cornerUv }].
function cornerInsets(face, inset) {
  const outer = face.loops.find((l) => l.outer);
  if (!outer || !(inset > 0)) return [];
  const maxDim = Math.max(face.extent[0], face.extent[1], 1);
  const minEdge = Math.max(1.5, 0.08 * maxDim);
  const n = outer.uv.length;
  const longEdges = [];
  for (let i = 0; i < n; i++) {
    const a = outer.uv[i];
    const b = outer.uv[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minEdge) continue;
    longEdges.push({ a, b, dir: norm2([b[0] - a[0], b[1] - a[1]]) });
  }
  if (longEdges.length < 2) return [];
  const result = [];
  for (let k = 0; k < longEdges.length; k++) {
    const e1 = longEdges[k];
    const e2 = longEdges[(k + 1) % longEdges.length];
    const corner = intersectLines(e1.a, e1.dir, e2.a, e2.dir);
    if (!corner) continue; // parallel: no corner between them
    // Bisector of the two edges as seen from the corner: back along e1,
    // forward along e2.
    const da = [-e1.dir[0], -e1.dir[1]];
    const db = e2.dir;
    const bis = norm2([da[0] + db[0], da[1] + db[1]]);
    if (!Number.isFinite(bis[0]) || (bis[0] === 0 && bis[1] === 0)) continue;
    const cosHalf = Math.abs(da[0] * bis[0] + da[1] * bis[1]);
    const sinHalf = Math.sqrt(Math.max(0, 1 - cosHalf * cosHalf));
    if (sinHalf < 1e-6) continue;
    const q = [corner[0] + bis[0] * (inset / sinHalf), corner[1] + bis[1] * (inset / sinHalf)];
    if (!onFace(face, q)) continue;
    result.push({ uv: q, cornerUv: corner });
  }
  return result;
}

// Where the line through `p` along `d` meets the line through `q` along
// `e`, or null when they are (nearly) parallel.
function intersectLines(p, d, q, e) {
  const denom = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / denom;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

// --- snapping ----------------------------------------------------------

// The nearest candidate on `face` within `maxDistance` of `point`, or null.
export function nearestCandidate(face, point, maxDistance) {
  let best = null;
  let bestDistance = maxDistance;
  for (const candidate of face.candidates) {
    const d = distance(candidate.point, point);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

// The guide nearest to `point` within `maxDistance`, with `point` moved
// onto it — along a line rounded to the grid (measured from the line's
// closest point to the face center, so the center stays on the grid),
// around the circle rounded to whole degrees — or null.
export function nearestGuide(face, point, maxDistance, grid = FREE_GRID_MM) {
  const p = project(point, face.center, face.u, face.v);
  let best = null;
  const consider = (guide, d, uv, label) => {
    if (d < (best ? best.distance : maxDistance)) best = { guide, distance: d, point: unproject(uv, face), label };
  };
  for (const guide of face.guides) {
    if (guide.kind === "circle") {
      const r = Math.hypot(p[0], p[1]);
      if (r < 1e-9) continue;
      const d = Math.abs(r - guide.radius);
      const step = (CIRCLE_STEP_DEG * Math.PI) / 180;
      const angle = Math.round(Math.atan2(p[1], p[0]) / step) * step;
      consider(guide, d, [guide.radius * Math.cos(angle), guide.radius * Math.sin(angle)], "on the center circle");
      continue;
    }
    const { auv: a, buv: b } = guide;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const along = (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1];
    // A line is only considered where it actually runs, with a little slack.
    if (along < -maxDistance || along > len + maxDistance) continue;
    const foot = [a[0] + dir[0] * along, a[1] + dir[1] * along];
    const d = Math.hypot(p[0] - foot[0], p[1] - foot[1]);
    const centerAlong = -(a[0] * dir[0] + a[1] * dir[1]);
    const snapped = Math.min(Math.max(centerAlong + Math.round((along - centerAlong) / grid) * grid, 0), len);
    const label = { center: "on the center line", quarter: "on a quarter line", radial: "on a radial line" }[guide.kind] ?? "on a guide line";
    consider(guide, d, [a[0] + dir[0] * snapped, a[1] + dir[1] * snapped], label);
  }
  return best;
}

// How far `point` (on the face) is from the outline in each direction of
// the face's frame, and from the face center — the numbers that matter
// when a hole has to clear an edge. Returns
//   { left, right, down, up (mm), ends: { left, right, down, up } (the
//     outline points those distances run to, in 3D), toCenter (mm) }
// or null when the point is outside the outline's span. Measured to the
// outer outline only; a hole loop between the point and the edge is not
// an edge.
export function edgeDistances(face, point) {
  const outer = face.loops.find((l) => l.outer);
  if (!outer) return null;
  const [pu, pv] = project(point, face.center, face.u, face.v);
  const spanU = clipLine(outer.uv, "v", pv).find(([t0, t1]) => pu >= t0 - 1e-6 && pu <= t1 + 1e-6);
  const spanV = clipLine(outer.uv, "u", pu).find(([t0, t1]) => pv >= t0 - 1e-6 && pv <= t1 + 1e-6);
  if (!spanU || !spanV) return null;
  return {
    left: pu - spanU[0],
    right: spanU[1] - pu,
    down: pv - spanV[0],
    up: spanV[1] - pv,
    ends: {
      left: unproject([spanU[0], pv], face),
      right: unproject([spanU[1], pv], face),
      down: unproject([pu, spanV[0]], face),
      up: unproject([pu, spanV[1]], face),
    },
    toCenter: Math.hypot(pu, pv),
  };
}

// `point` rounded to the face's grid, measured from its center and
// lifted onto its plane — free placement with snapping on.
export function gridPoint(face, point, grid = FREE_GRID_MM) {
  const [pu, pv] = project(point, face.center, face.u, face.v);
  return unproject([Math.round(pu / grid) * grid, Math.round(pv / grid) * grid], face);
}

// `point` lifted onto the face's plane without rounding.
export function planePoint(face, point) {
  return unproject(project(point, face.center, face.u, face.v), face);
}

// --- geometry helpers --------------------------------------------------

function project(p, origin, u, v) {
  const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]];
}

function unproject([a, b], face) {
  return [
    face.center[0] + face.u[0] * a + face.v[0] * b,
    face.center[1] + face.u[1] * a + face.v[1] * b,
    face.center[2] + face.u[2] * a + face.v[2] * b,
  ];
}

// Drop vertices that sit on the straight line between their neighbours
// (and exact duplicates), leaving the loop's real corners.
function simplifyLoop(entries) {
  let pts = entries.filter((e, i) => i === 0 || distance(e.p, entries[i - 1].p) > 1e-6);
  if (pts.length > 1 && distance(pts[0].p, pts[pts.length - 1].p) <= 1e-6) pts = pts.slice(0, -1);
  if (pts.length < 3) return pts;
  const keep = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].p;
    const cur = pts[i].p;
    const nxt = pts[(i + 1) % n].p;
    const d1 = [cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]];
    const d2 = [nxt[0] - cur[0], nxt[1] - cur[1], nxt[2] - cur[2]];
    const l1 = Math.hypot(...d1);
    const l2 = Math.hypot(...d2);
    if (l1 === 0 || l2 === 0) continue;
    const c = cross(d1, d2);
    const sin = Math.hypot(...c) / (l1 * l2);
    const dot = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (l1 * l2);
    // Collinear and heading the same way: not a corner.
    if (sin < 1e-3 && dot > 0) continue;
    keep.push(pts[i]);
  }
  return keep.length >= 3 ? keep : pts;
}

function signedArea(uv) {
  let area = 0;
  for (let i = 0; i < uv.length; i++) {
    const [x1, y1] = uv[i];
    const [x2, y2] = uv[(i + 1) % uv.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function averagePoint(points) {
  const sum = [0, 0, 0];
  for (const p of points) {
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  return sum.map((s) => s / points.length);
}

function norm2([x, y]) {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
