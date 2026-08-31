import { auth } from "./firebase.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// Rough AI estimate of calories/protein from a food photo, text description,
// or both (e.g. a photo of a packaged snack plus "shared half with my
// roommate"). Not lab-precise - a personal-tracking estimate.
export async function estimateNutrition({ mimeType, base64, text }) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`${WORKER_URL}/api/nutrition`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ mimeType, base64, text }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
