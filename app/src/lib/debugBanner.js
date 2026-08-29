// Plain-DOM debug banner (not React) so it catches/shows errors even before
// the React tree mounts, or from code paths that swallow errors into a
// callback rather than throwing - the only practical way to see what's
// failing on a phone with no attached devtools. Tap the banner to dismiss it.
export function showDebugError(message) {
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
