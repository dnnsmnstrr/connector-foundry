# Getting started

From opening the app to a part on your print bed: the three tabs, and how to save and share what you make. Back to the [README](../README.md).

Connector Foundry is a catalogue of printable mounting parts — Gridfinity bins and baseplates,
openGrid snaps, Skådis pegs, Honeycomb Storage Wall inserts, MOLLE panels, GoPro buckles, Arca
plates, tripod sockets, MagSafe mounts, 2020 extrusion fittings and more — written as parametric
OpenSCAD. Every part follows the same slot convention, so any of them can be attached to any other:
a GoPro buckle on a Gridfinity base, an openConnect head on a Honeycomb Storage Wall insert. You set
the sizes, check the part in 3D and download an STL for your slicer.

## Open the app

The web app runs at
[dnnsmnstrr.github.io/connector-foundry/app/](https://dnnsmnstrr.github.io/connector-foundry/app/) in
any current browser, on a computer, a tablet or a phone (Safari or iOS 15.4, Chrome 93, Firefox 114,
Samsung Internet 17, or newer). There is nothing to install and no account to make. Parts render on
your own device, with OpenSCAD compiled to WebAssembly, and nothing you make is uploaded anywhere.
The first render of a visit takes a few seconds longer while the engine loads; after that most parts
render in a second or two on a computer, a few seconds on a phone.

On a phone or tablet the 3D view comes first. The part list (and on the Bench and Holes tabs,
everything that is in the sidebar on a computer) is a drawer at the bottom of the screen: tap its
handle to open it, or drag the handle to pull it up or push it down (**Find a part** opens it at its
search). On a phone the part's settings are in the drawer too, on a **Parameters** tab beside the
**Parts** list; on a tablet they sit beside the view. Drag with one finger to turn the view, pinch to zoom, and tap a handle
to type a size. **Add to Home Screen** opens it like an app, and once it has rendered a part it opens
again without a connection.

Want it in a window of its own, or offline? The [desktop app](DESKTOP.md) is the same app for macOS
and Windows. To render parts from scripts, there is a [command line](CLI.md).

The app has three tabs, at the top of the window (or the keys `1`, `2` and `3`):

| Tab | For |
| --- | --- |
| **Library** | One part on its own: pick it, set its parameters, download it. |
| **Bench** | Several parts as one: attach parts to a base part's slots, with a joint each. |
| **Holes** | Screw holes, connector slots and cutouts in a part, in a model of your own, or in the bench. |

## Print your first part

1. **Pick a part.** The Library lists every part by system on the left; type in **Search parts…**
   to narrow it down. If you are not sure where to start, try **Gridfinity → Bin**. The part renders
   with its catalogue defaults, and the line under its name says how to print it: which side goes
   on the bed, and whether it needs supports.
2. **Set its size.** Change a parameter in the sidebar and the part renders again. A dot marks a
   value you changed, and the ↺ beside it puts that one back; **Reset all to catalogue** resets them
   all. Most parts can also be resized in the 3D view: drag one of the small square handles, as in
   TinkerCAD. An outline shows the new size before you let go, with a label such as
   "W 126 mm · gx 3", and the part renders once you do. Parts on a grid grow in the grid's own
   steps — a Gridfinity unit is 42 mm. To type an exact size instead, click a handle.
3. **Check the outside dimensions** under the part's name: width, height and depth in millimetres, as
   rendered.
4. **Download STL** (under the 3D view) and open the file in your slicer, or upload it to EasyPrint
   to print it from a phone (below). On a phone or tablet, **Print…** beside the part's name has
   the download. With
   [Layerling](https://layerling.com/), **Copy for Layerling** skips the file and pastes the part in
   directly.

Each part says how far to trust it. **exact** parts come from the standard's reference
implementation or its published specification, and are checked against someone else's model of the
same standard (see [Accuracy checks](ACCURACY.md)). **parametric** parts are a good starting point:
measure your hardware — the webbing on your bag, the slot in your rail — and print a test piece first.

## Print from a phone with EasyPrint

Prusa's [EasyPrint](https://www.printables.com/slice) slices a model in the cloud and sends it to a
printer on Prusa Connect, all from a phone's browser or the Prusa app. No website can hand it a model
directly (it has no way in for other sites), so getting a part there takes three steps.
**Print…** walks you through them: beside the title on a phone or tablet, in every tab. On a
computer it is **Print with EasyPrint…** on the Bench and Holes tabs, and in the Library
**Download STL** is the first step.

1. **Share STL…** (or **Download STL**) puts the file on the phone. On an iPhone or iPad, the share
   sheet's **Save to Files** keeps it where EasyPrint can find it; Chrome and Android save it to
   Downloads, since Chrome's share sheet refuses model files. **3MF** is the same part a fifth of the
   size, and on the Bench one 3MF holds every body.
2. **Open EasyPrint** and sign in with your Prusa Account.
3. In EasyPrint, **Models → Add… → Upload model**, pick the file, choose the printer and **Print**.

The part was set up on your computer and the printer is next to your phone? On the Bench, **Send this
bench to another device** (in the command palette) shares the bench's link, or copies it: open it on the
phone and print from there.

## Fit it to your printer

Two settings change every part, under **⚙ Settings** at the top right (or the `s` key):

- **Fit clearance** is the gap left where two printed parts slide or snap together, 0.15 mm by
  default. If snaps are too tight on your printer, raise it a little; if they rattle, lower it.
- **Circle detail** is how finely curves are faceted: **Draft** renders faster, **Fine** gives rounder
  holes.

To keep your own values for one part — "my Gridfinity bins always have magnet holes" — set them and
click **Save as my default**. [User overrides](OVERRIDES.md) has the details. Settings can hide the
systems you never print from the part lists, and **Export settings…** saves all of this to a file, to
move it to another browser or to the desktop app.

## Combine parts on the Bench

The Bench builds one part out of several:

1. **Choose a base part** (or **Open in Bench** from the Library, which brings its parameters along).
2. **Click a green slot marker** on it. A picker opens over the scene: pick the part to attach, and the
   joint beside the search — **fused** into one body, **bolted** with heat-set inserts, **snap**,
   **pin** or **screwed**. [Joints](JOINTS.md) explains each one.
3. **Adjust the attached part** in the sidebar: its own parameters, an offset, a shift across the slot,
   a rotation. Click it in the scene to turn it in 90° steps, move it to another slot (`M`), or delete
   it.
4. **Export.** Every printable body of the bench gets its own **STL** button: a fused bench is one
   body, a bolted one is two halves you print separately and bolt together.

A bench can start from a model of your own, too: **Import STL / STEP / 3MF…**, or drop the file on
the empty Bench. The [Bench guide](BENCH.md) covers resizing the base part, cropping, presets and
importing.

## Drill holes into anything

The Holes tab takes a part from the catalogue, a model of your own or the bench as it stands, and
cuts into it. Click a face and a hole snaps to the useful places on it: the middle, the middle of
each quarter, a point set in from each corner, the middle of a hole already there, and the guide
lines between them. Pick what to cut from the presets: socket cap screws from M2 to M6, countersunk and
button heads, heat-set insert bores, nut traps, wood screws, magnet and bearing pockets, and the
slots that take openConnect, MultiConnect, Skådis and MOLLE hardware. Select a hole to move it, or
drag a cutout's handles to resize it. The [Holes guide](HOLES.md) lists every preset.

For custom Gridfinity storage, start Holes from **Gridfinity → Bin** with `filled` on: a bin that is
solid up to its stacking lip, ready for pockets shaped like your tools.

## Find anything with Cmd/Ctrl+K

**Cmd+K** on a Mac, **Ctrl+K** elsewhere, or the magnifier (Search) button at the top right on a
phone or tablet, opens the command palette: type a few letters to switch
tabs, find a part, pick a hole type, attach, export, undo, change a setting or open a guide like
this one (`holes guide`). The first letters of words work too — `oib` is **Open in Bench**. Press
`?` for every keyboard shortcut and the mouse and trackpad controls; **Cmd/Ctrl+Z** undoes in every
tab.

## Let an AI agent use it

In a browser with [WebMCP](https://developer.chrome.com/docs/ai/webmcp), the app tells the browser's
AI agent what it can do: the command palette's commands, the parts catalogue with each part's
parameters, opening a part in any tab, attaching parts on the Bench, what each tab shows, and
loading a whole bench. Ask the agent for "a 3 by 2 Gridfinity bin with magnets" or "attach a flat
plate to this board's corner slot" and it works the app as you would. Opening a part over your bench
or holes asks you first, and anything the agent does to a bench can be undone with **Cmd/Ctrl+Z**.
As of October 2026 that is Chrome with `chrome://flags/#enable-webmcp-testing` turned on; elsewhere
nothing changes. The [desktop app](DESKTOP.md#let-coding-agents-use-it) offers the same to coding
agents like Claude Code.

## Save and share

- **The address bar is a link to your bench.** The app keeps the bench in the URL as you work, so a
  reload comes back to it and the link opens the same bench for someone else. Imported meshes are too
  big for a link: they stay with this browser tab only. **Send this bench to another device** (in
  Cmd/Ctrl+K) shares the link through your device's share sheet, or copies it; from the desktop
  app, the link opens the bench in the web app.
- **Download config** (on the Bench) saves the whole bench to a `.bench.json` file, imported meshes
  included, to open again later from **Import config…**.
- **Presets** keep benches you reuse in this browser.

## Next steps

- [Desktop app](DESKTOP.md): install it on macOS or Windows.
- [Command line](CLI.md): render parts without a browser, with your saved defaults.
- [Bench](BENCH.md), [Holes](HOLES.md) and [Joints](JOINTS.md): everything each tab can do.
- Found a problem, or a part that does not fit?
  [Open an issue](https://github.com/dnnsmnstrr/connector-foundry/issues/new) — measurements of the
  real thing help most.
