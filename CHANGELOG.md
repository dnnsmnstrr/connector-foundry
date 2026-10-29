# Changelog

What changed in each release of Connector Foundry: the web app, the desktop apps, the CLI and the
parts themselves. The desktop downloads are on the
[releases page](https://github.com/dnnsmnstrr/connector-foundry/releases); the web version always
runs the latest `main` at https://dnnsmnstrr.github.io/connector-foundry/app/.

## Unreleased

### Parts

- **Folded openConnect snaps and screws.** The openConnect snap has a new `layout`: `folded` lays
  it out to print on its side, the head's half on its cut face and the rest of the snap (or the
  screw's thread) beside it on a one-layer hinge, to fold up after printing — stronger at the
  neck, where a standing print splits along its layers. `split` prints the two halves apart, to
  glue. Both match openGrid-projects' own "openConnect (Folded)" snap and screw, checked against
  them like the upright versions.

### Bench

- **Fold for printing.** A part with an openConnect head — a head fused onto a hook, a plate, a
  GoPro mount — can export its whole body folded the same way: cut just in front of the head,
  both halves on their cut faces, joined by a hinge or split in two. Choose it under the part's
  Crop box or from the command palette. The scene keeps showing the bench as it goes together;
  **Folded** (or **Split**) in the viewer's toolbar shows the body as it will export. The export says
  when a part can't fold (Split still can).
  
### Library

- **No Render button.** The preview already renders on its own whenever the part, its parameters
  or the printer settings change, so the header's **Render** button only ran the same render
  again. It is gone; after a failed or cancelled render, **Retry preview** sits by the error
  (and the command palette's **Render again** runs it any time).
- **No Print… in the Library on a computer.** EasyPrint can't be sent a model from another site,
  so there the Library's print sheet could only hand over the file **Download STL** already saves.
  The button and its palette command are gone from the Library on a computer (a phone or tablet
  has it, below); the Bench and Holes keep **Print with EasyPrint…**, which there gathers the
  bench's bodies or renders the holed part.

### Phones and tablets

- **The sidebar is a drawer.** On a phone (and in any browser window under 900 px wide) the part
  list, the Bench's parts and the Holes list are a sheet over the foot of the 3D view instead of a
  section at the bottom of the page behind a "Hide sidebar" button. Drag its handle up to half the
  screen or nearly all of it, push it back down, or tap the handle to open and close it; the list
  in it scrolls on its own, and the view keeps its one-finger orbit. The Bench and Holes views now
  run to the bottom of the screen, under their header, and the selected part's controls move up
  to stay clear of the sheet. It starts closed on a first visit and then
  remembers whether you left it open, as the sidebar does on a computer; `[` and the command
  palette's **Open the drawer** work too.
- **The Library's form is in the drawer on a phone.** Under 600 px wide the drawer has two tabs,
  **Parameters** and **Parts**, and the 3D view runs from the part's header to the bottom of the
  screen. A part picked from the list turns to its parameters; **Find a part** and `/` turn to the
  list. A render error shows under the header, where it stays in sight. Tablets keep the form
  beside the view.
- **The Holes drawer has tabs.** On a phone, as in the Library, the drawer has two tabs: **Holes**
  for the hole being edited, the list and the export, and **Hole types** for the picker. A type
  picked there turns back to its fields. The snapping bar is a tab on the drawer's top edge that
  rides up and down with it, a divider between the two, on one row with compact − and + steppers in its Inset and Radius
  fields, which now have the app's field style everywhere.
- **Print… is in the header.** On a phone or tablet the Bench's and the Holes tab's **Print…** sit
  to the right of the title instead of over the foot of the 3D view. The Library has one there too,
  in **Download STL**'s place: it opens the print sheet, whose **Share STL…** gets the file to
  EasyPrint (and whose **Download STL** saves it). On a computer the Library keeps **Download STL**
  and has no print sheet.
- **Number fields for a finger.** On a touch screen a number field's arrows are a − and a +
  beside it, each as tall as the field, instead of two half-height arrows stacked in its edge. A
  tap steps the value without focusing the field, so the keyboard stays down; holding still
  repeats, and a finger that starts scrolling the list over them changes nothing. Every field is
  at least 16 px, so iOS no longer zooms the page in when one is focused (the Holes snapping
  bar's Inset and Radius did).
- **An even viewer toolbar.** Under 900 px wide the Helpers toggle lost its label and shrank to
  half the height of Undo, Redo, Fit and View beside it; it is now as tall as they are.

### Install it like an app

- **Install the app.** Settings (while it can be installed) and the command palette have
  **Install the app**. On Android, Chrome, Edge and other Chromium browsers show their own install
  dialog; on an iPhone or iPad, and in Android browsers without one, a sheet shows the steps (Share,
  **Add to Home Screen**). Installed, it opens from its own icon, full screen.
- **A launch screen on iPhone and iPad.** The installed app starts on its icon on the app's dark
  background, at the same place the loading screen then shows it, instead of a blank white screen.
- **Updates reach an app left open.** A phone keeps an installed app suspended for days, and it
  used to show the version it was opened with until it was closed for good. It now checks for a
  new version when it comes back to the front (at most every ten minutes) and every hour it stays
  open; when one is out, the nav shows **Reload to update** (**Update** on a phone), and after the
  reload it says it updated. It asks first if the reload would lose the Holes tab's model. The
  palette's **Check for updates** asks the server there and then. A fresh start always opens the
  newest version, as before.
- **Feels like an app.** Swiping past the end of a list no longer bounces the whole page on iOS or
  pulls Android's refresh over it; text doesn't grow when an iPhone turns sideways; a tapped control
  dims while held instead of flashing grey; holding a finger on a button or a part's picture no
  longer selects its text or offers to save the image; and the installed app no longer zooms when
  a pinch misses the 3D view. Every dialog has a × at the top on a touch screen, and Android's back
  gesture puts the drawer away instead of leaving the app.

## 0.5.0 — 2026-10-28

### Parts

- **SOLDR module base.** A new part, `soldr/base`: the bottom of a module for the SOLDR
  soldering station, any number of units each way (30.5 mm apart), with the designer's tapered
  feet and two 6 mm magnet holes per unit, or one in the middle, or four on a regular grid. Fuse
  it under a part and the part stands on a SOLDR frame. On the Bench, every unit has a slot, and
  from 2 × 2 up so does the base's middle. Rebuilt from the designer's module files
  and checked against them; CC BY-NC-SA 4.0, like SOLDR's own files.

### Bench

- **Resize handles on attached parts.** Select a part attached to the base (or to another
  attached part) and it gets the same handles as the base: drag, step with the arrow keys, or
  click one to type a size, and it renders once. The handles stand on the part's own faces
  however it sits — on a side face, turned to any angle, shifted, on a joint — and the face it is
  attached by stays on its slot, so height grows outward and width and depth about its centre.
  Parts attached to it keep their slots, as with the base, and its controls move to the foot of
  the viewer, out of the handles' way. Imported models still have none.
- **Alt-drag to turn.** Hold Alt (Option on a Mac) and drag an attached part's handle to turn it
  on its slot. A dial shows the angle: on the dial it snaps to 15° steps (the long ticks are the
  quarter turns), past it to whole degrees, and the part renders once when you let go. `Esc`
  cancels, and Undo turns it back.

### Phones and tablets

- **Safari renders what the Bench and the Holes tab make.** In Safari (iPhone, iPad and Mac),
  combining parts on the Bench or adding a hole failed with "Maximum call stack size exceeded",
  and a part could fail the first time it rendered: Safari gives the render worker a twelfth of
  the stack Chrome does. A render that runs out of it is now redone on the page's own thread,
  which has room for as much as Chrome manages. The page pauses while that runs.
- **The web app works on a phone or a tablet.** The 3D view now comes first, with the part's
  settings under it and the part list last (**Find a part** goes there); before, the part list
  pushed the view below the fold on every phone. A tablet in portrait shows the settings beside
  the view instead of a 290 px sliver of it. Every button, field and checkbox a finger uses is at
  least 44 px, the header and the 3D view's toolbar fit one row, nothing sits under a notch or the
  home indicator, and the nav keeps the Settings gear on screen while a part renders.
- **Touch where a mouse used to be needed.** A tap near a slot marker or a Holes snap point takes
  it (a fingertip's reach, not the dot's few pixels); the "?" beside a setting opens on a tap; the
  Holes tab has a **Measure** toggle for what holding Option shows, and a long press on a hole in
  the list adds it to the selection. A new part is framed to fit a narrow view, so its handles are
  on screen. In the Holes tab the first tap on a face shows its guide lines and snap points and the
  second drills; they stay up after the hole renders (the re-render used to take them away), and
  tapping or dragging a hole shows its face's, to aim it by.
- **Add to Home Screen** opens the app like an app, and once it has rendered a part it opens again
  without a connection.

### Printing

- **Print with EasyPrint…** on the Library, the Bench and the Holes tab (and in Cmd/Ctrl+K): the
  file goes to your device — through the share sheet on an iPhone, iPad or Mac (**Save to Files**),
  as a download in Chrome, whose share sheet refuses model files — then **Open EasyPrint**, sign in,
  and upload it there to slice and print on a Prusa Connect printer. EasyPrint has no way for a
  website to send it a model, so this is as direct as it gets. Each file also comes as a 3MF, a
  fifth of the size, and on the Bench every body in one 3MF.
- **Send this bench to another device** (Cmd/Ctrl+K) shares the bench's link, or copies it: set it
  up on the computer, print it from the phone. From the desktop app the link opens the bench in the
  web app.

### Faster

- **A third less to download, and once.** The OpenSCAD engine is downloaded as WebAssembly instead
  of a 13.8 MB script and compiles while it downloads (3.2 MB instead of 4.5 on the wire), and the
  part sources come without their comments (0.7 MB instead of 1.2): about 6 s sooner to a first
  part on a slow phone connection. A returning visit loads what it has already seen from the
  browser's cache, also after an update to the site.
- **Edits on the Bench show sooner.** The preview renders before the edited part's own measuring
  render, rather than after it, and parts rendered earlier are no longer rendered again after five
  minutes.
- On touch screens the 3D view draws at most 2.2 million pixels a frame, so turning a part on a
  large tablet stays smooth; hovering is cheaper on big imported meshes.

### Browsers

- **iOS and Safari 15.4 to 16.3 no longer show a blank page.** A pattern in the app's code needed
  Safari 16.4. Browsers older than Safari 15.4, Chrome 93, Firefox 114 or Samsung Internet 17 now
  say what to update instead of showing nothing, and a page whose code failed to download says to
  reload. Every build now checks its own output against that floor.
- A render that runs out of memory (a big bench on a phone) says so, a download on an iPhone no
  longer fails when its confirmation takes more than a second, and the 3D view redraws when a
  phone gives its graphics back after the tab was in the background.

### Website

- On phones and tablets the landing page's buttons, chips, handles and footer links are
  finger-sized, keyboard-only hints (⌘ K, esc, ↑ ↓ ↵) give way to touch wording, the 3D hero draws
  fewer pixels and 30 frames a second while idle, and with Data Saver or a 2G connection it stays on
  the pictures; the page keeps clear of a notch in landscape, and older browsers no longer scroll
  it sideways.

### Desktop

- **The desktop app updates itself.** It checks GitHub for a new release shortly after it starts
  and twice a day, downloads it in the background, checks it against the release's checksums and
  shows **Restart to update** in the header; the restart installs it and reopens the app on the tab
  and bench you had, and otherwise it installs when you quit. **Settings → Updates** shows the
  version, checks by hand and turns the automatic checks off; on a Mac it is also **Check for
  Updates…** in the app menu, and the command palette has all three. Releases now include the
  macOS ZIPs and a `latest.json` for the updater. Updating from 0.4.0 still takes a download by
  hand, since 0.4.0 has no updater.
- **Interface updates without reinstalling.** When a release leaves the app itself as it was and
  only changes its interface, the app downloads just that, about 8 MB instead of about 120, and
  **Reload to update** loads it in a moment, without a restart. An interface update that doesn't
  start is dropped for the app's own. **Update the interface without reinstalling** in **Settings →
  Updates** turns it off. A release that does change the app comes as the full update; where the
  app can't install that itself, the header's **Update the app** links the release page, since its
  interface stops updating until then. Settings shows the interface's version when it differs from
  the app's. Releases now include `Connector-Foundry-web.zip` for this.

### Holes tab

- **MagSafe pockets.** A new MagSafe preset group: a pocket Apple's MagSafe charger sits in flush,
  with a channel for its cable that turns to run out to whichever edge you point it at, and grooves
  for the 56 × 46 mm and 55 × 45 mm metal rings that make a case MagSafe-compatible, the middle left
  standing. The sidebar's **Insert** menu switches a pocket between puck and ring; sizes, depth and
  the cable channel's width and length are all editable.
- **Export, reordered.** In the Holes tab and on the Bench, the downloads come first (Download STL;
  the Bench's STL per body and its config), Copy for Layerling and Print with EasyPrint follow as
  outlined buttons, and Download .scad is a link under them.
- **Snapping moved to the viewer.** A bar in its bottom right corner has the Snap toggle, the
  corner inset and the center circle's radius; the sidebar's Snapping section is gone, so the hole
  list starts higher. The Grid is in the viewer's toolbar, as before, and in Settings.
- **`M` turns Measure on and off** in the Holes tab, as the toolbar's Measure button does.
- **System spacings in Measure.** While measuring, the selected hole can show a system's next
  holes as snap points with their distances, so a click drills the next one on pitch and the points
  move on with it: Gridfinity's magnet and screw holes (26 mm), openGrid (28 mm), Skådis
  (40 × 20 mm, staggered), MOD-GRID (8 mm), BitBeam (8 mm) or MOLLE. A **Spacing** menu beside
  Measure picks one, and a hole from a system's preset (a MOD-GRID hole, a Skådis slot, a BitBeam
  pin hole, an openGrid connector, a 6 × 2 mm Gridfinity magnet, MOLLE) picks its own. Repeat's
  standard spacings are the same list, so Gridfinity, openGrid and BitBeam are there too.
- **MOD-GRID holes.** A **MOD-GRID hole** preset (the grid's 5 × 5 mm square, through) and a
  **MOD-GRID** standard spacing in Repeat's grid (8 mm both ways) turn any face 3 mm thick into a
  MOD-GRID grid that MOD-GRID accessories and the `modgrid/connector` pin snap into. A part cut
  this way carries MOD-GRID's CC BY-NC-SA 4.0 terms, as the MOD-GRID parts do.

### Parts

- **MagSafe mount.** A new part: a round plate (60mm by default) with an optional pocket on its
  bottom for an aftermarket MagSafe magnet ring (recess **ring**, which leaves the middle standing)
  or steel disk (recess **disk**), so a phone snaps onto whatever the plate is fused to. Set the
  insert's outside and inside diameter and its thickness (the pocket depth) to the ring you bought;
  those come at 54 x 46, 55 x 45 and 56 x 46mm. The plate's thickness is adjustable, and **hole**
  opens the middle right through, for a donut.
- **MOD-GRID pin, reshaped so it bends instead of breaking.** The designer's pin has barbs 6.9mm
  across for a 5mm hole, so each leg had to bend almost a millimetre on a leg 3mm long: printed in
  PLA, the legs snapped off rather than going in. The pegs keep the designer's layout but now have
  thinner, longer legs, barbs 0.3mm proud of the hole, a gentle 30° lead-in and a 45° latch that
  stays pressed on the hole's back edge, so the part pulls flush onto the grid and doesn't rattle.
  Going in takes about a sixth of the force, and the strain in the legs is about a quarter of what
  it was. Pegs are 4.8mm deep now (5 before), with room in the hole. The pin part, and the bit
  holders that use it, still fit grids printed from the designer's file; the grid is unchanged, so
  accessories printed from the designer's files still fit it too.

## 0.4.0 — 2026-10-18

### Website

- **A landing page** at https://dnnsmnstrr.github.io/connector-foundry/ that shows what Connector
  Foundry does: real catalogue parts from Gridfinity, openGrid, the Honeycomb Storage Wall,
  DeckMate, KLIPPT and GoPro joining in 3D (drag to turn them), the Library's resize handles, the
  Bench's five joints and the Holes tab's snapping to try out on the page — the resize and
  command palette demos run the app's own code, and Cmd/Ctrl+K opens that palette anywhere on
  the page — the whole parts gallery with a filter by system, and the downloads for your
  computer.
- **The web app moved to `/app/`**: https://dnnsmnstrr.github.io/connector-foundry/app/. Links
  from before — a shared bench, a bookmark of a tab — are forwarded there, bench and all. The
  desktop app is unchanged.
- **Guides**, on the website and in `docs/`:
  [getting started](https://dnnsmnstrr.github.io/connector-foundry/docs/getting-started/),
  [installing the desktop app](https://dnnsmnstrr.github.io/connector-foundry/docs/desktop/) and
  [the command line](https://dnnsmnstrr.github.io/connector-foundry/docs/cli/) are new; the Bench,
  Holes, Joints, user overrides and accuracy pages are on the website too. They are the Markdown
  files in `docs/`, so GitHub shows the same text.
- **The guides and the website from the app**: **Open the guides** in the command palette (type
  `docs`) and the **Guides** link at the top of Settings open them in a new tab — from the desktop
  app, in your browser. Each guide is in the palette too, by its name (type `holes guide`), and
  **Open the website** goes to the landing page.

### AI agents

- **WebMCP.** In a browser with [WebMCP](https://webmachinelearning.github.io/webmcp/) — for now
  Chrome, with `chrome://flags/#enable-webmcp-testing` or its origin trial — the app offers the
  browser's AI agent seven tools: list and run the command palette's commands (whatever the
  palette offers on the tab you are on), search the parts catalogue with each part's parameters,
  open a part with parameters in the Library, the Bench or Holes, attach a part to an open slot on
  the Bench, read what each tab shows — how its preview render went included, so the agent sees a
  render fail — and load a bench config. Opening a part over a bench or placed holes asks you
  first, as the buttons do, and whatever the agent does to a bench is a step you can undo. In
  other browsers nothing changes.
- **Coding agents in the desktop app.** **Settings → Coding agents** lets a coding agent on your
  computer, like Claude Code, use the open window over MCP, with the same seven tools. Copy the
  Claude Code command or a JSON config from there. It is off until you turn it on, listens only
  on this computer (port 47811), needs the token Settings shows, and refuses web pages.

### New systems and parts

- **MOD-GRID** (by 3dedc / TinyToolShop, CC BY-NC-SA 4.0): the grid, any number of holes each
  way; the pin its accessories snap in with — the designer's 2x1 pin, or a single peg for one
  hole — to fuse onto any part on the Bench so it plugs into a MOD-GRID grid; and a bit holder for
  4mm hex, 1/4" ("6mm") hex or Leatherman flat bits, one or more grid rows long. Rebuilt from the
  designer's own files and checked against them.

## 0.3.0 — 2026-10-16

### Command palette

- **Cmd/Ctrl+K** (or the new **Search** button) opens a command palette, as in Raycast: type a
  few letters to switch tabs, open Settings, set the grid or the circle detail, find a part (and
  open it in the Library, the Bench or Holes), pick a hole type, attach a part, export, undo,
  change the view, or open the GitHub page — or Layerling, on its own, as a bookmark. The first
  letters of words work too — `oib` is **Open in Bench** — and what you ran lately comes first.
  Each row shows its key where it has one. `Enter` runs a command, `Cmd/Ctrl+Enter` and
  `Alt/Option+Enter` its second and third actions (a part: open it in the Bench, or drill holes
  in it; a link: copy it), `→` lists all of them, `Esc` clears, goes back, then closes.
- **The part pickers float over the workspace**: starting a bench, starting in Holes and
  attaching a part are the same searchable list, with each part's picture, over the scene
  instead of a page of their own. `Esc` puts one away and `Cmd/Ctrl+K` brings it back; typing in
  it finds the app's other commands too. Attaching keeps the slot you clicked in view, with the
  joint beside the search.
- **Drop a model file to import it**: an STL, STEP or 3MF dropped on a part picker is imported
  there — as the base part, onto the slot being attached to, or as the model to drill. The empty
  Bench and Holes tabs take a dropped file too, and so does `Cmd/Ctrl+K` over a running bench or
  a model in Holes, which starts again on the file (it asks first, and Undo goes back).
- **Your own commands and hotkeys** — a part with your parameters in a tab, a bench preset, a
  hole type, a link — can be added to an exported settings file by hand, with an alias to type
  and a Cmd/Ctrl+Shift hotkey; an editor for them will follow. See the web app's README.

### Editing

- **Resize handles**, as in TinkerCAD: the part in the Library, and the base part on the Bench,
  get small square handles to drag. An outline shows the new size, with a label ("W 126 mm · gx 3
  (+21 each side)"), and the part renders once, when you let go. Width and depth grow on both
  sides, so the part stays centred, height grows upward, and a corner changes width and depth
  together. `Esc` cancels a drag. Every part with a size to drag has them: the Gridfinity parts,
  openGrid and Skådis boards, HSW walls, MOLLE spines and panels, BitBeam, the Basics plate,
  post and dovetails, the Arca plate, the 2020 rail.
- **Type a size**: click a handle (or Tab to it and press Enter) to enter an exact size in mm —
  any but a corner, which changes two sizes and only drags. With a handle focused, the arrow
  keys step it (Shift: ten steps of a length); resting the pointer on one shows its size.
- **Grid**: lengths snap to it as you drag or step them — Off, or 0.1 to 5 mm (0.5 mm by
  default) — set in the viewer's toolbar or under Settings → Editing.
- **Undo and redo** everywhere: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z (or Ctrl+Y off the Mac), and
  Undo/Redo buttons in each viewer's toolbar that say what they would undo — a resize, a
  parameter typed (one step per field), a part switched, a part attached or removed, a hole
  drilled or moved. Each tab keeps its own history through tab switches, and the Bench's
  **Start over** and a loaded config, and Holes' **Pick another model**, can be undone too.
- **Keyboard shortcuts**: `?` (or **Keyboard shortcuts** at the top of Settings, or the command
  palette) lists every key, what the handles do, and the mouse, trackpad and touch controls —
  searchable: type "redo", "alt" or "bench delete" to see just those.

### Holes

- **DeckMate Innie socket**: cut Mechanism's Innie into any part, so a DeckMate Outie pushes in
  and slides along to seat. Its floor sits 0.3 mm deeper than an Innie's by default (an **Extra
  depth** field), so a printed Outie seats.
- Presets are **grouped under headings** that open and close, closed but for the group of the
  preset in use, with a **search box** over names and groups.
- **MOLLE** presets: a rigid panel's opening and a slit panel's slit, and the Repeat grid's
  standard spacings now include MOLLE rigid panel (50.8 mm both ways) and MOLLE slit panel
  (38.1 × 25.4 mm) next to Skådis.
- **Resize cutouts by dragging**: a selected round or rectangular cutout has handles on its
  edges (and a rectangle's corners). The opposite edge stays where it is; hold Option (Alt) to
  resize from the centre. Click an edge's handle to type the size.
- **Drag a hole to move it**, by the round handle in its middle, in Grid steps (Shift: freely),
  and **nudge** the selected holes along their face with the arrow keys (Shift: ten steps). A
  hole that would leave its face stays put, with a note saying why.
- A click away from the snap points lands on the **Grid** setting, 0.5 mm as before unless you
  change it, or exactly where you click with it Off; the Snapping section has the Grid too.

### Bench

- **Select the base part** by clicking it in the scene, or with **Select root** in the sidebar:
  its name, Crop and Deselect sit in the viewer's toolbar. It has resize handles (attached parts
  are resized in the sidebar for now), and they never take a slot from an attached part: such a
  size is skipped (2 → 4 cells on an openGrid board with a part on it), and the label says why.
- Selecting a part in the scene opens its parameters in the sidebar, and `F` frames it.

### Viewer

- A **Helpers** button (or `H`) hides the grid, markers, guides, labels and handles in every
  viewer, to see just the model.
- A toolbar in each viewer's corner: **Fit** (or `F`), a **View** menu (Home, Top, Front, Right),
  the Grid where it applies, and Helpers. The wheel **zooms toward the pointer**.
- Editing a part keeps the camera where you put it, backing out only when the part, or its
  handles, would leave the view.

### Settings

- **Export and import settings**: every preference, bench preset and part default as one
  `.settings.json` file, to move them to another browser or machine. Import replaces what is
  there, after a confirm.

### Parts

- **GoPro**: `leg_dia` sets the leg-end diameter (14 to 20 mm, standard 15) on both the male and
  female halves.
- **MOLLE**: the insert's boss is now `boss_w` × `boss_h` (38 × 25.3 mm by default, a tenth
  under the nominal 1.5" × 1"), and the rigid panel's openings are 0.5 mm over nominal so a
  printed insert fits.
- New minimums, the floors the modules already assert: Gridfinity bin `gz` 1, HSW wall and Skådis
  board `cols` and `rows` 1, Arca plate `length` 20. The sidebar field and the CLI now stop there
  instead of failing the render.

### Fixes

- A part option picked from a dropdown keeps its type: Skådis peg's **Pegs: 2** used to reach
  OpenSCAD as the text "2" and fail the render (and could be saved that way as a default).
- Keyboard shortcuts no longer act on the page behind an open dialog (Backspace with Settings
  open deleted the selected bench part) or with Cmd/Ctrl/Alt held.
- Holes: a slow **Use the current bench** no longer replaces a model picked in the meantime; a
  click while the base is re-rendering no longer drills at the old geometry; a revised mesh with
  the same file name no longer shows the previous render from the cache; a very large Skådis
  fill radius no longer freezes the tab; big flat faces (finely meshed imports) snap again; a
  click on the floor of a rectangular or round pocket drills into it instead of selecting the
  pocket; a Shift-click on a selected hole takes it out of the selection even where a snap point
  sits on it.
- Bench: **Start over** clears the old model; a `.scad` export error is shown instead of
  failing silently; stack markers and click targets are right for parts on side and bottom
  slots; a second STEP import is not overwritten by a slower first one; ←/→ on the focused
  sidebar edge no longer also step the selected part to another slot.
- Bench configs and shared links can no longer put arbitrary code into the generated `.scad`
  through part, slot or parameter names, and are checked for non-finite numbers and duplicate
  ids.
- A failing tab shows an error with **Try again** instead of a blank page; the 3D viewer
  releases its WebGL context when it closes.
- CLI: `foundry render` works from any directory; `foundry defaults` no longer overwrites a
  config file it cannot parse, and saved defaults for two parts can no longer share a file.

### Under the hood

- The OpenSCAD bundle the browser loads is a third smaller (only the files the parts actually
  include), the catalogue ships as JSON, and the console no longer logs a spurious error after
  every render.
- CI runs the desktop tests on Windows on every push, and the Pages deploy retries once.
- **Faster**: the render engine loads while the app is idle, and again after a render is
  abandoned, so the next render skips that (up to about half a second); hovering over a model in
  Holes no longer recompiles a shader each time the snap point changes; dragging the sidebar's
  edge, and a render starting or finishing, no longer re-render the whole tab; the 3D view's
  pixel ratio is capped at 2; an undo back to something already rendered, and typing the bench's
  name, show at once instead of rendering again.
- The catalogue's **`resize`** field says which parameter each of a part's handles drives and
  how much it grows the part (read by the web app only); `tests/test_resize.py` renders each entry
  one step on and holds the mesh to the outline the handle showed.
- Contributor and agent guide (`AGENTS.md`); Python is linted with ruff, the web app is
  type-checked (libraries, workers, components with JSDoc-typed props, hooks), `make check` runs
  every check that needs neither OpenSCAD nor a browser, and a schema test guards
  `catalogue.yaml`.

## 0.2.1 — 2026-10-10

### Holes

- **USB ports**: openings for USB-C, USB-A, Micro-USB, Mini-USB and USB-B, sized for a port that
  sits at the opening, and USB-C and USB-A with room for the plug, for a port set back behind a
  wall.
- **Memory cards**: through slots for SD and microSD in a case, and holder slots that stand an SD,
  miniSD, microSD, CompactFlash or CFexpress Type A / Type B (XQD) card half in, for printing a
  card holder.

### Library and number fields

- Number fields have their **arrow buttons** back: a step a click, half a step with Shift, and
  holding one repeats. The **scroll wheel** steps a focused field too, a tenth of a step with
  Shift.
- **Add Holes** next to Open in Bench takes the selected part, with its parameters, to the Holes
  tab.
- **`/`** jumps to the Library's part search from any tab.

## 0.2.0 — 2026-10-10

### New systems and parts

- **MOLLE / PALS**: a **spine** that slides behind backpack or vest webbing and clicks in under
  the bottom row, so any part can ride on MOLLE gear; a printed **slit panel** that takes MOLLE
  pouches, like a laser-cut panel; a **rigid panel** with open windows in a grid you set (count,
  size, corner radius, pitch), like the steel panels in trucks; and a **panel insert** that plugs
  into one window of a rigid panel and gives a face to bolt or fuse things onto. All parametric:
  measure your gear.
- **Skådis**: a board with IKEA Skådis's slot pattern, and a peg with one or two hook tabs to
  hang any part on a real board.
- **Honeycomb Storage Wall**: a wall panel and a clip-in insert, on geru's OpenSCAD libraries.
- **KLIPPT**: the base, plain and with screw holes, and a clip mount to fuse onto a part.
- **Camera**: an Arca-style quick-release plate and a 1/4"-20 or 3/8"-16 tripod socket.
- **openGrid connectors**: openConnect and MultiConnect snaps, each also with a screw body.
- **Gridfinity bin**, with compartments, lip, magnets and screws, and a filled option to cut your
  own cavities into.
- **DeckMate Outie**: a slim variant, from Mechanism's own Adhesive Puck.

### Holes — a new tab

A third tab, next to Library and Bench, drills into a catalogue part, an imported mesh or the whole
bench:

- Click a face to place a hole; clicks snap to the face's centre, its quarters, set-in corners and
  holes already there, with guide lines, a bolt circle and measurements on the face.
- 34 fastener presets drawn as cross-sections (ISO cap, countersunk and button-head screws,
  heat-set inserts, thread-forming holes, nut traps, wood screws and pilots), or type your own.
- Connector slots so any part mounts on something else: openConnect and MultiConnect slots, the
  openGrid thread, a 2020 extrusion socket keyed into the rail (with an optional M5 bolt hole), a
  BitBeam / Technic pin hole, a KLIPPT channel, a Skådis slot and tripod nut traps.
- Generic round and rectangle / pill cutouts; magnet and bearing pockets (including a 25 × 4.5 mm
  pot magnet); teardrop holes on walls; chamfered openings.
- **Repeat** a hole as a row, a grid (optionally staggered, with a Skådis spacing button) or a
  circle.
- Select several holes with Shift to edit what they share, turn slots in quarter turns, or delete
  them together.

### Bench and Library

- Import **STEP** files (and 3MF) on the Bench and in Holes, with a body picker for multi-body
  files.
- **Copy for Layerling**: paste a part or a whole bench into Layerling without an STL round trip.
- A sideways shift for attached parts, and benches are named before export, so files say what
  they are.
- An openConnect head attached to a side face starts with its slide direction up.
- The Library re-renders its preview as you change parameters, and neither Library nor Bench
  shifts its layout while a render runs.
- A global **circle detail** setting (draft, normal, fine); Gridfinity holes now come out round.
- Number fields take a comma or a period as the decimal separator and no longer jump to 0 while
  you type.
- The sidebar can be resized by dragging its edge.

### Part changes

- GoPro female: a symmetric option, "mount" over the middle prong, and `outer_w` sets the far
  prong's width, down to equal prongs.
- openGrid board: connector holes centred, and the lite and screw-mounting options now render in
  the browser.
- Flat plate: 42 × 42 mm with 4 mm corners by default (one Gridfinity unit), and every size now
  renders in the browser.

### Desktop

- **Windows**: an installer for 64-bit Windows, and one for Windows on ARM (Snapdragon laptops,
  Surface Pro), next to the macOS DMGs. Per-user install without an administrator prompt, removable
  from Settings → Apps.
- The header sheds its labels at narrow window widths.

## 0.1.1 — 2026-09-23

- macOS: the DMGs' names carry no version, so the latest download has a stable link, and the
  release holds only the DMGs.

## 0.1.0 — 2026-09-23

- First release: the web app (Library and Bench) as a macOS app for Apple Silicon and Intel.
