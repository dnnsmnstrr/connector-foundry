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
