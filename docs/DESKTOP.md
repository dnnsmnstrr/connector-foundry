# Desktop app

Installing Connector Foundry on macOS or Windows, updating and removing it, and how it differs from the web app. Back to the [README](../README.md).

The desktop app is the web app in a window of its own: the same three tabs, the same parts and the
same rendering engine, all built in. It works without an internet connection, opens and saves files
through your system's own dialogs, and keeps its settings apart from your browser's. If you only want
to try Connector Foundry, the [web app](https://dnnsmnstrr.github.io/connector-foundry/app/) needs no
install at all.

## Download

| Your computer | Download |
| --- | --- |
| Mac with Apple silicon (M1 and later) | [Connector-Foundry-mac-apple-silicon.dmg](https://github.com/dnnsmnstrr/connector-foundry/releases/latest/download/Connector-Foundry-mac-apple-silicon.dmg) |
| Mac with an Intel processor | [Connector-Foundry-mac-intel.dmg](https://github.com/dnnsmnstrr/connector-foundry/releases/latest/download/Connector-Foundry-mac-intel.dmg) |
| Windows 10 or 11, 64-bit Intel or AMD | [Connector-Foundry-windows-x64-setup.exe](https://github.com/dnnsmnstrr/connector-foundry/releases/latest/download/Connector-Foundry-windows-x64-setup.exe) |
| Windows on ARM (Snapdragon laptops, Surface Pro) | [Connector-Foundry-windows-arm64-setup.exe](https://github.com/dnnsmnstrr/connector-foundry/releases/latest/download/Connector-Foundry-windows-arm64-setup.exe) |

These links always fetch the newest release. Every release, with what changed in it, is on the
[releases page](https://github.com/dnnsmnstrr/connector-foundry/releases).

Not sure which Mac you have? Apple menu → **About This Mac**: a line that starts with "Chip" means
Apple silicon, "Processor" means Intel. The Windows on ARM build is new; if a release has none, the
x64 installer runs on those machines too, a little slower.

## Install on macOS

1. Open the downloaded `.dmg` and drag **Connector Foundry** onto the **Applications** folder beside
   it.
2. Open Connector Foundry from Applications.
3. The app is not notarized by Apple, so the first time you open it macOS refuses and offers to move
   it to the Trash. Choose **Done** instead, then open **System Settings → Privacy & Security**, scroll
   down to the message about Connector Foundry, and click **Open Anyway**. Confirm with your password
   or Touch ID. macOS remembers this: the app opens normally from then on.

Do not turn off Gatekeeper or run commands to strip the download's quarantine flag: **Open Anyway**
allows this one app and nothing else.

## Install on Windows

1. Run the downloaded `setup.exe`.
2. The installer is not code-signed, so SmartScreen shows "Windows protected your PC". Click
   **More info**, then **Run anyway**.
3. Choose whether to install for yourself only (the default, no administrator prompt) or for everyone
   on the PC (asks for administrator rights), and where. The installer adds Start menu and desktop
   shortcuts.

Installed for yourself only, the app lives in `%LOCALAPPDATA%\Programs\Connector Foundry`.

## Check a download

Each release publishes `SHA256SUMS.txt`, the checksum of every file in it. To compare the file you
downloaded with it:

```bash
shasum -a 256 ~/Downloads/Connector-Foundry-mac-apple-silicon.dmg   # macOS
```

```powershell
Get-FileHash $HOME\Downloads\Connector-Foundry-windows-x64-setup.exe   # Windows PowerShell
```

The long hexadecimal string printed must be the one `SHA256SUMS.txt` lists for that file.

## Update

The app updates itself. Shortly after it starts, and twice a day while it runs, it asks GitHub
whether there is a newer release. If there is, it downloads it in the background (the header shows
**Updating** with how far it has got) and checks the download against the release's checksums. Then
a **Restart to update** button appears at the right of the header: click it and the app closes,
installs the new version and opens again on the tab and bench you had. If you don't, the update
installs the next time you quit. Your settings, saved defaults and presets are kept.

A restart brings back the bench (as a bench link would), but not a model on the Holes tab or meshes
imported onto the Bench; the app asks before restarting when there are any.

**Settings → Updates** shows the version you have, **Check for updates** to look now, and a link to
what changed in a new version. Untick **Check for updates automatically** to stop the app from
looking on its own; it then never goes online unless you check by hand. On a Mac, **Connector
Foundry → Check for Updates…** in the menu bar does the same.

The app can only replace itself where it is installed properly:

- **macOS**: from the Applications folder (or another folder you can write to). Opened straight from
  the DMG or the Downloads folder, macOS runs it from a read-only copy; Settings then says so, and
  the fix is to drag it into Applications and open it from there.
- **Windows**: installed with the installer, for you or for everyone. An all-users installation asks
  for administrator rights while it updates.

Where it can't, or if an update fails, Settings links the release page, and updating by hand works
as it always has: download the newest version from the links above and install it over the old one
(on a Mac, drag it into Applications again and choose **Replace**; on Windows, run the new
installer). The [changelog](https://github.com/dnnsmnstrr/connector-foundry/blob/main/CHANGELOG.md)
says what each release changed.

## Uninstall

- **macOS**: quit the app and drag it from Applications to the Trash. Its settings stay in
  `~/Library/Application Support/Connector Foundry`; delete that folder too to remove everything.
- **Windows**: in **Settings → Apps**, find Connector Foundry and choose **Uninstall**. Settings and
  presets stay in `%APPDATA%\Connector Foundry`, in case you install it again; delete that folder to
  remove them.

## How it differs from the web app

- **Offline.** Everything the app needs is inside it: the interface, the OpenSCAD engine, the part
  sources and the meshes some parts are built from. It never goes online to render; the only thing
  it fetches is its own updates, from GitHub, which you can turn off.
- **Native file dialogs.** **Import STL / STEP / 3MF…** and **Import config…** open your system's file
  picker, and every export (**Download STL**, **Download .scad**, **Download config**) opens a Save
  dialog where you choose the name and the folder. The folder of the last export is offered again
  until you quit.
- **Its own storage.** Preferences, saved defaults and presets are kept by the app, not by your
  browser, so the two start out separate. To bring your web settings over, use **Export settings…**
  in the web app's Settings and **Import settings…** in the desktop app's; a bench moves the same way,
  with **Download config** and **Import config…**.
- **One window.** Opening the app again brings the running window to the front. On Windows the
  window controls sit at the right end of the app's own header, which doubles as the title bar.
- **Same version as its release.** The web app always runs the latest code from the main branch; the
  desktop app runs the newest release, once it has updated itself to it.

## Let coding agents use it

A coding agent on your computer, such as Claude Code, can work the open window over
[MCP](https://modelcontextprotocol.io/). It gets the same tools an AI agent in a browser gets: run
any command in the palette, search the parts, open a part with parameters, attach parts on the
Bench, load a bench, and read what each tab shows, render errors included. Everything it does
happens in the window in front of you, and **Cmd/Ctrl+Z** takes it back.

1. In **Settings → Coding agents**, tick **Let coding agents use the app (MCP)**.
2. Click **Copy Claude Code command** and run it in a terminal. It adds the app to Claude Code for
   every project. Other agents take **Copy JSON config**, an `mcpServers` entry for their config
   file.
3. Ask the agent for a part or a bench while the app is open. If the window is closed, the agent's
   first request opens it.

It is off until you turn it on. Only programs on this computer can connect, and only with the token
shown in Settings; web pages are refused. **New token…** locks out every agent set up with the old
one. The app listens on port 47811. If another program has that port, Settings says so; set another
`"port"` in `mcp.json` in the app's data folder and turn it on again. That folder is
`~/Library/Application Support/Connector Foundry` on a Mac and `%APPDATA%\Connector Foundry` on
Windows.

## Build it yourself

To run the desktop app from a checkout of the repository, or package it for your own machine, see
[the macOS build notes](MACOS.md) and [the Windows build notes](WINDOWS.md). In short, with Node.js
22.12 or newer and the repository cloned with its submodules:

```bash
cd web
npm ci
npm run desktop          # build the web app and open it in the desktop shell
npm run desktop:dist     # package it: a .app, DMG and ZIP on a Mac, an installer on Windows
```

On a Mac, `npm run desktop:install` builds the app and installs (or updates) it in Applications.
