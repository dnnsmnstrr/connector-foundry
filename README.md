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

OpenSCAD with the Manifold backend, [BOSL2](https://github.com/BelfrySCAD/BOSL2) (vendored as
a git submodule) for its attachment system, a Python CLI, and a small React + `openscad-wasm`
web app that compiles the same `.scad` sources in-browser.

## Quick start

```bash
git clone --recurse-submodules <repo-url>
cd connector-foundry
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python cli/foundry.py list
.venv/bin/python cli/foundry.py render gridfinity/base --gx 2 --magnets -o out/
.venv/bin/python -m pytest tests/
```

For the web app, see `web/README.md`.

## Slot convention

- The functional face of every part is its **BOTTOM** — also its print orientation.
- The default mount point is a named anchor `"mount"` on **TOP**.
- Parts with more faces (plate, post) declare extra named anchors on their other faces.
- Attaching through a slot consumes it: a part attached via `"mount"` no longer offers that
  anchor to further composition.

Physical constants live only in `lib/constants.scad`, each with a source comment and a
checked-on date. Printer fit tolerance goes through one global, `FIT_CLEARANCE` in that same
file.

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
| Part | System | Confidence | Print note |
| --- | --- | --- | --- |
| ![Bin base](docs/img/gridfinity_base.png)<br>Bin base | Gridfinity | exact | Print as-is, functional face (feet) down. No supports needed. |
<!-- CATALOGUE:END -->

## Licensing

This repository is MIT licensed. Two systems are adapted from other sources:

- **Gridfinity** geometry is adapted from
  [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad)
  (kennetek), MIT licensed — attribution kept in `parts/gridfinity/*.scad` and
  `lib/constants.scad`.
- **openGrid** dimensions are read from
  [AndyLevesque/QuackWorks `openGrid.scad`](https://github.com/AndyLevesque/QuackWorks/blob/main/openGrid/openGrid.scad),
  which is CC-BY-NC-SA 4.0. That file is read for its published numbers only — no CC-BY-NC-SA
  source is vendored or copied here. The openGrid modules in this repo (`parts/opengrid/`) are
  original implementations against those numbers, so the whole tree stays MIT-compatible.

[BOSL2](https://github.com/BelfrySCAD/BOSL2) is vendored under `vendor/BOSL2` as a git
submodule, BSD 2-Clause licensed.

## Repo layout

```
lib/          constants, slot/joint conventions, shared helpers
parts/        one .scad per part, grouped by system
assemblies/   example compositions of two or more parts
cli/          foundry.py — the render/build/preview CLI
tests/        manifold + golden-dimension checks (pytest + trimesh)
web/          browser app (openscad-wasm)
vendor/       BOSL2 (git submodule)
```

## Sources

[gridfinity.xyz](https://gridfinity.xyz/specification/) ·
[gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) ·
[opengrid.world](https://www.opengrid.world/guides/board/) ·
[QuackWorks](https://github.com/AndyLevesque/QuackWorks/blob/main/openGrid/openGrid.scad) ·
[Modular Mounting System](https://www.thingiverse.com/thing:2194278) ·
[Mechanism](https://getmechanism.com/pages/digital-files) ·
[BOSL2](https://github.com/BelfrySCAD/BOSL2)
