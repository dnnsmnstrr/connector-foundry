# macOS application

## Decision

Use **Electron for the current app**. This is a native macOS application shell
around the existing React/Three.js interface, with the existing OpenSCAD WASM
worker. It is not a rewrite using native AppKit controls.

| Option | Fit for this application |
| --- | --- |
| Electron | Bundles a consistent Chromium/V8 runtime. The actual OpenSCAD workload passes, and file inputs and downloads use native OS dialogs. Larger install and baseline memory footprint. |
| Tauri / Swift + WKWebView | Smaller shell because macOS supplies WebKit. The current WASM workload failed in the WebKit probe; validate/fix this before adopting either. A Swift shell also needs its own asset loading, lifecycle, and packaging implementation. |
| Native UI and geometry engine | Potentially removes WASM limits and browser overhead, but requires a significant UI rewrite and a working, versioned OpenSCAD/Manifold integration. The locally installed OpenSCAD executable failed to launch during evaluation. |

This is a compatibility-based choice with performance measurements, not a claim
that Electron is universally faster. On this Apple Silicon machine, the runtime
probe on 2026-09-13 produced:

| Workload | Chromium timings (milliseconds) | WebKit |
| --- | --- | --- |
| 40 × 40 × 4 rounded plate, four uncached renders | 1499, 581, 560, 566 | `Maximum call stack size exceeded` on first workload |
| 2 × 2 Gridfinity base, four uncached renders | 320, 311, 305, 309 | Not reached |

The first render includes worker/engine startup. These are a small dev-server
probe, not production startup or memory benchmarks. Playwright WebKit 26.6 is
also not identical to the system WKWebView; a Tauri reconsideration should run
the workload in real WKWebView on supported macOS versions. Reproduce using:

```sh
cd web
npm ci
npx playwright install chromium webkit
npm run dev -- --port 4176
# In another terminal:
npm run benchmark:runtime
```

References: [Tauri WebView versions](https://tauri.app/reference/webview-versions/),
[Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance),
[Electron custom protocol](https://www.electronjs.org/docs/latest/api/protocol),
[native download dialogs](https://www.electronjs.org/docs/latest/api/download-item).

## Build and run

Use Node 22.12+ (Node 24 recommended) and a recursive submodule checkout.

```sh
cd web
npm ci
# If your npm policy skips install scripts:
node node_modules/electron/install.js
npm run desktop         # build the web app and launch Electron
npm run desktop:pack    # build release/mac-arm64/Connector Foundry.app on Apple Silicon
npm run desktop:dist    # build .app, DMG and ZIP in release/
```

Build each architecture separately to avoid making every user download both:
`npm run desktop:dist -- --arm64` or `npm run desktop:dist -- --x64`.
Test Intel artifacts on Intel hardware before distributing them.
The application contains the UI, WASM engine, catalogue, SCAD sources, meshes,
and notices. No Node, Python, OpenSCAD installation or network is needed to use it.

## Publishing a release

`.github/workflows/desktop.yml` builds, tests, and packages the app natively on
an Apple Silicon (`macos-15`) and an Intel (`macos-15-intel`) runner. A manual
run keeps the DMG/ZIP as workflow artifacts for 14 days. Pushing a version tag
also publishes them, with `SHA256SUMS.txt`, as a GitHub release:

```sh
npm --prefix web version 0.2.0 --no-git-tag-version   # bump web/package.json
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

The tag must equal `v` + the `web/package.json` version, or the build fails
before packaging. Release builds are
ad-hoc signed and not notarized: the release notes tell users to allow the app
once under System Settings → Privacy & Security → Open Anyway.

## Install and update from the repository

```sh
npm --prefix web run desktop:install
```

This builds a fresh app (including its icon), then updates an existing
`/Applications/Connector Foundry.app`. On a first install it uses
`~/Applications/Connector Foundry.app`, which does not require sudo.
Quit the installed app first; by default the script refuses to interrupt running work.
It checks the bundle identity, CPU architecture, and code signature, copies to
a staging directory, and verifies the copy before replacing the old app. If the
replacement fails, it attempts to restore the previous app. Saved preferences
and presets in Application Support are not changed.

```sh
# Install an already-built app without rebuilding:
npm --prefix web run desktop:install -- --no-build
# Launch after installation:
npm --prefix web run desktop:install -- --open
# Terminate the running app, install the existing build, and reopen:
npm --prefix web run desktop:install -- --no-build --force --open
# Choose the installation folder explicitly:
npm --prefix web run desktop:install -- --destination "$HOME/Applications"
```

`--force` stops only processes whose executables belong to the destination app
bundle, leaving other Electron apps and other installed copies alone. It sends
SIGTERM, waits up to three seconds, then sends SIGKILL if needed and waits up to
two more seconds. Unsaved changes may be lost. Termination happens after the
replacement has been built, copied, and verified; installation stops if the app
cannot be terminated.

The installer does not remove quarantine flags or bypass Gatekeeper. Local
build signing and public distribution requirements are unchanged.

## App icon

The editable master is [`web/desktop/icon.svg`](../web/desktop/icon.svg): two
opposing connector plates, with vector gradients, mounting bores, and a dark
rounded tile. It has no font or external image dependencies. Edit the gradient
colors to change the palette, or the `left` and `right` paths to change the mark.
Keep the transparent outer margin so it sits naturally alongside other Dock icons.

```sh
cd web
npm run icon            # regenerate icons after editing desktop/icon.svg
npm run desktop:dist    # regenerate icons and rebuild the app, DMG and ZIP
```

`scripts/generate-icon.mjs` uses the lockfile-pinned resvg renderer to rasterize
each size directly from the SVG, then Apple's `iconutil` assembles the `.icns`.
It requires macOS. Generated files in `desktop/generated/` are ignored by Git:

- `icon.png`: full 1024 × 1024 preview and development Dock icon.
- `ConnectorFoundry.iconset/`: standard and Retina PNGs from 16 to 1024 pixels.
- `icon.icns`: used by `electron-builder.yml` for the packaged application.

The desktop launch, packaging, and desktop test commands regenerate the icon
automatically. Commit the SVG, generator, and dependency lockfile; the raster
outputs can always be recreated. Browser-only builds do not run this macOS step.

## Files and performance

- The navigation row extends into the macOS title bar with no duplicate app
  title. Native traffic lights remain visible; Window Controls Overlay bounds
  reserve their space at different zoom levels. Empty header space drags the
  window, while navigation and Settings remain clickable.
- The window itself never scrolls: the header stays fixed, and the catalogue,
  parameter editor, and Bench sidebar have independent scroll areas. The empty
  Bench picker scrolls below the header. Electron keeps this pane layout when
  zoomed; narrow browser windows still use the mobile layout.
- **Import STL** and **Import config…** open the native macOS file picker.
  Imported files still pass through the app's mesh/config validation.
- Every STL, SCAD, and bench config export opens a native Save dialog, allowing
  selection of the filename and destination. The last successful export folder
  is reused until the app quits. Cancellation is silent; failed writes show an error.
- Chromium handles Blob-to-disk writes directly. No base64 encoding, copied
  byte arrays over IPC, or unrestricted filesystem API is exposed to React.
- Geometry stays in the existing cancellable worker queue; the WASM module,
  decoded sources, and bounded mesh cache remain reused. The Three.js view
  renders on demand, not continuously while idle. GPU acceleration remains on.
- Assets load from a private `foundry://app/` origin with a content security
  policy, sandboxed renderer, and Node integration disabled. No HTTP server runs.
- Preferences/presets use Electron's persistent app profile. They are separate
  from your browser's storage. Export a bench config to transfer existing work.
  Imported meshes require a config export for durable storage; this wrapper does
  not change the existing session restoration behavior.
- SCAD exports retain their existing dependency semantics: generated SCAD refers
  to repository libraries. Use bench config for a portable saved assembly, and
  STL for slicers. Finder file associations and direct overwrite/save-in-place
  are not implemented.

## Verification and distribution

```sh
npm test
npm run test:browser
npm run build
npm run test:desktop
# Also run the desktop suite against the actual packaged executable:
DESKTOP_EXECUTABLE="$PWD/release/mac-arm64/Connector Foundry.app/Contents/MacOS/Connector Foundry" npm run test:desktop
```

The desktop suite uses real WASM, checks renderer isolation, writes real files,
imports/exports a bench config, checks exported STL dimensions, and exports SCAD.
It also imports an exported STL, places a slot, and embeds the mesh in a config.
It substitutes the destination path for the interactive Save dialog only inside
the test harness. The ordinary build always presents the native dialog.

Validated locally on Apple Silicon on 2026-09-13: all 14 unit tests and eight
browser tests passed; both the development Electron launcher and signed packaged
app passed the desktop suite. The packaged test blocks HTTP/HTTPS requests.
`codesign --verify --deep --strict` passed. The app is approximately 305 MiB;
the DMG and ZIP are approximately 126 MiB each. Intel builds and public
notarization have not been tested.

Local artifacts use ad-hoc signing and can be built without an Apple Developer identity. Public
distribution needs Developer ID signing and Apple notarization. electron-builder
supports `CSC_LINK`/`CSC_KEY_PASSWORD` and notarization credentials such as
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; provide those only
through your build environment or CI secrets. Override the local identity with
`--config.mac.identity="Developer ID Application: Your Name (TEAMID)"`.
The hardened runtime configuration allows JIT for Chromium/WASM and disables
library validation for ad-hoc frameworks without a Team ID. A Developer ID
release can remove the latter entitlement after validating all embedded
framework signatures. Do not disable Gatekeeper as an installation step.

Before public distribution, supply the corresponding source and required notices
for the GPL OpenSCAD WASM component and honor the separate geometry/mesh licenses
described in the repository README. This change creates a local app, not a public
release or a new licensing policy.

The next substantial performance investigation should compare a pinned native
OpenSCAD/Manifold engine with WASM on representative complex assemblies, including
cancellation, output equivalence, startup, peak memory and large STL imports.
A shell change by itself does not remove the current WASM geometry limits.
