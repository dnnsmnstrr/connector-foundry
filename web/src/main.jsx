import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// The macOS shell draws behind the native title bar. Apply its layout before
// the first paint, without exposing any native APIs to the renderer.
if (window.location.protocol === "foundry:" && navigator.platform.startsWith("Mac")) {
  document.documentElement.classList.add("desktop-mac");
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
