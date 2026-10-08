// A screw preset as a cross-section: the material (grey) with the hole
// the preset cuts into it (dark), and the fastener itself seated in
// that hole (light) — so a counterbore, a countersink, a heat-set
// insert and a nut trap each look like what they are at a glance.
// Drawn to the preset's own proportions: the hole from its `spec`
// (what will actually be cut), the fastener from its `screw` record
// (screwPresets.js), both scaled so the widest feature fits the icon.
// Colours are CSS variables (styles.css, dark scheme), so the icon
// follows the UI theme rather than carrying its own palette.

const SIZE = 48;
const SURFACE_Y = 14;
const BOTTOM_Y = 46;
const CX = SIZE / 2;
// Material shows this much below a blind hole's floor at most.
const MAX_SHOWN_DEPTH = BOTTOM_Y - SURFACE_Y - 4;

export default function ScrewIcon({ spec, screw, title, className }) {
  if (spec.kind === "openconnect" || spec.kind === "multiconnect") {
    return <SlotIcon spec={spec} title={title} className={className} />;
  }
  if (spec.kind === "thread") return <ThreadIcon spec={spec} title={title} className={className} />;
  if (spec.kind === "cylinder" || spec.kind === "rectangle") return <ShapeIcon spec={spec} title={title} className={className} />;
  if (spec.kind === "extrusion") return <ExtrusionIcon spec={spec} title={title} className={className} />;
  if (spec.kind === "pinhole") return <PinholeIcon spec={spec} title={title} className={className} />;
  if (spec.kind === "klippt") return <KlipptIcon title={title} className={className} />;
  const s = scaleFor(spec, screw);
  const px = (mm) => mm * s;
  const shankW = px(spec.diameter);
  const through = !(spec.depth > 0);
  const holeFloorY = through ? BOTTOM_Y + 1 : SURFACE_Y + Math.min(px(spec.depth), MAX_SHOWN_DEPTH);
  const pocketDepth = spec.head === "none" ? 0 : Math.min(px(spec.headDepth), MAX_SHOWN_DEPTH - 4);
  const pocketW = px(spec.headDiameter);
  const coneH = spec.head === "countersink" && spec.headDiameter > spec.diameter
    ? ((spec.headDiameter - spec.diameter) / 2 / Math.tan(((spec.sinkAngle / 2) * Math.PI) / 180)) * s
    : 0;

  const cut = [];
  cut.push(rect(CX - shankW / 2, SURFACE_Y - 1, shankW, holeFloorY - SURFACE_Y + 1));
  if (spec.head === "counterbore" || spec.head === "hex") {
    cut.push(rect(CX - pocketW / 2, SURFACE_Y - 1, pocketW, pocketDepth + 1));
  } else if (spec.head === "countersink" && coneH > 0) {
    const sinkY = SURFACE_Y + pocketDepth;
    cut.push(rect(CX - pocketW / 2, SURFACE_Y - 1, pocketW, pocketDepth + 1));
    cut.push(
      polygon([
        [CX - pocketW / 2, sinkY],
        [CX + pocketW / 2, sinkY],
        [CX + shankW / 2, sinkY + coneH],
        [CX - shankW / 2, sinkY + coneH],
      ]),
    );
  }

  const fastener = drawFastener({ screw, spec, s, px, through, holeFloorY, pocketDepth, coneH });

  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {/* Material: a slab with the hole cut into it. */}
      <g className="screw-icon-material">
        <rect x="2" y={SURFACE_Y} width={SIZE - 4} height={BOTTOM_Y - SURFACE_Y} rx="1.5" />
      </g>
      <g className="screw-icon-cut">{cut}</g>
      <g className="screw-icon-fastener">{fastener}</g>
    </svg>
  );
}

// px per mm so the widest thing in the picture fits in ~30px, never
// more than 4 px/mm (an M2 would otherwise be a sliver next to an M6).
function scaleFor(spec, screw) {
  const widest = Math.max(spec.headDiameter || 0, spec.diameter, screw?.headDiameter || 0, (screw?.nominal || 0) * 1.3, 3);
  return Math.min(4, 30 / widest);
}

function rect(x, y, w, h, extra = {}) {
  return <rect key={`${x},${y},${w},${h}`} x={x} y={y} width={w} height={h} {...extra} />;
}

function polygon(points, extra = {}) {
  return <polygon key={points.flat().join(",")} points={points.map((p) => p.join(",")).join(" ")} {...extra} />;
}

// Short slanted lines across a shank: the thread.
function threads(x, y0, y1, w, pitch = 2.4) {
  const lines = [];
  for (let y = y0 + 1.5; y < y1 - 0.5; y += pitch) {
    lines.push(<line key={y} x1={x + 0.6} y1={y + 0.7} x2={x + w - 0.6} y2={y - 0.7} className="screw-icon-thread" />);
  }
  return lines;
}

function drawFastener({ screw, spec, s, px, through, holeFloorY, pocketDepth, coneH }) {
  if (!screw || screw.style === "none") return null;
  const parts = [];
  const nominalW = Math.max(1.5, px(screw.nominal));
  const headW = px(screw.headDiameter);
  const headH = px(screw.headHeight);
  const shankEnd = through ? BOTTOM_Y + 1 : holeFloorY - 1;
  const socket = (topY, w, h) => rect(CX - w / 2, topY, w, h, { className: "screw-icon-socket" });

  switch (screw.style) {
    case "cap": {
      const headTop = SURFACE_Y + pocketDepth - headH;
      parts.push(rect(CX - headW / 2, headTop, headW, headH, { rx: 0.8 }));
      parts.push(socket(headTop, nominalW * 0.55, headH * 0.5));
      parts.push(rect(CX - nominalW / 2, headTop + headH, nominalW, shankEnd - headTop - headH));
      parts.push(...threads(CX - nominalW / 2, headTop + headH, shankEnd, nominalW));
      break;
    }
    case "button": {
      const base = SURFACE_Y + pocketDepth;
      parts.push(
        <path
          key="dome"
          d={`M ${CX - headW / 2} ${base} A ${headW / 2} ${headH} 0 0 1 ${CX + headW / 2} ${base} Z`}
        />,
      );
      parts.push(socket(base - headH, nominalW * 0.5, headH * 0.6));
      parts.push(rect(CX - nominalW / 2, base, nominalW, shankEnd - base));
      parts.push(...threads(CX - nominalW / 2, base, shankEnd, nominalW));
      break;
    }
    case "flat":
    case "wood": {
      const top = SURFACE_Y + pocketDepth;
      const cone = Math.max(coneH, headH);
      parts.push(
        polygon([
          [CX - headW / 2, top],
          [CX + headW / 2, top],
          [CX + nominalW / 2, top + cone],
          [CX - nominalW / 2, top + cone],
        ]),
      );
      parts.push(socket(top, headW * 0.6, 1.6));
      if (screw.style === "wood") {
        const tipY = Math.min(shankEnd, BOTTOM_Y - 1);
        parts.push(
          polygon([
            [CX - nominalW / 2, top + cone],
            [CX + nominalW / 2, top + cone],
            [CX + nominalW / 2, tipY - nominalW],
            [CX, tipY],
            [CX - nominalW / 2, tipY - nominalW],
          ]),
        );
        parts.push(...threads(CX - nominalW / 2, top + cone, tipY - nominalW, nominalW, 2));
      } else {
        parts.push(rect(CX - nominalW / 2, top + cone, nominalW, shankEnd - top - cone));
        parts.push(...threads(CX - nominalW / 2, top + cone, shankEnd, nominalW));
      }
      break;
    }
    case "wood-tap": {
      // A pilot hole: the screw is wider than the hole, biting into
      // the material around it, with a pointed tip and a head on top.
      const headTop = SURFACE_Y - 4;
      const w = Math.max(nominalW, px(spec.diameter) + 2.5);
      parts.push(rect(CX - w, headTop, w * 2, 4, { rx: 0.8 }));
      parts.push(socket(headTop, w * 0.8, 1.6));
      const tipY = Math.min(holeFloorY + 2, BOTTOM_Y - 1);
      parts.push(
        polygon([
          [CX - w / 2, SURFACE_Y],
          [CX + w / 2, SURFACE_Y],
          [CX + w / 2, tipY - w],
          [CX, tipY],
          [CX - w / 2, tipY - w],
        ]),
      );
      parts.push(...threads(CX - w / 2, SURFACE_Y, tipY - w, w, 2));
      break;
    }
    case "tap": {
      // Thread-forming machine screw: cap head resting on the surface,
      // shank wider than the hole it cuts its own thread into.
      const w = Math.max(nominalW, px(spec.diameter) + 2);
      const hh = Math.min(px(screw.nominal), 6);
      const headTop = SURFACE_Y - hh;
      parts.push(rect(CX - w, headTop, w * 2, hh, { rx: 0.8 }));
      parts.push(socket(headTop, w * 0.6, hh * 0.5));
      parts.push(rect(CX - w / 2, SURFACE_Y, w, holeFloorY - 1 - SURFACE_Y));
      parts.push(...threads(CX - w / 2, SURFACE_Y, holeFloorY - 1, w, 2));
      break;
    }
    case "insert": {
      // A brass sleeve in the bore, knurled outside, threaded inside.
      const outerW = px(screw.headDiameter) + 1.2;
      const innerW = Math.max(1.5, px(screw.nominal) * 0.85);
      const len = Math.min(headH, holeFloorY - SURFACE_Y - 2);
      parts.push(rect(CX - outerW / 2, SURFACE_Y, outerW, len, { rx: 0.6 }));
      parts.push(rect(CX - innerW / 2, SURFACE_Y - 0.5, innerW, len + 1, { className: "screw-icon-socket" }));
      for (let y = SURFACE_Y + 2; y < SURFACE_Y + len - 1; y += 2.6) {
        parts.push(<line key={`kl${y}`} x1={CX - outerW / 2} y1={y} x2={CX - outerW / 2 + 1.6} y2={y + 1.1} className="screw-icon-thread" />);
        parts.push(<line key={`kr${y}`} x1={CX + outerW / 2} y1={y} x2={CX + outerW / 2 - 1.6} y2={y + 1.1} className="screw-icon-thread" />);
      }
      break;
    }
    case "nut": {
      // The nut in its pocket, the bolt coming up through it from the
      // far side.
      const nutW = px(screw.headDiameter);
      const nutH = Math.min(px(screw.headHeight), pocketDepth || px(screw.headHeight));
      const nutTop = SURFACE_Y + Math.max(0, pocketDepth - nutH);
      parts.push(rect(CX - nutW / 2, nutTop, nutW, nutH));
      parts.push(rect(CX - nominalW / 2, SURFACE_Y - 3, nominalW, BOTTOM_Y + 1 - (SURFACE_Y - 3)));
      parts.push(...threads(CX - nominalW / 2, SURFACE_Y - 3, BOTTOM_Y + 1, nominalW));
      break;
    }
    case "pin": {
      parts.push(rect(CX - nominalW / 2, SURFACE_Y - 5, nominalW, Math.min(holeFloorY, BOTTOM_Y) - SURFACE_Y + 4, { rx: 1 }));
      break;
    }
    default:
      break;
  }
  return parts;
}

// A connector slot in cross-section, across the channel: the slab with
// the keyhole cut into it — slit at the surface, taper, pocket — and
// the head seated in it, neck through the slit, on its snap outside.
// The widths are the slots' own (lib/openconnect.scad's upstream
// numbers, lib/constants.scad's MC_*); the depths are drawn four times
// over, since a 2.8 mm slot at the width's scale would be a hairline.
const SLOT_PROFILES = {
  // [slit width, pocket width, slit depth, taper depth, pocket depth]
  // of the cut, then of the head.
  openconnect: { slit: 14.4, pocket: 17.2, slitD: 0.56, taperD: 1.4, pocketD: 0.74, head: { neck: 14.2, disc: 17, neckH: 0.6, taperH: 1.4, discH: 0.6 }, snap: 24.8 },
  multiconnect: { slit: 15.3, pocket: 20.3, slitD: 0.44, taperD: 2.5, pocketD: 1.21, head: { neck: 15, disc: 20, neckH: 0.5, taperH: 2.5, discH: 1 }, snap: 24.8 },
};
const SLOT_DEPTH_SCALE = 4;

function SlotIcon({ spec, title, className }) {
  const p = SLOT_PROFILES[spec.kind];
  const s = 30 / p.snap;
  const px = (mm) => mm * s;
  const pz = (mm) => mm * s * SLOT_DEPTH_SCALE;
  const slitY = SURFACE_Y;
  const taperY = slitY + pz(p.slitD);
  const pocketY = taperY + pz(p.taperD);
  const floorY = pocketY + pz(p.pocketD);
  const cut = (
    <polygon
      points={[
        [CX - px(p.slit) / 2, slitY - 1],
        [CX + px(p.slit) / 2, slitY - 1],
        [CX + px(p.slit) / 2, taperY],
        [CX + px(p.pocket) / 2, pocketY],
        [CX + px(p.pocket) / 2, floorY],
        [CX - px(p.pocket) / 2, floorY],
        [CX - px(p.pocket) / 2, pocketY],
        [CX - px(p.slit) / 2, taperY],
      ]
        .map((pt) => pt.join(","))
        .join(" ")}
    />
  );
  // The head, seated: its disc on the pocket floor, less the clearance.
  const h = p.head;
  const discTop = floorY - pz(h.discH);
  const neckBottom = discTop - pz(h.taperH);
  const head = (
    <polygon
      points={[
        [CX - px(h.neck) / 2, SURFACE_Y - 3],
        [CX + px(h.neck) / 2, SURFACE_Y - 3],
        [CX + px(h.neck) / 2, neckBottom],
        [CX + px(h.disc) / 2, discTop],
        [CX + px(h.disc) / 2, floorY - 0.6],
        [CX - px(h.disc) / 2, floorY - 0.6],
        [CX - px(h.disc) / 2, discTop],
        [CX - px(h.neck) / 2, neckBottom],
      ]
        .map((pt) => pt.join(","))
        .join(" ")}
    />
  );
  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g className="screw-icon-material">
        <rect x="2" y={SURFACE_Y} width={SIZE - 4} height={BOTTOM_Y - SURFACE_Y} rx="1.5" />
      </g>
      <g className="screw-icon-cut">{cut}</g>
      <g className="screw-icon-fastener">
        {/* The snap the head stands on, outside the surface. */}
        <rect x={CX - px(p.snap) / 2} y={SURFACE_Y - 8} width={px(p.snap)} height={5.5} rx="0.8" />
        {head}
        {spec.kind === "multiconnect" && <rect x={CX - 1} y={floorY - 1.8} width={2} height={1.2} className="screw-icon-socket" />}
      </g>
    </svg>
  );
}

// The openGrid thread in cross-section: the Ø16.5 bore with the thread's
// ridges standing into it from both walls, and a screw connector in it —
// the threaded shank, and the head (an openConnect head's width) on the
// surface, a coin slot in its face. To scale across, its depth as cut
// (6.8 mm of screw, whatever the hole's own depth).
function ThreadIcon({ spec, title, className }) {
  const s = 30 / 17;
  const px = (mm) => mm * s;
  const boreW = px(16 + spec.clearance);
  const through = !(spec.depth > 0);
  const floorY = through ? BOTTOM_Y + 1 : SURFACE_Y + Math.min(px(spec.depth), MAX_SHOWN_DEPTH);
  const shankW = px(16);
  const shankEnd = Math.min(floorY - 1, SURFACE_Y + px(6.8));
  const pitch = px(3);
  // Ridges of material into the bore: one per pitch down each wall, the
  // right wall half a pitch below the left (it is a helix).
  const ridges = [];
  for (const side of [-1, 1]) {
    const wall = CX + (side * boreW) / 2;
    const tip = wall - side * px(1);
    for (let y = SURFACE_Y + (side > 0 ? pitch / 2 : 0) + 0.6; y + pitch * 0.6 < floorY; y += pitch) {
      ridges.push(polygon([[wall, y], [tip, y + pitch * 0.25], [tip, y + pitch * 0.35], [wall, y + pitch * 0.6]]));
    }
  }
  const headH = px(2.6);
  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g className="screw-icon-material">
        <rect x="2" y={SURFACE_Y} width={SIZE - 4} height={BOTTOM_Y - SURFACE_Y} rx="1.5" />
      </g>
      <g className="screw-icon-cut">{rect(CX - boreW / 2, SURFACE_Y - 1, boreW, floorY - SURFACE_Y + 1)}</g>
      <g className="screw-icon-material">{ridges}</g>
      <g className="screw-icon-fastener">
        {rect(CX - shankW / 2 + px(1), SURFACE_Y, shankW - px(2), shankEnd - SURFACE_Y)}
        {threads(CX - shankW / 2 + px(1), SURFACE_Y, shankEnd, shankW - px(2), pitch)}
        {rect(CX - px(17) / 2, SURFACE_Y - headH, px(17), headH, { rx: 0.8 })}
        {rect(CX - px(13) / 2, SURFACE_Y - headH, px(13), headH * 0.45, { className: "screw-icon-socket" })}
      </g>
    </svg>
  );
}

// A generic cutout seen from above, not in section — a section through a
// rectangle and a round hole would look the same: the material as a
// square with the shape cut out of it, to scale (a rectangle as it is
// turned, so a 10 × 20 stands up), the widest side ~30px.
function ShapeIcon({ spec, title, className }) {
  const plan =
    spec.kind === "cylinder"
      ? { w: spec.diameter, h: spec.diameter, r: spec.diameter / 2, spin: 0 }
      : { w: spec.width, h: spec.height, r: Math.min(spec.cornerRadius, spec.width / 2, spec.height / 2), spin: spec.spin };
  const s = 30 / Math.max(plan.w, plan.h, 1);
  const cy = SIZE / 2;
  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g className="screw-icon-material">
        <rect x="4" y="4" width={SIZE - 8} height={SIZE - 8} rx="1.5" />
      </g>
      <g className="screw-icon-cut">
        <rect
          x={CX - (plan.w * s) / 2}
          y={cy - (plan.h * s) / 2}
          width={plan.w * s}
          height={plan.h * s}
          rx={plan.r * s}
          // Counter-clockwise as seen from outside the face, as the spin is.
          transform={plan.spin ? `rotate(${-plan.spin} ${CX} ${cy})` : undefined}
        />
      </g>
    </svg>
  );
}

// A 2020 socket from above: the rail's profile standing in it — the
// square with its four slot mouths and centre bore — and, when keyed,
// the material keys reaching into those mouths. To scale, ~30px across.
function ExtrusionIcon({ spec, title, className }) {
  const s = 30 / 20;
  const cy = SIZE / 2;
  const half = 10 * s;
  const mouth = 3.1 * s;
  const lip = 1.8 * s;
  const channel = 5.5 * s;
  const reach = 3.8 * s;
  // The rail's outline: each side notched by its slot mouth, the T of
  // the channel behind it.
  const quarter = [
    [half, -half],
    [half, -mouth],
    [half - lip, -mouth],
    [half - lip, -channel],
    [half - lip - 2.2 * s, -channel],
    [half - lip - 2.2 * s, channel],
    [half - lip, channel],
    [half - lip, mouth],
    [half, mouth],
  ];
  const rail = [];
  for (let q = 0; q < 4; q++) {
    for (const [x, y] of quarter) rail.push([[x, y], [-y, x], [-x, -y], [y, -x]][q]);
  }
  const at = (points) => points.map(([x, y]) => `${CX + x},${cy - y}`).join(" ");
  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g transform={spec.spin ? `rotate(${-spec.spin} ${CX} ${cy})` : undefined}>
        <g className="screw-icon-material">
          <rect x="3" y="3" width={SIZE - 6} height={SIZE - 6} rx="1.5" />
        </g>
        <g className="screw-icon-cut">
          <rect x={CX - half - 1} y={cy - half - 1} width={2 * half + 2} height={2 * half + 2} />
        </g>
        {spec.keys && (
          <g className="screw-icon-material">
            {[0, 90, 180, 270].map((a) => (
              <rect key={a} x={CX + half - reach} y={cy - mouth + 0.5} width={reach + 1.2} height={2 * mouth - 1} transform={`rotate(${a} ${CX} ${cy})`} />
            ))}
          </g>
        )}
        <g className="screw-icon-fastener">
          <polygon points={at(rail)} />
          <circle cx={CX} cy={cy} r={2.5 * s} className="screw-icon-socket" />
        </g>
      </g>
    </svg>
  );
}

// A BitBeam pin hole in section: the Ø4.8 bore with its grooves (a
// notch either side, 0.8 mm in from the entry and, blind, from the
// bottom), and a Technic pin in it — its collar on the surface, its
// slit half down the bore. To scale, one beam (8 mm) deep.
function PinholeIcon({ spec, title, className }) {
  const s = 3;
  const boreW = 4.8 * s;
  const grooveW = 5.6 * s; // drawn a little wider than 5.0, or it would not show
  const through = !(spec.depth > 0);
  const depth = through ? BOTTOM_Y + 1 - SURFACE_Y : Math.min(spec.depth * s, MAX_SHOWN_DEPTH);
  const groove = (y) => rect(CX - grooveW / 2, y - 1.1, grooveW, 2.2);
  const pinW = 4.6 * s;
  const pinBottom = SURFACE_Y + Math.min(7.8 * s, depth) - 1;
  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g className="screw-icon-material">
        <rect x="2" y={SURFACE_Y} width={SIZE - 4} height={BOTTOM_Y - SURFACE_Y} rx="1.5" />
      </g>
      <g className="screw-icon-cut">
        {rect(CX - boreW / 2, SURFACE_Y - 1, boreW, depth + 1)}
        {groove(SURFACE_Y + 0.8 * s)}
        {!through && groove(SURFACE_Y + depth - 0.8 * s)}
      </g>
      <g className="screw-icon-fastener">
        {rect(CX - pinW / 2, SURFACE_Y, pinW, pinBottom - SURFACE_Y, { rx: 1 })}
        {rect(CX - (6.2 * s) / 2, SURFACE_Y - 2.4, 6.2 * s, 2.4, { rx: 0.6 })}
        {rect(CX - pinW / 2, SURFACE_Y - 9, pinW, 6.6, { rx: 1 })}
        {rect(CX - 0.8, SURFACE_Y + (pinBottom - SURFACE_Y) / 2, 1.6, (pinBottom - SURFACE_Y) / 2, { className: "screw-icon-socket" })}
      </g>
    </svg>
  );
}

// A KLIPPT channel in section, across it: the slab with the clip's
// T-slot cut in — the lips' opening at the surface, the wider flange gap
// under them — and a base in it, its flange under the lips, its neck up
// through them to the wall it is screwed to (above the surface). To
// scale across (25mm channel, 17.5mm between the lips); the depths drawn
// three times over, as the slots' are.
function KlipptIcon({ title, className }) {
  const s = 30 / 25;
  const pz = (mm) => mm * s * 3;
  const lipsY = SURFACE_Y + pz(1.65);
  const floorY = lipsY + pz(1.15);
  const cut = (
    <polygon
      points={[
        [CX - 8.75 * s, SURFACE_Y - 1],
        [CX + 8.75 * s, SURFACE_Y - 1],
        [CX + 8.75 * s, lipsY],
        [CX + 12.5 * s, lipsY],
        [CX + 12.5 * s, floorY],
        [CX - 12.5 * s, floorY],
        [CX - 12.5 * s, lipsY],
        [CX - 8.75 * s, lipsY],
      ]
        .map((pt) => pt.join(","))
        .join(" ")}
    />
  );
  return (
    <svg
      className={className ? `screw-icon ${className}` : "screw-icon"}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <g className="screw-icon-material">
        <rect x="2" y={SURFACE_Y} width={SIZE - 4} height={BOTTOM_Y - SURFACE_Y} rx="1.5" />
      </g>
      <g className="screw-icon-cut">{cut}</g>
      <g className="screw-icon-fastener">
        {/* The wall the base is on, then the base: neck, flange. */}
        <rect x={CX - 14 * s} y={SURFACE_Y - 7} width={28 * s} height={4} rx="0.8" />
        <rect x={CX - 9 * s} y={SURFACE_Y - 3.2} width={18 * s} height={lipsY - SURFACE_Y + 3.2} />
        <rect x={CX - 10 * s} y={lipsY} width={20 * s} height={pz(1) - 0.4} />
      </g>
    </svg>
  );
}
