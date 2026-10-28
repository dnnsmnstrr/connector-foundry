# Future improvements

## Complete OpenSCAD assembly exports

The Bench's `.scad` download references imported meshes as `imports/<id>.stl`
but does not download those files. It also relies on the repository's relative
SCAD includes and does not capture the active printer overrides.

The existing `.bench.json` config export already embeds imported meshes and can
restore the project in the browser. Keep that flow; a future OpenSCAD export
should package the generated source, imported meshes, printer overrides, and
required dependency versions/instructions so the same assembly can be rendered
locally. Check that its dimensions match the browser export with non-default
printer settings and an imported part.

Deferred deliberately; no change to `.scad` export behavior in this review.

## Attached Bench parts: picking, a tighter outline, a fixed far edge

Attached parts have resize handles on their exact frames (`benchOrientation.js`'s
`nodeWorldMount()`, `benchResize.js`'s `attachedFrame()`), but two older consumers still use
`benchPick.js`'s padded axis-aligned boxes: click-picking in the scene, so a side-mounted part
can only be selected from the sidebar, and the boxes overlap more than they need to. The frames
could replace them (a ray against oriented boxes). The selection outline is the world box around
the frame box, since `StlViewer`'s `highlightBox` is axis-aligned; at a spin that isn't a quarter
turn it is larger than the part, and an oriented outline (the ghost's segments, say) would match
the handles.

An attached part grows about its centre, as the root does. TinkerCAD's default keeps the far
edge still; for an attached part that would mean shifting it by half the change along the
dragged axis in the same undo step (`updateChildShift()`, the shift being in the slot's frame,
turned with the spin), and the ghost and the guard would have to follow. Left out because a part
centred on its slot is usually what is wanted, and it would differ from the root, which has no
shift to move.

## Attached parts when the root shrinks through the sidebar

A root resized with its handles never takes a slot from an attached part: `benchResize.js`'s
guard steps past such a size (2 → 4 cells on an openGrid board with a part on it). A size typed
into the root's parameter fields is not guarded: if it drops or renumbers an occupied slot, the
next render fails with BOSL2's "Unknown anchor", and Undo is the way back. Reconciling was left
for a change of its own: whether to move an attached part to the slot nearest its old place or
to refuse the value with the guard's explanation is a design question, and a field reports every
keystroke — typing "12" passes through "1" — so either would have to act when the edit is
finished, not on each keystroke as the field does now.

## Phones and tablets: what is left

The app works on a phone (web/README.md, "Phones, tablets and offline"); these were measured or
found on the way and left for later:

- **Help text on touch.** About fifty field explanations exist only as `title=` tooltips, which a
  touch screen never shows: the Holes spec fields (`HoleSpecFields.jsx`, 23; `RepeatFields.jsx`, 6),
  the Bench's node tree (7), the Holes and Bench sidebars (11 and 9). `InfoTip` now opens on a tap;
  a small `FieldLabel({ children, hint })` that renders the label with an `InfoTip` would route them
  all through it.
- **The first tap in Holes is blind.** A finger never hovers, so the face's snap points and guides
  only show after the first hole is drilled. A first tap that only picks the face (snap points
  appear, "Tap again to drill") would change the drill gesture on touch and wants its own decision.
- **The Library's part in the address bar.** A bench travels by link (**Send this bench to another
  device**); a Library part and its parameters do not, so sending one to a phone goes through Open
  in Bench. A `part=` / `params=` pair in the hash, checked like a user command's `open-part`,
  would let the Library share its link too.
- **Imported STL assets mounted only where needed.** The bundle carries seven STL meshes (367 KB
  gzipped) that only the DeckMate and KLIPPT parts, and the Holes tab's sockets cut from them,
  import: shipped as files of their own and mounted per render, a phone loading any other part
  would skip them.
- **A share target.** Installed on Android, the app could register as a Web Share Target for STL
  and 3MF files, so a model shared from another app opens on the Bench or in Holes.
- **Landing page leftovers** at phone widths: `.text-link` and `.download-more a` (26 px tall),
  `.hero-release` (35 px), the palette demo's field (27 px), the feature tabs' `1`/`2`/`3` key caps.
- **Not verified on a real device:** downloads from an iOS home-screen app (one 2019 WebKit report
  says they open a preview page), the Prusa app's file picker taking a shared 3MF, Apple Pencil
  hover over the viewer, GPU frame times on an older iPad.

## Code-splitting the Holes tab and the import flow

Lazy-loading the Holes mode and `ImportFlow` would take roughly 35 KB gzip off the main chunk.
Cut, for now: the first preview on the web already waits for the OpenSCAD engine (a 10.3 MB
`.wasm`, 3.2 MB gzipped), the
desktop app loads from disk and gains nothing, and the risks are real — a lazy chunk that fails
to load (an old tab after a Pages deploy; chunk names are content-hashed, and the service worker
keeps only chunks a visitor has already fetched, so a lazy chunk an old tab never loaded is still
gone after a deploy) can blank the app or
leave an error boundary whose "Try again" cannot recover, since `React.lazy` caches the rejected
import, and a Suspense boundary in the wrong place hides a live viewer. If it is done: only those
two, each in its own `<Suspense fallback={null}>` at its use site (never around a viewer), with a
lazy wrapper that offers a reload instead of caching the failure.

## A TinkerCAD mouse mapping

TinkerCAD orbits with the right button and pans with the middle one or Shift+right; this app
keeps OrbitControls' defaults (left-drag orbits, right-drag pans), which are also what a one-button
trackpad needs. A setting that only remapped the right and middle buttons would still not match
TinkerCAD's left-drag (which selects there), and would sit in Settings where the people who want
it won't look, so the `?` sheet documents the mouse map instead.

## Undo on non-Latin keyboard layouts

`undoShortcut()` matches `e.key`, so the key labelled Z is undo on a QWERTZ keyboard. On a
Cyrillic or Greek layout `e.key` is that layout's letter, and Cmd/Ctrl+Z does nothing in the app
(the buttons still work). A fallback to `e.code` only when `e.key` is not a Latin letter would
cover it without breaking QWERTZ.

## Handle bounds that depend on other parameters

A handle's bounds come from the catalogue and its `resize` entry, so they cannot follow another
parameter. Sizes that fail only with some options are left to a render error and Undo: an HSW
wall with `flat_edges` at one row, a Basics plate whose corner radius is over half a side (the
handles stop at 8 mm, twice the default radius), a post whose bore is not narrower than it.
Relatedly, a gesture's bounds widen to take in its start value, so an HSW wall set to one column
in the sidebar can be dragged to two — and that one ghost is 11.8 mm short in Y, since a second
column hangs half a cell lower. And one cap per axis can't depend on the variant: an openGrid
"heavy" board at the 6 × 6 cap takes about 12 s in the browser, against about 4 s for the
others.

## An exact box for the Basics post

The post's cylinder is a polygon whose side count changes with its diameter, so its box stops
short of the circle on an axis with no vertex (0.08 mm a side at Ø11), and `tests/test_resize.py`
gives `xy` entries a faceting allowance for it; at the `draft` detail the ghost can be about
0.33 mm off a side for one render. A `$fn` rounded up to a multiple of four, as
`parts/basics/plate.scad` does, would make the box exact at every detail; it changes the post's
recorded volume, so it needs `make goldens`.

## Smaller viewer follow-ups

- The screen-space fallback for a drag that goes edge-on sums two independent axis readings for
  a plane constraint (a corner, a Holes handle), which near edge-on at an oblique angle reads up
  to about 1.4× too far. A 2 × 2 solve with floored singular values would be exact; it only ever
  runs inside the 15° cone.
- The camera backs out to keep handles in reach only when they grow. A viewer made smaller (the
  window, the sidebar) or zoomed far in can leave a handle under the toolbar until the next
  resize that grows.
- The Holes pill's anchor below a hole is a world-space estimate; seen steeply from above or from
  behind the face, it can come close to a handle. Pinning the overlay below the lowest projection
  of several points would need a viewer change.
- The guides effect rebuilds its line materials when the Option-held measurements change; the
  one-frame-late dispose the markers now use would save it relinking their shader programs.

## Smaller Bench and Holes follow-ups

- The root's measured box is checked against its parameters only, not the printer settings: a
  Settings tolerance change can leave the handles a fraction of a millimetre off until the root
  is measured again (the slot markers behave the same way).
- `nodeActions` and the click handlers are rebuilt on every Bench render; cheap now, but it
  would matter if `NodeTree` were memoised. In Holes, `HoleSpecFields`, `ParamsEditor` and the
  Grid field still re-render on every hover commit (all of React together took about 0.15 s of a
  profiled hover sweep, once the shader relinks were gone).
- `resize.js`'s `formatMm()` repeats `outsideDimensions.js`'s private three-decimal rule; it can
  reuse that once someone is in both files.

## The stateless MCP revision for the desktop server

`web/desktop/mcp-server.cjs` speaks MCP's initialize-based revisions (2025-03-26 to 2025-11-25),
which the reference SDK (1.32) and the clients of October 2026 use; a client of the stateless
2026-07-28 revision gets the 400 that sends a dual-era client back to `initialize`. Serving that
revision too means `server/discover`, the per-request `_meta` version and capabilities, the
`Mcp-Method` / `Mcp-Name` headers checked against the body (`HeaderMismatch`, -32020) and
`UnsupportedProtocolVersionError` (-32022) — worth doing once a modern-only client turns up, and
testing against the SDK release that implements it rather than by hand.

## The command palette's user commands: an editor

`web/src/lib/userCommands.js` is the architecture for the user's own commands — a validated
store of action kinds (a part with parameters in a tab, a bench preset, a hole type, a link, a
tab, a built-in command), aliases and Mod+Shift / Mod+Alt hotkeys, with aliases and hotkeys for
built-in commands too — but the only way to make one today is a hand-edited settings backup
(the README's "The command palette" shows the format). Still to do:

- **"Save as command…"** in the palette for what is on screen: the Library's part with its
  parameters, a hole spec of one's own (which needs a `normalizeSpec()`-backed check before a
  `hole-spec` kind can take arbitrary specs; `hole-preset` only names built-in presets today),
  the bench as a preset.
- **A Commands section in Settings**: rename, alias, delete, and a hotkey recorder that shows
  `hotkeys.js`'s `hotkeyProblem()` as you press a chord.
- **Frecency** rather than plain recency for the empty-query list, if the recent list turns out
  to churn.
- Sequences (one command running several) were left out on purpose: the `command` kind can't
  name another user command, so no two can run each other forever; a sequence kind needs the
  same guarantee.
