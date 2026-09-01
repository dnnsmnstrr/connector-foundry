# Connector Foundry

A library of printable mounting interfaces — Gridfinity, openGrid, GoPro, DeckMate, 2020
extrusion — that you can pull as an STL and drop into Tinkercad, and that compose with each
other through named slots.

OpenSCAD `.scad` files are the source of truth. The same sources drive three ways to get a
part:

- **the browser app** (`web/`) — pick a part, tweak parameters, export an STL, all client-side
  via `openscad-wasm`. This is the primary way to use the library.
- **the CLI** (`cli/foundry.py`) — `foundry render gridfinity/base --gx 2 --magnets -o out/`
- **OpenSCAD directly** — open any file under `parts/` or `assemblies/` in the OpenSCAD GUI.

## Stack

OpenSCAD with the Manifold backend, [BOSL2](https://github.com/BelfrySCAD/BOSL2) for its
attachment system, a Python CLI, and a small React + `openscad-wasm` web app that compiles the
same `.scad` sources in-browser.

Where a standard already has a reference implementation, this repo **calls it** rather than
re-deriving it. Those upstreams are vendored as git submodules under `vendor/`, and the
corresponding files in `parts/` are thin wrappers that add nothing but this repo's slot
convention:

| Submodule | Upstream | Used by |
| --- | --- | --- |
| `vendor/BOSL2` | [BelfrySCAD/BOSL2](https://github.com/BelfrySCAD/BOSL2) | everything |
| `vendor/gridfinity-rebuilt` | [kennetek/gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) | `parts/gridfinity/` |
| `vendor/GoProScad` | [ridercz/GoProScad](https://github.com/ridercz/GoProScad) | `parts/gopro/` |
| `vendor/QuackWorks` | [AndyLevesque/QuackWorks](https://github.com/AndyLevesque/QuackWorks) | `parts/opengrid/` |

Systems with no reference implementation to call — 2020 extrusion, DeckMate — are modelled
here, and the ones that can be are checked against an independent model instead. See
**Accuracy** below.

## Quick start

```bash
git clone --recurse-submodules <repo-url>
cd connector-foundry
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python cli/foundry.py list
.venv/bin/python cli/foundry.py render gridfinity/base --gx 2 --magnets -o out/
.venv/bin/python -m pytest tests/
```

Already cloned without `--recurse-submodules`? `git submodule update --init --recursive`.

The web app (`cd web && npm install && npm run dev`) is the primary way most people will use
this: pick a part, tweak parameters, preview it, export an STL — no local OpenSCAD install
needed. It compiles the exact same `parts/`/`lib/` sources via `openscad-wasm` in a Web Worker.
See `web/README.md` for how it's wired up.

## Slot convention

- The functional face of every part is its **BOTTOM** — also its print orientation.
- The default mount point is a named anchor `"mount"` on **TOP**.
- Parts with more faces (plate, post) declare extra named anchors on their other faces.
- Attaching through a slot consumes it: a part attached via `"mount"` no longer offers that
  anchor to further composition.

Physical constants live only in `lib/constants.scad`. For a system whose geometry comes from a
submodule, the constants live upstream and `lib/constants.scad` says so rather than keeping a
second copy — a duplicated constant is a constant that can drift. The few that must be restated
(upstream keeps them file-private, so `use <>` will not import them) are labelled, and a
reference check fails if they drift. Printer fit tolerance goes through one global,
`FIT_CLEARANCE`.

## Joints

`lib/joints.scad` implements three ways to mate two parts through their mount slots:

- **fused** — plain `attach("mount", "mount")`. One printed body.
- **bolted** — a flange fused onto each side's mount face, on a shared 4-hole pattern: an
  insert bore on side A, a clearance hole on side B.
- **snap** — barbed pegs on side A, matching holes on side B.

Bolted and snap assemblies expose `part = "all" | "a" | "b"` so each printable body renders to
its own STL — see `assemblies/`.

## Catalogue

`catalogue.yaml` is the single source of truth for what exists: part id, system, module,
default parameters, confidence (`exact` = published spec or reference implementation,
`parametric` = a starting point, verify against real hardware), and a print note. The CLI, the
tests, and this table are all generated from it — run `foundry readme` after adding a part.

<!-- CATALOGUE:START -->
| Part | System | Confidence | Licence | Print note |
| --- | --- | --- | --- | --- |
| ![Bin base](docs/img/gridfinity_base.png)<br>Bin base | Gridfinity | exact | MIT | Print as-is, functional face (feet) down. No supports needed. |
| ![Two-prong male buckle](docs/img/gopro_male.png)<br>Two-prong male buckle | GoPro | exact | MIT | Legs face down for slot consistency; use a brim for first-layer adhesion. Mates with any GoPro-standard three-prong buckle — proved against the upstream model, not just against our own female. |
| ![Three-prong female buckle](docs/img/gopro_female.png)<br>Three-prong female buckle | GoPro | exact | MIT | Legs face down for slot consistency; use a brim for first-layer adhesion. nut_depth sinks a captive square-nut pocket in the far leg; set it to 0 for a plain through-hole. |
| ![Dovetail rail (Outie)](docs/img/deckmate_outie.png)<br>Dovetail rail (Outie) | DeckMate | parametric | MIT | Unmeasured — verify against your hardware before trusting the fit. Prints tip-down, self-supporting; end_stop adds a tab at one end to keep an Innie from sliding off. |
| ![Dovetail channel (Innie)](docs/img/deckmate_innie.png)<br>Dovetail channel (Innie) | DeckMate | parametric | MIT | Unmeasured — verify against your hardware before trusting the fit. Print mouth-down as oriented; channel is a through-slot, open at both ends for lengthwise assembly onto the Outie. |
| ![T-slot tab (hammer-head)](docs/img/extrusion2020_tab.png)<br>T-slot tab (hammer-head) | 2020 Extrusion | parametric | MIT | Supplier-dependent — check EX_* in lib/constants.scad against your rail. Head flanks are chamfered at EX_FLOOR_ANGLE to follow the channel floor. tab_len <= 6mm (the default) drops into the slot face-first and twists 90 degrees to lock, anywhere along the rail; longer heads must be fed in endwise from an open end. |
| ![Snap-in clip](docs/img/extrusion2020_clip.png)<br>Snap-in clip | 2020 Extrusion | parametric | MIT | Supplier-dependent — check EX_* in lib/constants.scad against your rail. Push straight into the slot mid-rail, no end access needed; the legs flex through EX_SLOT_OPEN and the barbs spring out under the lip. Print in a flexible-enough filament (PETG/nylon) — stiff PLA legs may snap. |
| ![End-face plate](docs/img/extrusion2020_endcap.png)<br>End-face plate | 2020 Extrusion | parametric | MIT | Supplier-dependent — check EX_* in lib/constants.scad against your rail. Locating keys print face-down as oriented; the plate overhangs them at its four corners, so add a brim or light support there. |
| ![Corner bracket](docs/img/extrusion2020_corner-bracket.png)<br>Corner bracket | 2020 Extrusion | parametric | MIT | Supplier-dependent — check EX_* in lib/constants.scad against your rail. Print with the base flange down as oriented; the upright flange is a self-supporting 90 degree wall. Bore centers assume the bracket sits centered on each extrusion face — check against your T-nut/bore spacing. |
| ![Profile C-clip](docs/img/extrusion2020_c-clip.png)<br>Profile C-clip | 2020 Extrusion | parametric | MIT | Supplier-dependent — check EX_* in lib/constants.scad against your rail. Snaps over the OUTSIDE of the extrusion through its open side; print with the ring axis vertical as oriented (zero overhang either way up). Confirm your printer's flex/tolerance can open the gap without cracking. |
| ![Mounting board](docs/img/opengrid_board.png)<br>Mounting board | openGrid | exact | CC-BY-NC-SA-4.0 | Grid face up, flat on the bed. A tile is exactly cells x 28mm, so boards butt against each other with no border. "full" is the default; "lite" is 4mm, "heavy" is 13.8mm. |
| ![Cell snap](docs/img/opengrid_snap.png)<br>Cell snap | openGrid | exact | CC-BY-NC-SA-4.0 | Print in a material with some flex (PETG/PLA+) so the retaining wings can compress; no supports needed. A snap sits within the board's thickness. Note the "lite" snap is a half-height snap (3.4mm), which is not the same thing as a lite tile (4.0mm). |
| ![Flat plate](docs/img/basics_plate.png)<br>Flat plate | Basics | exact | MIT | Flat on the bed, no supports needed. Named anchors on all 6 faces — branch composition off any side, not just top/bottom. |
| ![Round post](docs/img/basics_post.png)<br>Round post | Basics | exact | MIT | Stands upright on its "bot" anchor (flat end down), no supports needed. |
<!-- CATALOGUE:END -->

## Accuracy

A part that is the wrong shape still renders, is still watertight, and still has a perfectly
stable bounding box. Golden dimensions cannot catch it; only comparing against somebody else's
model of the same standard can. `references.yaml` declares those comparisons and `make verify`
runs them:

```bash
make refs      # fetch reference sources into refs/ (gitignored)
make verify    # run every check, print the report
```

Two kinds of check:

- **shape** — render our part and the reference through the same OpenSCAD binary, then compare
  volume, symmetric surface distance (sampled both ways, so a missing feature cannot hide), and
  the cross-section outline at declared heights. Section IoU is the one that matters: it catches
  a mating profile that is the right overall size and the wrong shape through its depth, which
  is exactly what volume averages away.
- **fit** — put our part and its real counterpart in the assembled pose and intersect them.
  `interference` is the volume the two solids try to occupy at once; above a print's worth of
  slop they do not go together. `clearance` is the smallest surface-to-surface gap; too much is
  a rattle. The assembled pose is written in OpenSCAD, not in a YAML transform mini-language, so
  the same tool does the transform algebra that does the modelling — and the boolean is
  OpenSCAD's own Manifold kernel, which copes with upstream models a mesh boolean refuses.

`confidence: exact` in the catalogue is a claim, and a test fails if a part makes it without a
check to back it. Current state — all 14 checks pass:

```
pass  gridfinity/base-1x1                 vol 0.00%  rms 0.0000mm  section IoU 1.0000
pass  gopro/male                          vol 0.00%  rms 0.0000mm  section IoU 1.0000
pass  opengrid/board-full-2x2             vol 0.00%  rms 0.0000mm  section IoU 1.0000
pass  gopro/male-into-upstream-female     interference 0.000mm3  clearance 0.2500mm
pass  extrusion2020/tab-in-slot           interference 0.000mm3  clearance 0.0000mm
...
```

Reference sources are never committed. They are either a submodule already in `vendor/`, or a
pinned commit fetched into `refs/` — which is how sources this repo may read and measure but may
not redistribute (CC-BY-NC-SA, GPL) stay out of the tree. Submodule-backed checks run offline;
the rest skip rather than fail without a network.

### Supplier CAD

A `kind: file` reference source takes a STEP (or STL) that you supply yourself — the usual shape
of a real manufacturer reference, since those downloads sit behind logins and cannot be
redistributed. STEP is converted to a millimetre-scaled STL that any recipe can pose with
`import()`, exactly like every other reference. Drop the file in `refs/manual/` and uncomment the
worked example in `references.yaml`.

### What this found

The harness was not written to confirm that the catalogue was fine. Every one of these was
shipping, and three of them were labelled `confidence: exact`:

| Part | Defect |
| --- | --- |
| `gridfinity/base` | The profile sweep applied its offsets inward-and-downward, so the foot was **5.9mm undersized** (29.7mm at the bottom against a real 35.6mm) and the wrong shape throughout. It would rattle in any baseplate. |
| `gopro/*` | The pivot bolt hole ran through a solid block *above* the prongs instead of through the round leg ends. Two buckles could not interleave and bolt together **at all**. |
| `opengrid/*` | Invented geometry: a plain square hole with a made-up top rabbet, against a real cell that is a chamfered-square aperture with a recess at mid-thickness. Boards were also 1.6mm oversize, so they would not tile with real ones. Section IoU **0.23**. |
| `extrusion2020/tab` | Head sized to the channel's centre depth as if it were available at full width. **5.65mm thick into a 2.1mm channel** — 105mm³ of interference. |
| `extrusion2020/endcap` | The locating cross reached 8.5mm in from each face, driving **332mm³** straight through the rail's solid core. |
| `extrusion2020/clip` | Legs sized to the channel depth alone, leaving the barbs still inside the slot mouth with nothing to grip. Also disagreed with `tab` about which axis runs along the rail. |
| `opengrid/snap` | `attachable()` envelope disagreed with the geometry, so every anchor on the part was off. Now guarded generically by `tests/test_anchors.py`. |

## Licensing

This repository's own files are MIT. **Two parts are not**, and the catalogue says so per entry:

| Part | Licence | Why |
| --- | --- | --- |
| `opengrid/board`, `opengrid/snap` | **CC-BY-NC-SA 4.0** | They call into `vendor/QuackWorks`, which is CC-BY-NC-SA repo-wide. Rendering either part runs that code, so NonCommercial applies to that use and ShareAlike applies to adaptations. |
| everything else | MIT | — |

openGrid is designed by David D; the OpenSCAD implementation is by Andy (BlackjackDuck), the snap
by metasyntactic. Upstream separately licenses *generated tiles* CC-BY, so what you print is
unrestricted — the terms attach to running and adapting the script. There is no permissively
licensed openGrid source to use instead: the official
[openGrid-3D/openGrid-openSCAD](https://github.com/openGrid-3D/openGrid-openSCAD) repo carries no
licence and has no board geometry in it.

The MIT-licensed submodules — `gridfinity-rebuilt` (kennetek), `GoProScad` (ridercz), `BOSL2` —
impose nothing on callers, which is why wrapping them was uncomplicated.

Two upstreams are **measured against but never called and never vendored**, because including
them would relicense our parts: `NopSCADlib` (GPL-3.0), used as a model of real 20-series
extrusion for the fit checks. Its numbers — dimensions, which are facts — are recorded in
`lib/constants.scad`; none of its code is here.

`openscad-wasm` bundles OpenSCAD itself (GPL-2.0). It is used as an external tool the browser
fetches and runs, the same way the CLI shells out to the `openscad` binary — no OpenSCAD source
is copied into this repository.

## Repo layout

```
lib/             constants, slot/joint conventions, shared helpers
parts/           one .scad per part, grouped by system
assemblies/      example compositions of two or more parts
cli/             foundry.py — render/build/preview/goldens CLI
tools/           reference cache + the comparison engine behind `make verify`
references.yaml  what each part is checked against, and how
tests/           soundness, anchors, recorded dimensions, reference checks
web/             browser app (openscad-wasm)
vendor/          upstream implementations, as git submodules
refs/            reference cache — fetched, converted, rendered (gitignored)
```

## Sources

Called directly (submodules): [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) ·
[GoProScad](https://github.com/ridercz/GoProScad) ·
[QuackWorks](https://github.com/AndyLevesque/QuackWorks) ·
[BOSL2](https://github.com/BelfrySCAD/BOSL2)

Measured against, never vendored: [NopSCADlib](https://github.com/nophead/NopSCADlib)

Specifications: [gridfinity.xyz](https://gridfinity.xyz/specification/) ·
[opengrid.world](https://www.opengrid.world/guides/board/) ·
[Mechanism](https://getmechanism.com/pages/digital-files) (DeckMate — no dimensioned drawing published)
