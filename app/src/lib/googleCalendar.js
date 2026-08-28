// Wraps Google Identity Services (loaded via <script> in index.html) for
// Calendar access, and the Calendar REST API itself.
//
// Auth design: a one-time "authorization code" popup (must be triggered by a
// real click) is exchanged via the Worker for an access token + a refresh
// token. The refresh token is stored in this user's own Firestore doc (never
// touched by the Worker itself) and used to silently mint new access tokens
// on every future visit - no popup, no re-consent, ever, until revoked.

import { auth } from "./firebase.js";
import { getGoogleRefreshToken, saveGoogleRefreshToken } from "./firebase.js";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const SCOPE = "https://www.googleapis.com/auth/calendar";
const API_BASE = "https://www.googleapis.com/calendar/v3";
const eventsUrl = (calendarId) => `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

let codeClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let everConnected = false;

function ensureCodeClient() {
  if (codeClient) return codeClient;
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services script not loaded yet");
  }
  codeClient = window.google.accounts.oauth2.initCodeClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    ux_mode: "popup",
    access_type: "offline",
    prompt: "consent", // forces Google to issue a refresh_token every time
    callback: () => {}, // overridden per-request
  });
  return codeClient;
}

async function currentUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const idToken = await user.getIdToken();
  return { uid: user.uid, idToken };
}

async function workerPost(path, body, idToken) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${await res.text()}`);
  return res.json();
}

function applyTokens(tokens) {
  accessToken = tokens.access_token;
  tokenExpiresAt = Date.now() + (tokens.expires_in - 60) * 1000;
  everConnected = true;
}

// One-time explicit connect. MUST be called directly from a click handler -
// this is the only place in the whole app that opens a real Google popup.
export function connectCalendar() {
  const attempt = (async () => {
    const { uid, idToken } = await currentUser();
    return new Promise((resolve, reject) => {
      const client = ensureCodeClient();
      client.callback = async (resp) => {
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        try {
          const tokens = await workerPost("/api/calendar/exchange", { code: resp.code }, idToken);
          applyTokens(tokens);
          if (tokens.refresh_token) await saveGoogleRefreshToken(uid, tokens.refresh_token);
          resolve(accessToken);
        } catch (err) {
          reject(err);
        }
      };
      client.requestCode();
    });
  })();

  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("Google sign-in popup didn't open (likely blocked by the browser) or timed out.")),
      15000
    )
  );

  return Promise.race([attempt, timeout]);
}

// Silently restores a connection using a previously stored refresh token -
// no popup at all, safe to call automatically on page load.
export async function tryRestoreConnection() {
  try {
    const { uid, idToken } = await currentUser();
    const refreshToken = await getGoogleRefreshToken(uid);
    if (!refreshToken) return false;
    const tokens = await workerPost("/api/calendar/refresh", { refreshToken }, idToken);
    applyTokens({ ...tokens, refresh_token: undefined });
    return true;
  } catch {
    return false;
  }
}

// True once a token has been granted (this session or restored on load).
// Use this to gate any calendar call that isn't itself a direct click handler.
export function isConnected() {
  return everConnected;
}

async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  // Mid-session expiry (~1hr): refresh silently via the stored refresh token,
  // no popup needed since we already have offline access.
  const { uid, idToken } = await currentUser();
  const refreshToken = await getGoogleRefreshToken(uid);
  if (!refreshToken) throw new Error("Google Calendar isn't connected");
  const tokens = await workerPost("/api/calendar/refresh", { refreshToken }, idToken);
  applyTokens({ ...tokens, refresh_token: undefined });
  return accessToken;
}

async function apiFetch(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// The user's full list of calendars (their primary one plus any others they
// created/subscribed to, e.g. per-subject timetable calendars). Cached for
// the session since it rarely changes.
let calendarListCache = null;
export async function listCalendars({ fresh = false } = {}) {
  if (calendarListCache && !fresh) return calendarListCache;
  const data = await apiFetch(`${API_BASE}/users/me/calendarList`);
  calendarListCache = (data.items || []).filter((c) => c.selected !== false);
  return calendarListCache;
}

// Lists events across every visible calendar the user has (not just
// "primary"), since class/subject schedules are often kept on separate
// calendars. Each returned event carries calendarId/calendarName so it can
// be edited/deleted on the calendar it actually lives on.
export async function listEvents(timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const calendars = await listCalendars();
  const perCalendar = await Promise.all(
    calendars.map(async (c) => {
      try {
        const data = await apiFetch(`${eventsUrl(c.id)}?${params.toString()}`);
        return (data.items || []).map((e) => ({ ...e, calendarId: c.id, calendarName: c.summary }));
      } catch {
        return []; // skip a calendar we don't have events access to rather than failing the whole load
      }
    })
  );
  return perCalendar.flat();
}

export async function createEvent({ title, description, start, end, domain, priority, calendarId = "primary" }) {
  return apiFetch(eventsUrl(calendarId), {
    method: "POST",
    body: JSON.stringify({
      summary: title,
      description: [description, domain ? `Domain: ${domain}` : null, priority ? `Priority: ${priority}` : null]
        .filter(Boolean)
        .join("\n"),
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
    }),
  });
}

export async function updateEvent(eventId, patch, calendarId = "primary") {
  const body = {};
  if (patch.title) body.summary = patch.title;
  if (patch.description) body.description = patch.description;
  if (patch.start) body.start = { dateTime: new Date(patch.start).toISOString() };
  if (patch.end) body.end = { dateTime: new Date(patch.end).toISOString() };
  return apiFetch(`${eventsUrl(calendarId)}/${eventId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function deleteEvent(eventId, calendarId = "primary") {
  return apiFetch(`${eventsUrl(calendarId)}/${eventId}`, { method: "DELETE" });
}
