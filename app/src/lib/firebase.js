import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { todayKey } from "./dateKey.js";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const ALLOWED_EMAIL = import.meta.env.VITE_ALLOWED_EMAIL;

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function isAllowedEmail(user) {
  return !!user && !!user.email && user.email.toLowerCase() === (ALLOWED_EMAIL || "").toLowerCase();
}

// Both signInWithPopup and signInWithRedirect turned out unreliable on iOS
// Safari and Brave: they depend on cross-origin storage correlation (bouncing
// through the Firebase authDomain and back) that these browsers' tracking
// protections partition/block, so the flow "completes" on Google's side but
// never re-establishes locally. Google Identity Services' native button
// (already used for Calendar) hands us an ID token directly in-page with no
// redirect at all, sidestepping that entirely.
export function signInWithGoogleIdToken(idToken) {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}

export function signOutUser() {
  return signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// ---- Firestore data helpers, all scoped under users/{uid} ----

const userDoc = (uid) => doc(db, "users", uid);

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid, "meta", "profile"));
  return snap.exists()
    ? snap.data()
    : { bio: "", decadeGoals: "", yearGoals: "", monthGoals: "", weekGoals: "" };
}

export async function saveProfile(uid, profile) {
  await setDoc(doc(db, "users", uid, "meta", "profile"), profile, { merge: true });
}

const DEFAULT_DOMAINS = ["Health", "Academics", "Business/Money", "Extracurriculars"];

export async function getDomains(uid) {
  const snap = await getDoc(doc(db, "users", uid, "meta", "domains"));
  if (snap.exists() && Array.isArray(snap.data().list)) return snap.data().list;
  await setDoc(doc(db, "users", uid, "meta", "domains"), { list: DEFAULT_DOMAINS });
  return DEFAULT_DOMAINS;
}

export async function saveDomains(uid, list) {
  await setDoc(doc(db, "users", uid, "meta", "domains"), { list });
}

export async function getHealthLog(uid, dateKey) {
  const snap = await getDoc(doc(db, "users", uid, "healthLogs", dateKey));
  return snap.exists() ? snap.data() : { water: 0, calories: 0, proteinG: 0, gymSessions: [], foodEntries: [] };
}

export async function saveHealthLog(uid, dateKey, data) {
  await setDoc(doc(db, "users", uid, "healthLogs", dateKey), data, { merge: true });
}

// Past days' logs, most recent first - doc ids are YYYY-MM-DD so they sort
// correctly as plain strings. Same Firestore security rules as everything
// else under users/{uid}: only this account can read it, nothing public.
export async function listHealthLogs(uid, days = 60) {
  const q = query(collection(db, "users", uid, "healthLogs"), orderBy("__name__", "desc"), limit(days));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }));
}

export async function listTasks(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, "tasks"), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addTask(uid, task) {
  const ref = await addDoc(collection(db, "users", uid, "tasks"), {
    ...task,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTask(uid, taskId, patch) {
  await updateDoc(doc(db, "users", uid, "tasks", taskId), patch);
}

export async function getTask(uid, taskId) {
  const snap = await getDoc(doc(db, "users", uid, "tasks", taskId));
  return snap.exists() ? { id: taskId, ...snap.data() } : null;
}

// A task can carry an optional healthEffect ({waterMl, calories, proteinG}) -
// checking it off applies that delta to today's health log automatically
// (e.g. a daily "Creatine" task that also logs 250ml of water); unchecking
// reverses it, so an accidental double-toggle doesn't double-count. Call
// this with the task's state from BEFORE the done change, and the new value.
export async function applyTaskHealthEffect(uid, task, newDone) {
  if (!task?.healthEffect || newDone === task.done) return;
  const sign = newDone ? 1 : -1;
  const eff = task.healthEffect;
  const dateKey = todayKey();
  const current = await getHealthLog(uid, dateKey);
  await saveHealthLog(uid, dateKey, {
    water: (current.water || 0) + (eff.waterMl || 0) * sign,
    calories: (current.calories || 0) + (eff.calories || 0) * sign,
    proteinG: (current.proteinG || 0) + (eff.proteinG || 0) * sign,
  });
}

// Google Calendar refresh token, so the app can silently reconnect on future
// visits without a popup. Lives only in this user's own protected doc.
export async function getGoogleRefreshToken(uid) {
  const snap = await getDoc(doc(db, "users", uid, "meta", "googleAuth"));
  return snap.exists() ? snap.data().refreshToken || null : null;
}

export async function saveGoogleRefreshToken(uid, refreshToken) {
  await setDoc(doc(db, "users", uid, "meta", "googleAuth"), { refreshToken }, { merge: true });
}

export async function deleteTask(uid, taskId) {
  await deleteDoc(doc(db, "users", uid, "tasks", taskId));
}

// Once per local day (tracked in a small meta doc, not per-task): completed
// one-off tasks get cleared out so the list starts the day fresh (unticked
// ones are simply never touched, which is what "carries them forward");
// completed recurring tasks are reset back to unchecked instead of deleted,
// so a daily habit like "Creatine" reappears unticked every day rather than
// vanishing once it's done.
export async function rolloverTasksIfNewDay(uid) {
  const today = todayKey();
  const metaRef = doc(db, "users", uid, "meta", "taskRollover");
  const metaSnap = await getDoc(metaRef);
  if (metaSnap.exists() && metaSnap.data().date === today) return;

  const doneSnap = await getDocs(query(collection(db, "users", uid, "tasks"), where("done", "==", true)));
  await Promise.all(
    doneSnap.docs.map((d) => (d.data().recurring ? updateDoc(d.ref, { done: false }) : deleteDoc(d.ref)))
  );
  await setDoc(metaRef, { date: today }, { merge: true });
}

export async function listReminders(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, "reminders"), orderBy("fireAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addReminder(uid, reminder) {
  const ref = await addDoc(collection(db, "users", uid, "reminders"), reminder);
  return ref.id;
}

export async function dismissReminder(uid, reminderId) {
  await deleteDoc(doc(db, "users", uid, "reminders", reminderId));
}

export { userDoc };
