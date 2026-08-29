import { auth } from "./firebase.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// Best-effort push to the user's real Apple Reminders app via the Worker's
// iCloud CalDAV integration. Never throws - callers should treat this as
// "nice to have alongside the in-app reminder", not a hard dependency.
export async function pushAppleReminder(text, fireAt) {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch(`${WORKER_URL}/api/reminders/apple`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ text, dueAt: fireAt }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}
