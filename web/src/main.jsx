import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { warmRenderer } from "./lib/openscad-client.js";
import { startWebApp } from "./lib/webApp.js";
import "./styles.css";

// The desktop shells draw behind the native title bar: macOS keeps its
// traffic lights on the left, Windows its window controls on the right.
// Apply that layout before the first paint, without exposing any native
// APIs to the renderer.
if (window.location.protocol === "foundry:") {
  const root = document.documentElement;
  root.classList.add("desktop");
  if (navigator.platform.startsWith("Mac")) root.classList.add("desktop-mac");
  else if (navigator.platform.startsWith("Win")) root.classList.add("desktop-win");
}

// From here on an error is the app's, not a sign the browser can't run
// it: public/gate.js stops reading errors as "update your browser" once
// this is set. It runs after every module imported above has evaluated.
/** @type {any} */ (window).__appStarted = true;

// A browser the gate (public/gate.js, loaded before this module) turned
// away has its message up already: this module only parsed by luck, and
// the app would throw into an error boundary a few calls in.
const unsupported = Boolean(/** @type {any} */ (window).__unsupported);

if (!unsupported) {
  // The installed web app (lib/webApp.js): before the first render, since
  // the browser's install offer can come before React has mounted. The
  // service worker (src/sw.js, emitted as sw.js at the base by the build,
  // its scope the whole site so it sees the render worker's fetches) keeps
  // the app's chunks, the OpenSCAD engine and the .scad bundle in Cache
  // Storage, so a returning phone loads them from disk and the app opens
  // offline. Only where it can work and should: the production build,
  // over https or on localhost (vite preview; the browser tests block it
  // unless a spec allows it). Nothing of this under the desktop app's
  // foundry:// scheme, which serves dist from disk and updates itself.
  if (window.location.protocol !== "foundry:") {
    const secureHost =
      location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
    const worker = import.meta.env.PROD && secureHost && "serviceWorker" in navigator;
    startWebApp({
      win: window,
      buildId: __BUILD_ID__,
      scriptUrl: worker ? `${import.meta.env.BASE_URL}sw.js` : undefined,
      scope: import.meta.env.BASE_URL,
    });
  }

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Start the render worker once the first paint is out of the way, so the
  // first render of a session doesn't also wait for the engine to load (see
  // openscad-client.js's warm-up notes). Called here, once per page load:
  // a component's effect would run twice under StrictMode, and scheduling it
  // when openscad-client.js is imported would leak a timer into every unit
  // test that imports it. Safari has no requestIdleCallback. Not with the
  // browser's data saver on (Chromium's navigator.connection): the engine
  // and the sources are most of the app's bytes, and a landing on the
  // Bench or Holes may never render; the first render creates the worker
  // on demand as it always could.
  const saveData = /** @type {any} */ (navigator).connection?.saveData === true;
  if (!saveData) {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => warmRenderer());
    else setTimeout(warmRenderer, 1500);
  }
}
