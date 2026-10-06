// The Holes tab's presets: one entry per common fastener — and, since
// a connector's slot is a hole too, one per connector system the Holes
// tab can cut a slot for — each carrying what it cuts (`spec`, see
// screwHoles.js for the fields of each kind) and what the fastener
// itself looks like in cross-section (`screw` — what
// components/holes/ScrewIcon.jsx draws). The two are kept apart on
// purpose: the spec is what gets cut, the screw is only ever drawn.
//
// Dimensions: clearance holes are ISO 273 "medium" (M3 → 3.4 mm, M4 →
// 4.5 mm …); socket cap heads ISO 4762, countersunk ISO 10642 (90°),
// button heads ISO 7380; counterbores a little over the head so the
// head drops in without being pressed; heat-set insert bores are the
// usual sizes for the common brass inserts (M3 → 4.0 mm, 5.7 deep),
// which print a hair tight on purpose; thread-forming holes are the
// core sizes for a machine screw cut straight into PLA/PETG; nut traps
// take the ISO 4032 nut across corners plus a 0.3 mm print allowance.
// All starting points for a printed part — print one and measure.
//
// `spec.depth` 0 means "through"; `headDepth` is how far the head sinks
// below the surface (a counterbore's pocket depth, a countersink's extra
// sink, a nut trap's pocket depth); `headDiameter` is the pocket's
// diameter (across corners for a hex pocket); `sinkAngle` is the
// countersink's included angle.
//
// The connector slots (kind "openconnect" / "multiconnect") are cut by
// lib/openconnect.scad's oc_slot() and lib/multiconnect.scad's
// mc_slot() with upstream's own numbers — the fields here are only the
// choices those leave open (lock side, clearances, channel length, the
// on-ramp and detent, and which way is up).

export const HEAD_STYLES = [
  { value: "none", label: "None (plain hole)" },
  { value: "counterbore", label: "Counterbore" },
  { value: "countersink", label: "Countersink" },
  { value: "hex", label: "Hex pocket (nut trap)" },
];

export const LOCK_SIDES = [
  { value: "left", label: "Left (upstream's default)" },
  { value: "right", label: "Right" },
  { value: "both", label: "Both (tighter, harder to install)" },
  { value: "none", label: "None" },
];

function metric(nominal) {
  // ISO 273 medium clearance
  return { 2: 2.4, 2.5: 2.9, 3: 3.4, 4: 4.5, 5: 5.5, 6: 6.6, 8: 9 }[nominal];
}

// ISO 4762 socket head cap: [head diameter, head height]
const CAP_HEAD = { 2: [3.8, 2], 2.5: [4.5, 2.5], 3: [5.5, 3], 4: [7, 4], 5: [8.5, 5], 6: [10, 6], 8: [13, 8] };
// ISO 10642 countersunk: head diameter (the actual, not theoretical sharp)
const CSK_HEAD = { 3: 6.0, 4: 8.0, 5: 10.0, 6: 12.0, 8: 16.0 };
// ISO 7380 button head: [head diameter, head height]
const BUTTON_HEAD = { 3: [5.7, 1.65], 4: [7.6, 2.2], 5: [9.5, 2.75], 6: [10.5, 3.3] };
// Heat-set inserts (common brass, e.g. Ruthex/CNC Kitchen): [bore, length]
const INSERT = { 2: [3.2, 4.0], 2.5: [3.6, 5.7], 3: [4.0, 5.7], 4: [5.6, 8.1], 5: [6.4, 9.5], 6: [8.0, 12.7] };
// Thread-forming core hole for a machine screw straight into plastic
const TAP = { 2: 1.6, 2.5: 2.05, 3: 2.5, 4: 3.3, 5: 4.2, 6: 5.0 };
// ISO 4032 nut: [across flats, thickness]
const NUT = { 3: [5.5, 2.4], 4: [7, 3.2], 5: [8, 4.7], 6: [10, 5.2] };

function screw(spec) {
  return { kind: "screw", ...spec };
}

function cap(nominal) {
  const [hd, hh] = CAP_HEAD[nominal];
  return {
    id: `m${nominal}-cap`,
    name: `M${nominal} socket cap`,
    group: "Socket head cap (ISO 4762)",
    spec: screw({ diameter: metric(nominal), depth: 0, head: "counterbore", headDiameter: round1(hd + 0.6), headDepth: hh, sinkAngle: 90 }),
    screw: { style: "cap", nominal, headDiameter: hd, headHeight: hh },
  };
}

function countersunk(nominal) {
  const hd = CSK_HEAD[nominal];
  return {
    id: `m${nominal}-csk`,
    name: `M${nominal} countersunk`,
    group: "Countersunk (ISO 10642)",
    spec: screw({ diameter: metric(nominal), depth: 0, head: "countersink", headDiameter: round1(hd + 0.4), headDepth: 0, sinkAngle: 90 }),
    screw: { style: "flat", nominal, headDiameter: hd, headHeight: (hd - nominal) / 2 },
  };
}

function button(nominal) {
  const [hd, hh] = BUTTON_HEAD[nominal];
  return {
    id: `m${nominal}-button`,
    name: `M${nominal} button head`,
    group: "Button head (ISO 7380)",
    spec: screw({ diameter: metric(nominal), depth: 0, head: "counterbore", headDiameter: round1(hd + 0.6), headDepth: hh, sinkAngle: 90 }),
    screw: { style: "button", nominal, headDiameter: hd, headHeight: hh },
  };
}

function insert(nominal) {
  const [bore, length] = INSERT[nominal];
  return {
    id: `m${nominal}-insert`,
    name: `M${nominal} heat-set insert`,
    group: "Heat-set insert",
    spec: screw({ diameter: bore, depth: round1(length + 1), head: "none", headDiameter: 0, headDepth: 0, sinkAngle: 90 }),
    screw: { style: "insert", nominal, headDiameter: bore, headHeight: length },
  };
}

function tap(nominal) {
  return {
    id: `m${nominal}-tap`,
    name: `M${nominal} thread-forming`,
    group: "Thread-forming (screw into plastic)",
    spec: screw({ diameter: TAP[nominal], depth: round1(nominal * 3), head: "none", headDiameter: 0, headDepth: 0, sinkAngle: 90 }),
    screw: { style: "tap", nominal, headDiameter: 0, headHeight: 0 },
  };
}

function nutTrap(nominal) {
  const [af, thick] = NUT[nominal];
  return {
    id: `m${nominal}-nut`,
    name: `M${nominal} nut trap`,
    group: "Nut trap (ISO 4032)",
    spec: screw({ diameter: metric(nominal), depth: 0, head: "hex", headDiameter: round1(af / Math.cos(Math.PI / 6) + 0.3), headDepth: round1(thick + 0.3), sinkAngle: 90 }),
    screw: { style: "nut", nominal, headDiameter: af, headHeight: thick },
  };
}

function wood(nominal, headDiameter) {
  return {
    id: `wood-${String(nominal).replace(".", "-")}`,
    name: `Wood screw ${nominal} mm`,
    group: "Wood screw (countersunk)",
    spec: screw({ diameter: round1(nominal + 0.5), depth: 0, head: "countersink", headDiameter, headDepth: 0, sinkAngle: 90 }),
    screw: { style: "wood", nominal, headDiameter: headDiameter - 0.5, headHeight: (headDiameter - nominal) / 2 },
  };
}

function pilot(nominal, bore) {
  return {
    id: `pilot-${String(nominal).replace(".", "-")}`,
    name: `Pilot for ${nominal} mm wood screw`,
    group: "Wood screw (countersunk)",
    spec: screw({ diameter: bore, depth: round1(nominal * 4), head: "none", headDiameter: 0, headDepth: 0, sinkAngle: 90 }),
    screw: { style: "wood-tap", nominal, headDiameter: 0, headHeight: 0 },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// An openConnect slot: `lock` is which side of the slot gets the lock
// nub; the clearances are upstream's defaults (0.1 mm each — "increase
// if the slots feel too tight"); `spin` turns the slot on its face, in
// degrees, 0 being the face's own "up" (see screwHoles.js's slotFrame()).
function openConnect(id, name, short, lock) {
  return {
    id,
    name,
    short,
    group: "openConnect (openGrid)",
    spec: { kind: "openconnect", lock, sideClearance: 0.1, depthClearance: 0.1, spin: 0 },
    screw: { style: "openconnect" },
  };
}

// A MultiConnect slot: the channel runs `length` mm down from the
// round end the head rests in (Multiboard's 25 mm slot pitch), with an
// on-ramp funnel at its far end to push the head in through, and the
// v2 detent that clicks a seated head in place.
function multiConnect(id, name, short, { onRamp, detent }) {
  return {
    id,
    name,
    short,
    group: "MultiConnect",
    spec: { kind: "multiconnect", length: 25, onRamp, detent, clearance: 0, spin: 0 },
    screw: { style: "multiconnect" },
  };
}

export const SCREW_PRESETS = [
  cap(2), cap(2.5), cap(3), cap(4), cap(5), cap(6),
  countersunk(3), countersunk(4), countersunk(5), countersunk(6),
  button(3), button(4), button(5),
  insert(2), insert(2.5), insert(3), insert(4), insert(5), insert(6),
  tap(2.5), tap(3), tap(4), tap(5),
  nutTrap(3), nutTrap(4), nutTrap(5), nutTrap(6),
  wood(3.5, 7.0), wood(4.0, 8.0), wood(5.0, 10.0),
  pilot(3.5, 2.0), pilot(4.0, 2.5),
  {
    id: "plain-3",
    name: "Plain 3 mm hole",
    group: "Plain",
    spec: screw({ diameter: 3, depth: 0, head: "none", headDiameter: 0, headDepth: 0, sinkAngle: 90 }),
    screw: { style: "none", nominal: 3, headDiameter: 0, headHeight: 0 },
  },
  {
    id: "dowel-6",
    name: "6 mm dowel / pin",
    group: "Plain",
    spec: screw({ diameter: 6.1, depth: 12, head: "none", headDiameter: 0, headDepth: 0, sinkAngle: 90 }),
    screw: { style: "pin", nominal: 6, headDiameter: 0, headHeight: 0 },
  },
  openConnect("oc-slot", "openConnect slot", "Lock left", "left"),
  openConnect("oc-slot-both", "openConnect slot, lock both sides", "Lock both", "both"),
  openConnect("oc-slot-free", "openConnect slot, no lock", "No lock", "none"),
  multiConnect("mc-slot", "MultiConnect slot", "On-ramp", { onRamp: true, detent: true }),
  multiConnect("mc-slot-open", "MultiConnect slot, open-ended", "Open end", { onRamp: false, detent: true }),
  multiConnect("mc-slot-release", "MultiConnect slot, quick release", "No detent", { onRamp: true, detent: false }),
];

export const DEFAULT_PRESET_ID = "m3-cap";

const byId = new Map(SCREW_PRESETS.map((p) => [p.id, p]));

export function getPreset(id) {
  return byId.get(id) ?? null;
}

// The presets in display order, grouped: [{ group, presets: [...] }].
export function presetGroups() {
  const groups = [];
  const index = new Map();
  for (const preset of SCREW_PRESETS) {
    let entry = index.get(preset.group);
    if (!entry) {
      entry = { group: preset.group, presets: [] };
      index.set(preset.group, entry);
      groups.push(entry);
    }
    entry.presets.push(preset);
  }
  return groups;
}

// Does `spec` still match what `presetId` prescribes? A hole keeps its
// preset id as the label it was placed with; once a field is edited the
// UI says "(edited)" rather than claiming it is still the preset.
export function specMatchesPreset(spec, presetId) {
  const preset = getPreset(presetId);
  if (!preset) return false;
  return Object.keys(preset.spec).every((key) => Math.abs(Number(spec[key]) - Number(preset.spec[key])) < 1e-9 || spec[key] === preset.spec[key]);
}
