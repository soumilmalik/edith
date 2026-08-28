import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Plain-DOM debug banner (not React) so it catches errors even before/outside
// the React tree - the only way to see what's failing on a phone with no
// attached devtools. Tap the banner to dismiss it.
function showDebugError(message) {
  let el = document.getElementById("debug-error-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "debug-error-banner";
    el.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:99999;background:#3a0000;color:#ffb3b3;" +
      "font:12px monospace;padding:8px 12px;max-height:40vh;overflow:auto;white-space:pre-wrap;" +
      "border-bottom:2px solid #ff4d6d;";
    el.addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }
  const line = document.createElement("div");
  line.style.marginTop = "4px";
  line.textContent = message;
  el.appendChild(line);
}

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
