import { auth } from "./firebase.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// Rough AI estimate of calories/protein from one or more food photos (e.g. a
// product's front-of-package photo plus its nutrition facts panel, so the
// item can be identified and read accurately), text description, or both.
// Not lab-precise - a personal-tracking estimate.
export async function estimateNutrition({ images, text }) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`${WORKER_URL}/api/nutrition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ images, text }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
