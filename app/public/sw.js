// Minimal service worker: exists only so the app is installable ("Add to
// Home Screen") and can request Notification permission on the phone.
// It does not cache anything or enable offline use.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
