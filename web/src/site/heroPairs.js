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

/** @type {HeroPair[]} */
export const HERO_PAIRS = [
  {
    key: "gridfinity-gopro",
    label: "Gridfinity",
    base: { part: "gridfinity/base", words: "Gridfinity" },
    attached: { part: "gopro/male", words: "GoPro" },
  },
  {
    key: "hsw-opengrid",
    label: "Honeycomb",
    base: { part: "hsw/insert", words: "Honeycomb Wall" },
    attached: { part: "opengrid/openconnect", words: "openGrid" },
  },
  {
    key: "arca-skadis",
    label: "Arca-Swiss",
    base: { part: "camera/arca_plate", words: "Arca-Swiss" },
    attached: { part: "skadis/peg", words: "Skådis" },
  },
  {
    key: "molle-camera",
    label: "MOLLE",
    base: { part: "molle/spine", words: "MOLLE" },
    attached: { part: "camera/tripod_socket", words: "your camera" },
  },
];
