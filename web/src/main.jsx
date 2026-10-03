import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
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
