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
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

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
  return snap.exists() ? snap.data() : { water: 0, calories: 0, proteinG: 0, gymSessions: [] };
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
