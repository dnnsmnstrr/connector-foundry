# User overrides

Saved defaults and global settings as a layer over the catalogue, in the CLI and the web app. Back to the [README](../README.md).

"Gridfinity should always have magnet holes on" is a preference, not a change to the repo. Saved
overrides are a layer on top of the catalogue defaults:

    catalogue default -> saved user override -> this render's value

```bash
foundry defaults set gridfinity/base --magnets   # always on, from now on
foundry defaults show gridfinity/base
foundry defaults clear gridfinity/base
foundry settings set --fit-clearance 0.25        # global: FIT_CLEARANCE
foundry settings set --circle-detail fine        # global: CIRCLE_DETAIL — rounder holes, slower
foundry settings set --set GRIDFINITY_PITCH=42.2 --set MODGRID_PITCH=8.1
foundry render gridfinity/base --no-user-config  # true catalogue defaults (what tests and CI use)
```

The web app's **Settings → System units** edits the same two pitches for its own saved settings.
Gridfinity accepts 36–48 mm per cell and MOD-GRID 6–12 mm between holes. These change repeating
XY spacing; feature sizes such as MOD-GRID's 5 mm square hole stay fixed.

Stored as OpenSCAD Customizer JSON under `~/.config/connector-foundry/`, so a saved file also
opens as a parameter set in the OpenSCAD GUI. The web app does the same resolution in
`localStorage`; a dot marks any field that differs from the catalogue default, and "Save as my
default" works per part. Drag the sidebar's edge to make it wider or narrower (double-click it to reset); the width is kept, and the same in every tab. The gear icon holds the global settings — including the part list itself:
untick a system or a single part there and it leaves the Library sidebar and both Bench pickers,
so the list shows only what you actually print. Hidden parts still work in any bench, link, or
config that uses them; "Show all" brings everything back.
