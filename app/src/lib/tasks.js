import { auth } from "./firebase.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// AI-assigned priority (1-5) + life domain for a new task, given the user's
// domains and current task list for context so priorities stay relative to
// what's already there rather than everything landing on the same number.
export async function prioritizeTask({ title, domains, existingTasks }) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`${WORKER_URL}/api/prioritize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ title, domains, existingTasks }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
