// The landing page hero's assemblies: a base part from one mounting
// system with a part from another attached to its "mount" slot, the way
// the Bench attaches them (a fused joint, catalogue defaults, plus the
// catalogue's `attached_defaults` for the attached part).
//
// One list for both sides: scripts/hero-parts.mjs renders each pair into
// assets/hero-parts.bin (the base on its own, the attached part in its
// attached pose), and hero.js shows them in turn while the headline names
// the two systems — "Connect <base> to <attached>." Adding or changing a
// pair means running that script again.

/**
 * @typedef {object} HeroPart
 * @property {string} part   catalogue id
 * @property {string} words  what the headline calls it
 * @property {Record<string, any>} [params] parameters over the catalogue defaults
 */

/**
 * @typedef {object} HeroPair
 * @property {string} key      names the pair's meshes in hero-parts.bin
 * @property {string} label    the pair's button under the 3D view
 * @property {HeroPart} base     the part that stays on the floor
 * @property {HeroPart} attached the part that lands on the base's slot
 */

// Each attached part is no bigger across than the base it lands on (a
// unit test holds them to that): a pair should look like a mount on
// something, not a plate balanced on a peg. The openGrid snaps are always
// the base, never the attached part: deep enough already that one
// attached to another part runs out of WASM stack (web/README.md, "Known
// limit — nesting depth").
/** @type {HeroPair[]} */
export const HERO_PAIRS = [
  {
    key: "gridfinity-gopro",
    label: "Gridfinity",
    base: { part: "gridfinity/base", words: "Gridfinity" },
    attached: { part: "gopro/female", words: "GoPro" },
  },
  {
    key: "opengrid-gopro",
    label: "openGrid",
    base: { part: "opengrid/snap", words: "openGrid" },
    attached: { part: "gopro/male", words: "GoPro" },
  },
  {
    key: "hsw-opengrid",
    label: "Honeycomb",
    base: { part: "hsw/insert", words: "Honeycomb Wall" },
    attached: { part: "opengrid/openconnect", words: "openGrid" },
  },
  {
    // Named for the attached part: the Gridfinity button is the GoPro pair.
    key: "gridfinity-deckmate",
    label: "DeckMate",
    base: { part: "gridfinity/base", words: "Gridfinity" },
    attached: { part: "deckmate/innie", words: "DeckMate" },
  },
  {
    key: "klippt-gopro",
    label: "KLIPPT",
    base: { part: "klippt/base", words: "KLIPPT" },
    // Equal prongs: the default's wider nut leg runs a millimetre past
    // the 20mm octagon.
    attached: { part: "gopro/female", words: "GoPro", params: { outer_w: 3 } },
  },
];

/**
 * Where a pair's two meshes are in hero-parts.bin. A base part on its own
 * looks the same in every pair it stands in, so it is stored once, under
 * its id and parameters; an attached part sits where its pair's base puts
 * it, so it is the pair's own.
 * @param {HeroPair} pair
 * @returns {{ base: string, attached: string }}
 */
export function meshNames(pair) {
  const params = pair.base.params ? JSON.stringify(pair.base.params) : "";
  return { base: `base:${pair.base.part}${params}`, attached: `${pair.key}/attached` };
}
