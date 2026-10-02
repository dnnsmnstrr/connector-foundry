# Windows application

The Windows app is the same Electron shell as the [macOS app](MACOS.md): the
React/Three.js interface and the OpenSCAD WASM worker, packaged with
electron-builder. One `desktop/main.cjs` serves both; the few places that
differ are marked by `process.platform` there and by the `desktop-win` class
in the stylesheet. There is no Windows machine behind this port: it was built
and inspected on a Mac and run, tested and screenshotted on GitHub's
`windows-latest` runner, which is where every claim below was checked.

## What a user gets

- `Connector-Foundry-windows-x64-setup.exe`, an NSIS installer for 64-bit
  Windows 10 and later. It offers a per-user install (the default, no
  administrator prompt, into `%LOCALAPPDATA%\Programs\Connector Foundry`) or
  one for all users (which asks for administrator rights), lets the folder be
  changed, and adds Start menu and desktop shortcuts. Settings → Apps
  uninstalls it; preferences and presets under `%APPDATA%\Connector Foundry`
  survive that, like on macOS.
- The installer is not code-signed, so SmartScreen shows "Windows protected
  your PC" on first run: **More info**, then **Run anyway**. The release notes
  say so, and `SHA256SUMS.txt` is published next to it.
- The navigation row is the title bar: Electron's window controls overlay
  draws minimise, maximise and close over the top-right corner, and the row
  keeps clear of them by reading the overlay's bounds (`env(titlebar-area-*)`),
  the same way the macOS build keeps clear of the traffic lights. A hidden
  title bar makes the window frameless on Windows, so there is no menu bar;
  the application menu only supplies shortcuts, which work all the same:
  Ctrl+0, Ctrl+Plus and Ctrl+Minus for zoom, F11 for fullscreen, Ctrl+W to
  close the window (Alt+F4 quits, as everywhere on Windows).
- Launching the app a second time focuses the running window instead of
  opening another one. Windows starts a fresh process per launch, so the
  main process takes Electron's single-instance lock there (and on Linux);
  on macOS, where the development launcher and the installed app share a
  profile, it is deliberately not taken.
- The taskbar groups and pins the app by its AppUserModelID, the same
  `com.connectorfoundry.desktop` electron-builder writes into the shortcut.
- Imports and exports go through the native Windows file dialogs, as on
  macOS. Nothing else differs: same offline `foundry://app/` origin, same
  sandboxed renderer, same geometry worker.

## Build

On Windows, from a recursive submodule checkout with Node 22.12+:

```powershell
cd web
npm ci
npm run desktop          # build the web app and launch Electron
npm run desktop:dist     # build release\win-unpacked\ and the installer
```

From a Mac, the same installer cross-builds:

```sh
cd web
npm run desktop:dist -- --win --x64
```

No Wine is involved there. electron-builder 26 edits the executable's icon
and version resources with a pure-JS PE editor (`resedit`), runs its own
`makensis` build for the host platform, and on macOS extracts the uninstaller
from the freshly built installer itself (a Linux host runs the installer
under Wine for that step, so Linux needs Wine installed, or electron-builder's
`toolsets.wine` bundle). `electron-builder.yml` selects its unified
NSIS toolset (`toolsets.nsis: '1.2.1'`, makensis 3.12) because that one
ships a native compiler for Apple Silicon; the legacy default is an x86_64
binary that needs Rosetta. The first build downloads the toolset into
electron-builder's cache. `npm run icon` writes the `.ico` in plain
JavaScript too (`scripts/ico.mjs`, covered by `tests/unit/ico.test.js`), so
the icon step no longer requires macOS; only the `.icns` does.

To look inside an installer without running it, 7-Zip opens NSIS executables:

```sh
7zz l release/Connector-Foundry-*-setup.exe        # installer contents
7zz x release/Connector-Foundry-*-setup.exe -o/tmp/setup '$PLUGINSDIR/app-64.7z'
7zz x /tmp/setup/'$PLUGINSDIR'/app-64.7z -o/tmp/app  # the installed tree
npx asar list /tmp/app/resources/app.asar | head     # dist/ and desktop/ inside
```

## Test

`npm test` and `npm run test:desktop` run on Windows unchanged: Node's test
runner expands the `tests/**/*.test.*` globs itself, so `cmd.exe` not doing so
does not matter. The desktop suite drives the packaged executable when
`DESKTOP_EXECUTABLE` names it (a path relative to `web/` is fine):

```powershell
$env:DESKTOP_EXECUTABLE = "release\win-unpacked\Connector Foundry.exe"
npm run test:desktop
```

Besides the offline render, import and export checks it shares with macOS,
the suite asserts the platform's shell class, that the window controls
overlay is active and the header's padding reaches past the controls, and
that a second launch quits with exit code 0 and un-minimises the first
window. It saves screenshots of the Library and the Bench import dialog to
`test-results/desktop/<platform>-<arch>/`; CI uploads them as the
`desktop-test-results-win-x64` artifact. They show the page as Windows
renders it, with the header's right end left free; the controls themselves
are drawn by Windows outside the page, so their clearance is what the
overlay-rect assertion checks, not the picture. On `windows-latest`
(2026-10-02, run 36942639310) the window came up 1024 px wide, the overlay
reported a 887 px title bar area, so the controls took 137 px, and the header
reserved 157 px; the suite took eight seconds against the installed app.

## CI and releases

`.github/workflows/desktop.yml` runs one job per platform; the shared steps
use `bash` (Git for Windows provides it on the Windows runners), the two
Windows-only ones PowerShell. The Windows job installs dependencies, runs the
unit tests, builds the installer with a fixed name, runs that installer
silently into a scratch folder (`/S /D=…`), runs the desktop suite against the
installed `Connector Foundry.exe`, runs the uninstaller silently and checks it
cleaned up, and uploads the installer and the screenshots. An experimental
`windows-11-arm` entry (`continue-on-error`) does the same for an ARM64
build. A version tag publishes the installers alongside the DMGs; see
[MACOS.md](MACOS.md#publishing-a-release) for the tagging steps.

## Not done

- **Code signing.** An EV or OV certificate (`CSC_LINK`/`CSC_KEY_PASSWORD`)
  or Azure Trusted Signing (`win.azureSignOptions`) would remove the
  SmartScreen warning; both are configured through electron-builder's
  environment, never through a file in this repository.
- **Windows on ARM.** Electron and electron-builder support `--arm64`, and
  GitHub has `windows-11-arm` runners; a matrix entry mirroring the x64 one
  is all it would take, once there is a machine to try the result on.
- **Auto-update, file associations, a portable build.** Same status as on
  macOS: not implemented. The `.blockmap` electron-builder emits is for
  differential updates and is dropped from releases.
