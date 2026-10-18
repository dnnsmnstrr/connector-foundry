# Command line

Rendering parts from a terminal with `foundry`: installing it, rendering with your own parameters, and saving defaults. Back to the [README](../README.md).

`foundry` renders any part in the catalogue to an STL file. It compiles the same OpenSCAD sources the
app does, with a native OpenSCAD instead of the browser's, so it suits scripts and batch jobs: a
drawer's worth of Gridfinity bins in one loop, every part at your printer's tolerance, a part as a
step in a Makefile. For one part at a time, the [app](GETTING_STARTED.md) is quicker.

## Install

You need:

- **Python 3.10** or newer.
- **Git**, to clone the repository with its submodules: the upstream libraries the parts are built
  on (BOSL2, gridfinity-rebuilt-openscad and the rest) live in `vendor/` as git submodules.
- **An OpenSCAD development snapshot.** Every part renders with OpenSCAD's Manifold backend, which
  the stable release does not have. Download a snapshot for your system from
  [openscad.org](https://openscad.org/downloads.html#snapshots).

Then, on macOS or Linux:

```bash
git clone --recurse-submodules https://github.com/dnnsmnstrr/connector-foundry.git
cd connector-foundry
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/foundry list
```

On Windows, in PowerShell:

```powershell
git clone --recurse-submodules https://github.com/dnnsmnstrr/connector-foundry.git
cd connector-foundry
py -m venv .venv
.venv\Scripts\pip install -e .
.venv\Scripts\foundry list
```

Keep the `-e`: `foundry` reads the catalogue and the part sources from the checkout it was installed
from, so an editable install is what keeps it working (and up to date after a `git pull`). Activate
the environment (`source .venv/bin/activate`, or `.venv\Scripts\Activate.ps1` on Windows) to type
plain `foundry`, as the rest of this guide does. Cloned without `--recurse-submodules`? Run
`git submodule update --init --recursive`.

### Tell foundry where OpenSCAD is

`foundry` runs the command `openscad`. If the snapshot is not on your `PATH` under that name, point
`OPENSCAD_BIN` at it:

```bash
export OPENSCAD_BIN=/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD   # macOS: inside the app bundle
export OPENSCAD_BIN=~/Applications/OpenSCAD-x86_64.AppImage               # Linux: the AppImage
```

```powershell
$env:OPENSCAD_BIN = "C:\path\to\openscad.exe"   # Windows: where the snapshot installed it
```

Put the line in your shell's profile to keep it. If `foundry` cannot start OpenSCAD it says so —
`'openscad' not found. Install an OpenSCAD dev snapshot …` — and an `--backend` error from
OpenSCAD itself means it found the stable release instead of a snapshot.

## Find a part

```bash
foundry list
```

lists every part, grouped by system:

```text
Gridfinity
  gridfinity/base              [exact     ] MIT             Bin base
  gridfinity/bin               [exact     ] MIT             Bin
  gridfinity/baseplate         [exact     ] MIT             Baseplate
```

The first column is the part's id, which every other command takes; then how far to trust it
(`exact` or `parametric`, see [Getting started](GETTING_STARTED.md#print-your-first-part)), its licence
and its name. To see a part's parameters and their defaults:

```bash
foundry defaults show gridfinity/bin
```

```text
catalogue default: {'gx': 1, 'gy': 1, 'gz': 3, 'filled': False, 'divx': 1, 'divy': 1, 'scoop': True, 'tabs': True, 'lip': True, 'magnets': False, 'screws': False}
user override:     (none)
effective:         {'gx': 1, 'gy': 1, 'gz': 3, 'filled': False, 'divx': 1, 'divy': 1, 'scoop': True, 'tabs': True, 'lip': True, 'magnets': False, 'screws': False}
```

The names are the ones in the app's sidebar. A part's print note — which side goes on the bed, and
what each parameter is for — is in the [catalogue table](../README.md#catalogue).

## Render a part

```bash
foundry render gridfinity/base --gx 2 --gy 1 --magnets -o out/
```

writes `out/gridfinity_base.stl`: the part's id with `/` as `_`. Render variants of one part into
folders of their own, or the second overwrites the first.

| Option | Does |
| --- | --- |
| `-o`, `--out DIR` | where the STL goes (default `out/`, created if missing) |
| `--set NAME=VALUE` | sets any parameter; repeat it for more than one |
| `--gx N`, `--gy N` | shorthand for `--set gx=N`, `--set gy=N` (the Gridfinity parts) |
| `--magnets`, `--no-magnets`, `--screws`, `--no-screws` | shorthand for the Gridfinity hole options |
| `--no-user-config` | ignore your saved defaults and settings (below) for this render |

`--set` reads `true` and `false` as booleans, anything that parses as a number as a number, and the
rest as text. A few examples:

```bash
# A 2 x 3 bin, 6 units (42 mm) tall, with magnet holes
foundry render gridfinity/bin --gx 2 --gy 3 --set gz=6 --magnets -o out/bins/

# A 4 x 2 openGrid board in the thin "lite" variant
foundry render opengrid/board --set cells_x=4 --set cells_y=2 --set variant=lite -o out/

# A GoPro buckle that takes a square M5 nut
foundry render gopro/female --set nut_sides=4 --set nut_dia=11.5 -o out/
```

And because it is a command, a loop renders a set:

```bash
for w in 1 2 3; do
  foundry render gridfinity/bin --gx "$w" --gy 1 -o "out/bin-${w}x1/"
done
```

Mistakes stop before anything renders, and say what would work: a parameter the part does not have
(`'nope' is not a parameter of gf_base(). Accepts: gx, gy, magnets, …`), a value that is not one of
a parameter's options (`variant='lit' is not one of 'full', 'lite', 'heavy'`), or a number under a
part's minimum.

## Save your defaults

If you always want a parameter set one way — magnet holes in every Gridfinity base — save it once
instead of passing it every time. `foundry render` then applies it on its own:

```bash
foundry defaults set gridfinity/base --magnets              # from now on
foundry defaults set gridfinity/bin --set gz=6 --set lip=false
foundry defaults show gridfinity/base                       # catalogue default, yours, and the result
foundry defaults list                                       # every part you saved defaults for
foundry defaults clear gridfinity/base --param magnets      # forget one ...
foundry defaults clear gridfinity/base                      # ... or all of that part's
```

Settings work the same way for every part at once: the constants in `lib/constants.scad` that
depend on your printer rather than on a part.

```bash
foundry settings set --fit-clearance 0.25   # the gap where printed parts fit together (0.15 by default)
foundry settings set --circle-detail fine   # draft, normal or fine: how finely curves are faceted
foundry settings show
foundry settings clear
```

A render takes the catalogue's defaults, then your saved defaults and settings, then what you pass on
the command line, each overriding the one before. `--no-user-config` leaves out the middle layer, to
render a part exactly as the catalogue defines it.

They are saved as OpenSCAD Customizer files, one per part, under `~/.config/connector-foundry/`
(or `$XDG_CONFIG_HOME/connector-foundry/`), so a saved default also opens as a parameter set in the
OpenSCAD GUI. The web and desktop apps keep their own defaults; the two do not share them. [User
overrides](OVERRIDES.md) covers both.

## Render the whole catalogue

```bash
foundry build --all -o out/
```

renders every part at its catalogue defaults (your saved defaults are not applied), one STL per part,
one after another.

## Use OpenSCAD directly

Every part is a module in a file under `parts/`, so it can go into designs of your own. Library-style
includes in the vendored upstreams (`include <BOSL2/std.scad>`) need `vendor/` on OpenSCAD's library
path, as `foundry` arranges for its own renders:

```bash
OPENSCADPATH="$PWD/vendor" openscad assemblies/gridfinity-to-gopro.scad
```

A part's file only defines its module, so opening one shows nothing. A file of your own in the
repository's root that includes the part and calls it does:

```openscad
include <parts/gridfinity/base.scad>
gf_base(gx = 2, gy = 1, magnets = true);
```

A part's id is its file: `gridfinity/base` is `parts/gridfinity/base.scad`, and the module it
defines takes the parameters `foundry defaults show` lists. The [slot convention](../README.md#slot-convention) and [joints](JOINTS.md) explain how parts attach
to one another.

## For contributors

`foundry preview --all` renders the gallery images in `docs/img/`, `foundry goldens` prints (and with
`--update` records) every part's bounding box and volume for the tests, and `foundry readme`
regenerates the README's catalogue table. [AGENTS.md](../AGENTS.md) says which command proves which
kind of change.
