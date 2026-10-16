import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { warmRenderer } from "./lib/openscad-client.js";
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
// test that imports it. Safari has no requestIdleCallback.
if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => warmRenderer());
else setTimeout(warmRenderer, 1500);
