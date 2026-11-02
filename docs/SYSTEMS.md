# Systems

Every mounting system in the catalogue: who made it, where it lives, where its community talks,
which other projects model it, and which systems share a unit. Back to the [README](../README.md).

Connector Foundry recreates these systems; it did not invent any of them. Each entry links the
designer's own pages first, then the community, then the other code that models the same
standard, ours included. Where a part's geometry comes from, and under which licence, is in the
README's ["Where the geometry comes from"](../README.md#where-the-geometry-comes-from) and
["Licensing"](../README.md#licensing). The links were checked in November 2026. Printables,
MakerWorld, Thangs and Reddit block automated checks, so their pages were confirmed by search
rather than opened.

## Storage grids

### Gridfinity

A modular storage system for drawers and desks: bins that stand on a baseplate, on a 42 mm grid,
with heights in 7 mm units. Zack Freedman released it in April 2022, partly inspired by
Alexandre Chappel's Assortment System, and gave the design away under MIT, so anyone may make
Gridfinity-compatible parts.

[Gridfinity: Your Ultimate Modular Workshop is FREE! — Zack Freedman](https://www.youtube.com/watch?v=ra_9zU-mnl8)

- **In the catalogue:** `gridfinity/base`, `gridfinity/bin`, `gridfinity/baseplate`.
- **Home:** [gridfinity.xyz](https://gridfinity.xyz/), the community hub, with the
  [specification](https://gridfinity.xyz/specification/).
- **Original files:** Zack Freedman's
  [Gridfinity baseplates](https://thangs.com/m/60925) on Thangs.
- **Community:** [r/gridfinity](https://www.reddit.com/r/gridfinity/);
  [gridfinity-catalog](https://github.com/jeffbarr/gridfinity-catalog), a catalogue of designs and
  tools.
- **OpenSCAD:** [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad)
  (vendored here),
  [Gridfinity Extended](https://github.com/ostat/gridfinity_extended_openscad)
  ([docs](https://docs.ostat.com/docs/openscad/gridfinity-extended)),
  [vector76's gridfinity_openscad](https://github.com/vector76/gridfinity_openscad),
  [GridFlock](https://github.com/yawkat/GridFlock) (baseplates with puzzle connectors),
  [monoscad](https://github.com/smkent/monoscad) (the Gridfinity Rugged Box).
- **In the browser:** [Perplexing Labs](https://gridfinity.perplexinglabs.com/) runs OpenSCAD
  projects as web generators: Gridfinity Rebuilt and Extended, GRIPS, Anylid, the Rugged Box and
  GridFlock, plus openGrid, Underware, Multiboard and HSW grids. Also
  [gridfinitygenerator.com](https://gridfinitygenerator.com),
  [Gridfinity Layout Tool](https://gridfinitylayouttool.com) and
  [Gridfinity Studio](https://gridfinitystudio.com).
- **Related:** [Gridfinity Refined](https://www.printables.com/model/413761-gridfinity-refined), a
  popular variant of the original bins and baseplates.

### MOD-GRID

A pocket-sized tool grid for everyday carry: a 3 mm plate with 5 mm square holes on an 8 mm pitch,
and accessories (bit holders, tools) that snap in with a two-peg pin. By Tiny Tool Shop (3dedc),
CC BY-NC-SA 4.0. It shares its pitch with [BitBeam and LEGO Technic](#bitbeam-lego-technic-and-mod-grid-8-mm).

[MOD-GRID: Modular EDC Organization. — Tiny Tool Shop](https://www.youtube.com/watch?v=Q-XCzn5icIo)

- **In the catalogue:** `modgrid/grid`, `modgrid/connector` (the pin, reshaped here so its legs
  bend instead of snapping), `modgrid/bit_holder`.
- **Original files:** [MOD-GRID on MakerWorld](https://makerworld.com/en/models/2811701-mod-grid).
- **Press:** [3DPrint.com on MOD-GRID](https://3dprint.com/333268/modgrid-gridfinity-for-in-your-pants/).
- **Related:** [MOD-GRID magnet plates](https://www.printables.com/model/1740495-mod-grid-magnet-plates),
  a community add-on.

### SOLDR

A modular, USB-C powered soldering station whose tool modules stand on a frame by tapered feet
and magnets, on a 30.5 mm unit. By SNRGY Studios (soldr.pro), launched on Kickstarter in 2025;
the printable modules are CC BY-NC-SA 4.0.

[This Modular Soldering Workstation Fits in Your Pocket — SOLDR](https://www.youtube.com/watch?v=wIORi-D70l8)

- **In the catalogue:** `soldr/base`, a module base of any size for modules of your own.
- **Home:** [soldr.pro](https://www.soldr.pro/), and its [3D models](https://www.soldr.pro/3D-models/)
  page.
- **Original files:**
  [Printables](https://www.printables.com/model/1471127-soldr-modular-usb-c-powered-soldering-station),
  [MakerWorld](https://makerworld.com/en/models/1867349).
- **Community:** the [SOLDR Discord](https://discord.gg/UVFqYf7MBU).
- **Related:** the community's [magnifier module](https://www.printables.com/model/1695284).

## Wall and desk grids

### openGrid

A wall and desk mounting framework: thin tiles on a 28 mm grid, screwed to a wall or under a desk,
that snaps, connectors and accessories clip into. By David D, first released in March 2025 under
CC BY 4.0. It meets [Gridfinity every 84 mm](#opengrid-and-gridfinity-84-mm).

[openGrid Intro – 3D printed open board ecosystem — David D](https://www.youtube.com/watch?v=2mDBue4fw3U)

- **In the catalogue:** `opengrid/board`, `opengrid/snap`, `opengrid/openconnect`,
  `opengrid/multiconnect`; the Holes tab cuts openConnect slots and openGrid threads.
- **Home:** [opengrid.world](https://www.opengrid.world/), and the
  [openGrid docs](https://github.com/openGrid-3D/openGrid-docs) on GitHub.
- **Original files:**
  [Printables](https://www.printables.com/model/1214361-opengrid-walldesk-mounting-framework-and-ecosystem),
  [MakerWorld](https://makerworld.com/en/models/1179191).
- **Community:** [r/openGrid](https://www.reddit.com/r/openGrid/).
- **OpenSCAD:** the official [openGrid-openSCAD](https://github.com/openGrid-3D/openGrid-openSCAD),
  [QuackWorks](https://github.com/AndyLevesque/QuackWorks) (BlackjackDuck's; vendored here for the
  board and snap), [openGrid-projects](https://github.com/mitufy/opengrid-projects) (mitufy's
  snaps and openConnect; vendored here).
- **In the browser:** the [openGrid tile generator](https://gridfinity.perplexinglabs.com/pr/opengrid/0/0)
  on Perplexing Labs, and the [one on MakerWorld](https://makerworld.com/en/models/1304337-opengrid-tile-generator).
- **Connectors:** [openConnect](https://makerworld.com/en/models/2257440), openGrid's own,
  by mitufy; MultiConnect ([v1](https://www.printables.com/model/716558),
  [v2](https://www.printables.com/model/1074671)), David D's earlier connector for Multiboard,
  which openConnect stays compatible with.
- **Related:** [Underware](#underware), cable management for under a desk by Hands on Katie and
  BlackjackDuck ([for openGrid](https://www.printables.com/model/1214427),
  [2.0](https://handsonkatie.com/underware-2-0-the-made-to-measure-collection/)).
  [Multiboard](#multiboard), the 25 mm system openGrid grew up beside.
- **Compared:** [HSW vs. Multiboard vs. OpenGrid vs. GOEWS](https://www.youtube.com/watch?v=_eeB1wMST88),
  The Newbie Maker's side-by-side of four wall systems.

### Multiboard

A wall system of tiles on a 25 mm grid, by Keep Making (Jonathan K), now called MultiBuild: a
threaded big hole in every cell and a threaded small hole at every corner between four, that bolts,
snaps and pegs screw into. Its designs are under the MultiBuild Licence, which allows personal use
only, no redistribution, and can be withdrawn, so no tile and no Multiboard part is in the
catalogue. What is here only carries the tile's two threads, made from the community's
measurements, so a part of ours screws into a tile and a hole of ours takes Multiboard's bolts.

- **In the catalogue:** `multiboard/snap` (the big thread, under a head to fuse a part onto),
  `multiboard/peg` (the small thread); the Holes tab cuts both threads as the tile does.
  `opengrid/multiconnect` and the Holes tab's MultiConnect slot hang Multiboard's MultiConnect
  accessories. Both are `parametric`: the thread numbers are not yet checked against a printed
  tile.
- **Home:** [multibuild.io](https://multibuild.io/), and its
  [licence](https://multibuild.io/license).
- **Original files:** on Thangs, under Keep Making and MultiBuild; the
  [8x8 core tile](https://thangs.com/designer/Keep%20Making/3d-model/8x8%20Multiboard%20Core%20Tile-974214).
- **Community:** [r/Multiboard](https://www.reddit.com/r/Multiboard/).
- **OpenSCAD:** [multiboard-parametric](https://github.com/shaggyone/multiboard-parametric), whose
  measurements our threads use;
  [multiboard-openscad](https://github.com/haliphax/multiboard-openscad),
  [mb-tile-generator](https://github.com/slynn1324/mb-tile-generator).
- **In the browser:** Perplexing Labs' Multiboard hexgrid.

### GOEWS

The Greatly Over Engineered Wall System, by MrExo3D: tiles screwed straight to the wall, hexagonal
cells 42 mm across their flats (each row 36.373 mm above the last and half a cell over) or GOEWS
GRID's 42 × 36.373 mm rectangles, with no inserts or tile connectors. Every cell has a window; an
accessory's hanger plate drops into it onto 45° cleats, and an optional M14 × 2 bolt through the
plate locks it. Built on [Gridfinity's 42 mm](#goews-and-gridfinity-42-mm-across), so its shelves
take Gridfinity bins. CC BY 4.0, with commercial use explicitly allowed.

- **In the catalogue:** `goews/tile` (hex or grid, any number of cells each way) and
  `goews/hanger` (the hanger plate, any number of units wide, to fuse onto any part so it hangs on a
  GOEWS wall), rebuilt from the designer's STLs and checked against them.
- **Home:** [goews.ws](https://goews.ws/), with a [Part Builder](https://build.goews.ws/) and
  [Anything GOEWS](https://anything.goews.ws/), which turns any STL into a GOEWS accessory.
- **Original files:**
  [Printables](https://www.printables.com/model/1090032-goews-greatly-over-engineered-wall-system),
  [MakerWorld](https://makerworld.com/en/models/829453-goews-greatly-over-engineered-wall-system).
- **Community:** [r/GOEWS](https://www.reddit.com/r/GOEWS/), [lemmy.ca/c/GOEWS](https://lemmy.ca/c/GOEWS/).
- **OpenSCAD:** jimfunk's [goews-rebuilt-openscad](https://github.com/jimfunk/goews-rebuilt-openscad)
  (no licence file on GitHub; its
  [Printables copy](https://www.printables.com/model/1183799-goews-rebuilt-in-openscad) is CC BY),
  which adds a "thicker cleats" variant that doesn't fit the original.
- **Related:** joncruz's [GOEWS in FreeCAD](https://www.printables.com/model/1196368-goews-in-freecad),
  and [GOEWS Square – 42H Legacy](https://www.printables.com/model/1093740-goews-square-42h-legacy),
  a square variant on 42 mm both ways.

### Honeycomb Storage Wall

A wall of hexagonal cells, 20 mm across their openings, that inserts clip into from the front.
By RostaP, 2021.

- **In the catalogue:** `hsw/wall`, `hsw/insert`.
- **Original files:** [Printables](https://www.printables.com/model/152592-honeycomb-storage-wall),
  [MakerWorld](https://makerworld.com/en/models/22521).
- **Community:** [r/honeycombwall](https://www.reddit.com/r/honeycombwall/).
- **OpenSCAD:** geru's [3d-scad-hsw-customizable](https://github.com/geru/3d-scad-hsw-customizable)
  and [3d-scad-hsw-clip](https://github.com/geru/3d-scad-hsw-clip) (both vendored here), an
  [OpenSCAD attachment library](https://printables.com/model/260073) on Printables.
- **In the browser:** [replicad-hsw-generator](https://github.com/sgenoud/replicad-hsw-generator),
  [hsw-stl-generator](https://github.com/Biboque/hsw-stl-generator), and Perplexing Labs' HSW grid.
- **Related:** a [MultiConnect connector for HSW](https://www.printables.com/model/987886), and
  [KLAMMA's HSW version](https://printables.com/model/442180) (the clip [KLIPPT](#klippt) grew from).

### Skådis

IKEA's pegboard: a 5 mm board with 5 × 15 mm slots in a checkerboard on a 20 mm grid. IKEA
publishes no specification, so its numbers are the boards' and the community's.

- **In the catalogue:** `skadis/board`, `skadis/peg`; the Holes tab cuts Skådis slots on the
  same spacing.
- **Home:** IKEA's [SKÅDIS series](https://www.ikea.com/us/en/cat/skadis-series-37813/).
- **OpenSCAD:** [parametric-skadis-tower](https://github.com/breckenedge/parametric-skadis-tower)
  (measured against here), franpoli's
  [Skådis pegboard accessories](https://github.com/franpoli/OpenSCADutil/tree/master/libraries/ikea_skadis_pegboard_accessories),
  melance's [skadis.scad](https://github.com/melance/OpenScad-Libraries),
  [skadis_tnut_openscad](https://github.com/mayjs/skadis_tnut_openscad),
  [models-skadis](https://github.com/dredzik/models-skadis).
- **Related:** Mechanism makes a [Skådis mount](https://www.printables.com/model/1337460-mechanismdeckmate-wallskadis-mount-innie)
  for [DeckMate](#deckmate).

### Underware

Hands on Katie and BlackjackDuck's under-desk cable management: channels made of a base that
mounts to openGrid, Multiboard or any flat surface (snap connectors, screws, magnets or tape) and a
top that snaps onto it with no glue, sized in 25 mm units. Upstream's OpenSCAD generates straight,
L, T, X, Y, S, C, mitre, diagonal and height-change channels, plus connectors, hooks and item
holders. Here the straight and L channels are catalogue parts, base and top each, built from
upstream's own channel profiles (`lib/underware.scad`), so the Holes tab can cut cable exits or
screw holes into them and the Bench can fuse a hook or a connector onto a top's roof or a base's
underside. CC BY-NC-SA 4.0, prints included.

David D's Underware for openGrid is the one-piece version for openGrid boards: no base, just a
channel whose walls end in grips that snap straight into a board's cells, sized in openGrid's
28 mm cells. It comes first in the Library's Underware list. Its straight and L channels are built
from Pedro Leite's OpenSCAD version, Monokini (`lib/underware_opengrid.scad`), and checked against
both Monokini's scripts and David D's own files.

- **In the catalogue:** `underware/opengrid_i_channel`, `underware/opengrid_l_channel` (for
  openGrid); `underware/i_channel_base`, `underware/i_channel_top`, `underware/l_channel_base`,
  `underware/l_channel_top` (the original). Left out: the junctions (T, X, Y), which need
  upstream's "channel clear" cuts; the snap connector, which is under [Multiboard](#multiboard)'s
  licence rather than CC BY-NC-SA.
- **Home:** [handsonkatie.com/underware](https://www.handsonkatie.com/underware).
- **Original files:** [Underware 2.0 on MakerWorld](https://makerworld.com/en/models/783010),
  [Underware for openGrid](https://www.printables.com/model/1214427).
- **Community:** [Hands on Katie on YouTube](https://www.youtube.com/channel/UCLqQ5m7AXj_oyUvLZPsts0Q),
  [Patreon](https://www.patreon.com/HandsonKatie).
- **OpenSCAD:** [QuackWorks/Underware](https://github.com/AndyLevesque/QuackWorks/tree/main/Underware)
  (BlackjackDuck's; vendored here, and every part checked against its script);
  [Monokini](https://github.com/pleite/Monokini) (Pedro Leite's, for openGrid; vendored here too).
- **In the browser:** Perplexing Labs' Underware for openGrid;
  [Underware for openGrid Customizer](https://makerworld.com/en/models/1329404) (Monokini, on
  MakerWorld).
- **Related:** [openGrid](#opengrid), whose boards the bases and the openGrid channels snap to.

## Mounts and clips

### GoPro

The two- and three-prong buckle every action camera mount uses: Ø15 mm prong ends, 3 mm prongs,
an M5 bolt through them. GoPro publishes no specification; the shape is what every mount agrees
on.

- **In the catalogue:** `gopro/male`, `gopro/female`.
- **Community:** [r/gopro](https://www.reddit.com/r/gopro/).
- **OpenSCAD:** [GoProScad](https://github.com/ridercz/GoProScad) by Michal Altair Valášek
  (vendored here), [gopro_customizable_mounts](https://github.com/MoonCactus/gopro_customizable_mounts)
  (the source of the popular Thingiverse customizer),
  [GoPro-compatible mounting plate](https://github.com/lucasgelfond/GoPro-compatible-mounting-plate).

### DeckMate

Mechanism's accessory mount, first for the Steam Deck: two halves, the Innie and the Outie,
that slide together, and a three-hole screw pattern to fasten them to things. Mechanism publishes its
own models (CC BY-NC 4.0).

[How to 3D print and Assemble Deckmate, the Best Steam Deck Accessory! — Mechanism](https://www.youtube.com/watch?v=CW3o0NRpALo)

- **In the catalogue:** `deckmate/innie`, `deckmate/outie`, `deckmate/universal`; the Holes tab
  cuts a DeckMate socket; the screwed joint uses its screw pattern.
- **Home:** [getmechanism.com](https://getmechanism.com/), and its
  [digital files](https://getmechanism.com/pages/digital-files).
- **Original files:** [Mechanism on Printables](https://www.printables.com/@get_mechanism),
  starting with the [DeckMate](https://www.printables.com/model/214467-mechanism-steam-deck-deckmate);
  the [VESA mount](https://www.printables.com/model/1337447-mechanismdeckmate-vesa-mount) and the
  [wall and Skådis mount](https://www.printables.com/model/1337460-mechanismdeckmate-wallskadis-mount-innie)
  put an Innie anywhere.
- **Community:** [r/SteamDeck](https://www.reddit.com/r/SteamDeck/), where Mechanism posts its
  updates.

### KLIPPT

A cable clip that slides onto a small base, stuck or screwed in place, and locks onto it. By FH (bequ3), CC BY-SA 4.0, the successor to their KLAMMA clip.

- **In the catalogue:** `klippt/base`, `klippt/clip_mount`; the Holes tab cuts the clip's
  channel into any part.
- **Original files:** [KLIPPT on Printables](https://www.printables.com/model/424351-klippt-locking-cable-clip),
  and the designer's [other models](https://www.printables.com/@bequ3), among them
  [KLAMMA](https://www.printables.com/model/359285).

### MOLLE

The webbing grid on military and outdoor gear: PALS rows of 25.4 mm (1") webbing, 25.4 mm apart,
stitched down every 38.1 mm (1.5"). Rigid MOLLE panels, as on vehicles, have no standard of their
own.

- **In the catalogue:** `molle/spine`, `molle/panel`, `molle/rigid_panel`, `molle/insert`.
- **Reference:** Wikipedia on [PALS](https://en.wikipedia.org/wiki/Pouch_Attachment_Ladder_System)
  and [MOLLE](https://en.wikipedia.org/wiki/MOLLE).
- **Community:** [r/tacticalgear](https://www.reddit.com/r/tacticalgear/).
- **Related:** [SlickStick](https://www.printables.com/model/316746-slickstick-clip-for-molle-attachment),
  a two-piece MOLLE clip with commented OpenSCAD files;
  [a MOLLE phone mount](https://github.com/drfibonacci/s23-ultra-thinborne-molle-flip-down-mount)
  in OpenSCAD.

### Camera

Two standards: the tripod screw (1/4"-20 on cameras, 3/8"-16 on tripod heads, ISO 1222), and the
Arca-Swiss-style dovetail of quick-release plates, which no one has published as a standard and
makers vary by tenths of a millimetre.

- **In the catalogue:** `camera/arca_plate`, `camera/tripod_socket`; the Holes tab traps tripod
  nuts.
- **Reference:** Wimberley's
  [Arca-Swiss style geometry](https://www.tripodhead.com/products/product-details2.cfm?product=arca-swiss-geometry)
  and [compatibility notes](https://www.tripodhead.com/products/WH-Compatibility.cfm);
  [the tripod thread](https://threadingtoolsguide.com/en/blog/tripod-thread-din-4503-1-iso-1222/)
  (ISO 1222, DIN 4503-1).
- **OpenSCAD:** [BOSL2](https://github.com/BelfrySCAD/BOSL2)'s UTS threads cut the tripod socket.

### MagSafe

Apple's magnetic ring on the back of an iPhone. Apple's own magnets are not for sale, so a printed
mount holds an aftermarket magnet ring or a steel disk. Qi2's Magnetic Power Profile is the open
standard built on it.

- **In the catalogue:** `magsafe/mount`.
- **Reference:** Apple's
  [Accessory Design Guidelines](https://webcf.waybackmachine.org/web/20211202174234/https://developer.apple.com/accessories/Accessory-Design-Guidelines.pdf)
  (MagSafe is section 26); the Wireless Power Consortium on
  [Qi2](https://www.wirelesspowerconsortium.com/blog-pages/new-qi2-standard-for-wireless-devices-ensures-enhanced-consumer-convenience-and-efficiency/)
  and [how magnetic chargers work](https://www.wirelesspowerconsortium.com/blog-pages/how-do-magnetic-chargers-work/);
  Hackaday's [MagSafe and how to roll your own](https://hackaday.com/2025/02/25/tech-in-plain-sight-magsafe-and-how-to-roll-your-own).
- **OpenSCAD:** [magsafe.scad](https://github.com/vaaski/magsafe.scad),
  [magsafe-mount-openscad](https://github.com/matthewfcarlson/magsafe-mount-openscad).

## Building systems

### BitBeam

Printable beams on LEGO Technic's grid: 8 × 8 mm beams with Ø4.8 mm holes every 8 mm, joined
with Technic pins and axles. bitbeam.cc is Ondřej Tůma's continuation of Jason Huggins' original
BitBeam, which descends from Grid Beam. It shares its grid with
[MOD-GRID](#bitbeam-lego-technic-and-mod-grid-8-mm), and lines up with
[Skådis](#skådis-and-the-8-mm-systems-40-mm) every 40 mm.

- **In the catalogue:** `bitbeam/beam`, `bitbeam/plate`; the pin joint uses a real Technic pin.
- **Home:** [bitbeam.cc](https://bitbeam.cc/), its [parts catalogue](https://catalog.bitbeam.cc/)
  and [forum](https://forum.bitbeam.cc/en/); the original [bitbeam.org](https://bitbeam.org/);
  [Grid Beam](https://gridbeam.xyz/).
- **Original files:** the [bitbeam tag](https://www.printables.com/cs/search/models?q=tag:bitbeam)
  on Printables.
- **Community:** [r/legotechnic](https://www.reddit.com/r/legotechnic/) for Technic.
- **OpenSCAD:** [bitbeam-lib](https://github.com/ondratu/bitbeam-lib) by the same author (vendored
  here; also Meccano/Merkur sizes), [m-bitbeam](https://github.com/ondratu/m-bitbeam) built on it,
  [technic.scad](https://github.com/cfinke/technic.scad) (vendored here for the pin and axle),
  [PELA blocks](https://github.com/paulirotta/PELA-blocks).

### 2020 extrusion

20 × 20 mm aluminium profile with a slot down each face, the frame of many 3D printers. T-slot
and V-slot (OpenBuilds' design) differ in the slot's shape, and suppliers differ by tenths, so the
fittings here are `parametric`.

- **In the catalogue:** `extrusion2020/tab`, `extrusion2020/clip`, `extrusion2020/endcap`,
  `extrusion2020/corner-bracket`, `extrusion2020/c-clip`, `extrusion2020/rail`; the Holes tab cuts
  2020 sockets.
- **Home:** [OpenBuilds](https://openbuilds.com/), where V-slot comes from.
- **OpenSCAD:** [NopSCADlib](https://github.com/nophead/NopSCADlib)'s extrusions (measured against
  here), [AluminumExtrusionProfile](https://github.com/ServerNinja/OpenSCAD_AluminumExtrusionProfile_Library)
  (vendored here for the rail), [openscad-v-slot](https://github.com/mmalecki/openscad-v-slot),
  [OpenSCAD_connectors](https://github.com/adgaudio/OpenSCAD_connectors) (corner brackets and
  T-joints), [openscad_vslot_wheels](https://github.com/eraga/openscad_vslot_wheels).

## OpenSCAD in general

[BOSL2](https://github.com/BelfrySCAD/BOSL2) is what every part here is built on: its attachments
are the slot convention. [r/openscad](https://www.reddit.com/r/openscad/) is the place to ask about
OpenSCAD itself. The `basics/*` parts belong to no system: plain plates, posts and a dovetail to
build between the others.

## Shared units

Some systems were built on the same number, by design or by luck, and those line up without an
adapter. Their grids, in millimetres:

| System | Grid | Built from |
| --- | --- | --- |
| [Gridfinity](#gridfinity) | 42 × 42 cells, 7 high | 7 mm (6 × 7 across, 1 × 7 up) |
| [openGrid](#opengrid) | 28 × 28 cells | 7 mm (4 × 7) |
| [GOEWS](#goews) | 42 across, rows 36.373 up (42 · √3/2) | Gridfinity's 42 mm, across only |
| [BitBeam](#bitbeam) and LEGO Technic | 8 mm pitch, Ø4.8 round holes | 8 mm |
| [MOD-GRID](#mod-grid) | 8 mm pitch, 5 mm square holes | 8 mm |
| [Skådis](#skådis) | slots 40 apart along a row, rows 20 apart | 20 mm |
| [2020 extrusion](#2020-extrusion) | 20 × 20 profile, one slot a face | 20 mm |
| [Multiboard](#multiboard) | 25 × 25 cells | 25 mm |
| [MOLLE](#molle) | 25.4 rows, 38.1 across | inches (1", 1.5") |
| [SOLDR](#soldr) | 30.5 × 30.5 units | — |
| [Honeycomb Storage Wall](#honeycomb-storage-wall) | hex cells, 20 openings, 20.44 across × 23.6 up | — |

### openGrid and Gridfinity: 84 mm

**3 openGrid cells are 2 Gridfinity cells:** 3 × 28 = 2 × 42 = 84 mm. Both grids are multiples
of 7 mm, Gridfinity's height unit (28 = 4 × 7, 42 = 6 × 7), so they meet every 84 mm. A
Gridfinity baseplate an even number of cells wide covers a whole number of openGrid cells, and
so lines up with the board's cells behind it. openGrid's documentation lists Gridfinity among the
systems it is compatible with, and David D's intro video has a chapter on it.

### GOEWS and Gridfinity: 42 mm across

**GOEWS is Gridfinity's 42 mm across:** one cell per Gridfinity cell, so a GOEWS shelf takes
Gridfinity bins. Not up the wall: a hex tile's rows are 42 · √3/2 = 36.373 mm apart, and GOEWS
GRID keeps those rows; only the "42H Legacy" square variant is 42 mm both ways. It has no use for
Gridfinity's 7 mm height unit (a tile is 6 mm thick). Across, it meets openGrid every 84 mm as
Gridfinity does (three openGrid cells, two GOEWS cells); up, its rows never meet openGrid's.

### BitBeam, LEGO Technic and MOD-GRID: 8 mm

**BitBeam is LEGO Technic's grid:** 8 mm from hole to hole and Ø4.8 mm holes, so Technic pins
and axles go straight in (the catalogue's BitBeam pin and axle *are* Technic parts). **MOD-GRID
is on the same 8 mm pitch**, and its 5 mm square holes take a Ø4.8 mm Technic pin with 0.1 mm to
spare on each side. A MOD-GRID plate is 3 mm thick where a beam is 8 mm deep, and a Technic
friction pin is made to grip an 8 mm hole, so a pin through a MOD-GRID plate locates a part
exactly but holds it loosely. A BitBeam beam or plate and a MOD-GRID grid can be pinned
together hole for hole.

### Skådis and the 8 mm systems: 40 mm

Skådis slots are 40 mm apart along a row, which is 5 × 8 mm: a BitBeam beam or a MOD-GRID strip
laid along a row has a hole centred on every slot in it. The next row is shifted 20 mm, two and a
half holes, so only every other row lines up with the same beam.

### Gridfinity and SOLDR: the same magnets

Gridfinity's magnet holes and SOLDR's are both Ø6.5 mm for Ø6 mm disc magnets. One bag of
6 × 2 mm magnets serves both.

### Near misses

Close enough to look compatible, far enough apart to drift:

- **Skådis 40 and Gridfinity 42.** 2 mm a cell: after five cells a Gridfinity grid is half a cell
  off Skådis.
- **openGrid 28 and Multiboard 25.** Different grids, though the MultiConnect connector fits both
  (openGrid's openConnect is made to be backwards compatible with it).
- **Multiboard 25 and the inch's 25.4 (MOLLE).** 0.4 mm a cell: 4 mm out after ten.
