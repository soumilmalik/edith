import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { showDebugError } from "./lib/debugBanner.js";
import "./styles.css";

window.addEventListener("error", (e) => {
  showDebugError(`Error: ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  showDebugError(`Unhandled rejection: ${reason?.code || ""} ${reason?.message || String(reason)}`);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
