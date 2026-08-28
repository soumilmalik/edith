// Wraps Google Identity Services (loaded via <script> in index.html) for an
// OAuth access token scoped to Calendar, and the Calendar REST API itself.
// This never goes through the Worker backend - the token lives only in the browser.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPE = "https://www.googleapis.com/auth/calendar";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services script not loaded yet");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {}, // overridden per-request in requestAccessToken
  });
  return tokenClient;
}

export function requestAccessToken({ silent = false } = {}) {
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient();
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: silent ? "" : "consent" });
  });
}

async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  return requestAccessToken({ silent: !!accessToken });
}

async function calendarFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${CALENDAR_BASE}${path}`, {
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

export async function listEvents(timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await calendarFetch(`?${params.toString()}`);
  return data.items || [];
}

export async function createEvent({ title, description, start, end, domain, priority }) {
  return calendarFetch("", {
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

export async function updateEvent(eventId, patch) {
  const body = {};
  if (patch.title) body.summary = patch.title;
  if (patch.description) body.description = patch.description;
  if (patch.start) body.start = { dateTime: new Date(patch.start).toISOString() };
  if (patch.end) body.end = { dateTime: new Date(patch.end).toISOString() };
  return calendarFetch(`/${eventId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function deleteEvent(eventId) {
  return calendarFetch(`/${eventId}`, { method: "DELETE" });
}
