# iOS and Android apps

## Decision

Use **Capacitor** to ship the web app in the App Store and Google Play. It is a native shell
(WKWebView on iOS, the system WebView on Android) that loads the same build the website serves,
from the app's own files, and gives the page native plugins for what a browser can't do. The web
code barely knows: `src/lib/nativeApp.js` is the part that does.

| Option | Fit for this application |
| --- | --- |
| Capacitor | The existing build as it is (`webDir: dist`, started at `/app/index.html`), real Xcode and Gradle projects for the stores, and plugins for native features: here, writing exports into a folder of the app's own (`@capacitor/filesystem`) and Android's back button (`@capacitor/app`). |
| PWA only | Already installable from the browser (see the README's "Phones, tablets and offline"), but not in the stores, and every download goes through the browser's own sheet or downloads folder. |
| Trusted Web Activity (Android) | Puts the website in Play, but it stays a website: no plugins, and nothing for iOS. |
| Tauri mobile, React Native | A different shell for the same web view, or a rewrite of the interface. More change for nothing this app needs. |

## What the store apps do differently

- **Saving.** Every export (`downloadBlob()` in `src/lib/download.js`) goes straight into the
  app's folder, with no sheet asking where, and a note says where it went:
  - iOS: the app's Documents folder, shown in Files as **On My iPhone › Foundry**
    (`UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` in `Info.plist`).
  - Android: **Documents › Connector Foundry**, in the shared Documents folder, where the Files app
    and a slicer can open it. Android 11 and later need no permission for the files the app
    created; 10 and older ask for the storage permission on the first save.
  - A file of the same name is never replaced: the next is `name 2.stl`, `name 3.stl`…
- **Back (Android).** The system's back gesture closes the open dialog, then puts the drawer away,
  then sends the app to the background as Android's own apps do; Capacitor's default closed the
  app whatever was open (`goBack()` in `nativeApp.js`, through `@capacitor/app`).
- **No service worker, no install offer, no "Download the desktop app".** The app's files are on
  the device and it updates through its store (`main.jsx` skips `lib/webApp.js`).
- **Dark only.** `UIUserInterfaceStyle` is Dark on iOS (the status bar's text, the keyboard and
  native controls) and the Android system bars are styled dark (`SystemBars` in
  `capacitor.config.json`). The web view runs edge to edge on both, and the page's
  `env(safe-area-inset-*)` padding keeps the nav and the drawer clear of the notch and the home
  indicator, as in the installed web app.
- The home-screen name is **Foundry** (the web app's `short_name`); the store listing is
  "Connector Foundry".

## Layout

```
web/capacitor.config.json   app id com.connectorfoundry.app, webDir dist, start at /app/index.html
                            (the leading slash matters: Android appends it to https://localhost as is)
web/ios/App/                Xcode project (Swift Package Manager, no CocoaPods)
web/android/                Gradle project
web/scripts/native-assets.mjs  icons and launch screens for both, from desktop/icon.svg
```

`cap sync` copies `dist/` into `ios/App/App/public` and `android/app/src/main/assets/public`; both
are git-ignored. The rest of the native projects is committed, as Capacitor intends: they are
source, edited in Xcode and Android Studio when a setting needs it.

## Building

Needs Xcode (iOS), the Android SDK and **JDK 21** (Android: the plugins' Gradle builds ask for a
Java 21 toolchain, and Android Studio's bundled JDK 25 is too new for the project's Gradle 8.14 —
`brew install openjdk@21` and `JAVA_HOME=/opt/homebrew/opt/openjdk@21`), and the same Node as the
web app.

```bash
cd web
npm run native:sync          # npm run build, then cap sync: dist into both projects
npx cap open ios             # Xcode: run on a simulator or device, or Product → Archive
npx cap open android         # Android Studio: run, or Build → Generate Signed App Bundle
```

From the command line:

```bash
cd web/android && ./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
cd web/ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator build
```

After `desktop/icon.svg` changes: `npm run icons:native` (it runs a pinned `@capacitor/assets`
through npx).

## Releasing

Before the first upload, once:

- **App Store:** an Apple Developer account, the app record for `com.connectorfoundry.app` in App
  Store Connect, and the team set under Signing & Capabilities in Xcode. `Info.plist` already says
  the app uses no non-exempt encryption.
- **Play:** a Play Console app for `com.connectorfoundry.app` and an upload key (Android Studio's
  Generate Signed Bundle makes one; keep it out of the repository).

For a local release, set the version — `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode,
and `versionName` / `versionCode` in `android/app/build.gradle` — then run `npm run native:sync`,
archive in Xcode and upload, and build a signed `.aab` for Play. The store apps carry the web build
they were synced with: a web deploy does not reach them until the next store release. The EAS flow
below automates the cloud build and build-number increment.

## Cloud builds with EAS

The native projects stay Capacitor projects; Expo is used only to build and sign their store
binaries. `app.config.js` gives EAS the existing bundle identifiers and reads the app version from
`package.json`. The `eas-build-post-install` hook runs `npm run native:sync` on EAS, so every cloud
build contains the current web app and generated OpenSCAD catalogue. The production profile keeps
the store-facing version in source and lets EAS increment iOS's build number and Android's version
code remotely.

One-time setup, from `web/`:

1. Sign in with `npx eas-cli login`, then run `npx eas-cli init` to create and link the EAS project.
   Add the project ID it returns as `extra.eas.projectId` in `app.config.js`.
2. Set up signing with `npx eas-cli credentials:configure-build -p ios -e production` and
   `npx eas-cli credentials:configure-build -p android -e production`, following the prompts. EAS
   can create and keep the Android upload key and Apple distribution credentials.
3. Run `npx eas-cli build:version:set` for iOS and Android, initializing each with the latest build
   number already accepted by its store. This avoids duplicate build numbers when moving to EAS.
4. Create an Expo access token and add it to the GitHub repository as the `EXPO_TOKEN` Actions
   secret.

After setup, pushing a `v<version>` tag starts `.github/workflows/mobile.yml`. It checks that the
tag matches `package.json`, then builds both store apps on EAS. The builds and logs are available
in the Expo dashboard. Uploading to TestFlight or Google Play remains a separate submit step until
the App Store Connect and Google Play submission credentials are configured; neither store
automatically releases a submitted build to everyone.

For a one-off test build, run `npx eas-cli build --platform all --profile preview` from `web/`;
the preview profile creates internally distributed builds rather than store builds.
