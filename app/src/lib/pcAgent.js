// Client for the optional local "Edith PC agent" (runs on the user's own
// Windows PC, listens only on 127.0.0.1). Only reachable from that PC's own
// browser - on a phone every call just reports "unreachable" and Edith falls
// back to text-only behavior.

const AGENT_URL = "http://127.0.0.1:7788";
const TOKEN_KEY = "edith_pc_token";
const STATUS_TTL_MS = 20000;

function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

const state = { token: loadToken(), reachable: false, paused: false, checkedAt: 0 };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn({ ...state }));

export function getPcState() {
  return { ...state };
}

export function subscribePc(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Available = paired, reachable and not paused. Cheap, synchronous, uses the
// last known status (see refreshPcStatus).
export function pcAvailable() {
  return !!state.token && state.reachable && !state.paused;
}

export async function refreshPcStatus(force = false) {
  if (!force && Date.now() - state.checkedAt < STATUS_TTL_MS) return pcAvailable();
  state.checkedAt = Date.now();
  try {
    const res = await fetch(`${AGENT_URL}/ping`, { signal: AbortSignal.timeout(1200) });
    const data = await res.json();
    state.reachable = !!data.ok;
    state.paused = !!data.paused;
  } catch {
    state.reachable = false;
  }
  emit();
  return pcAvailable();
}

async function authed(path, body) {
  const res = await fetch(`${AGENT_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 401) {
    state.token = "";
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    emit();
    throw new Error("PC agent rejected the saved pairing - reconnect it from the PC Agent panel.");
  }
  return res;
}

export async function pcRun(tool, args) {
  if (!state.token) return { error: "pc_agent_not_paired", message: "The PC agent isn't connected. Use Connect in the PC Agent panel." };
  try {
    const res = await authed("/run", { tool, args });
    if (res.status === 423) {
      state.paused = true;
      emit();
      return { error: "pc_agent_paused", message: "The PC agent is paused." };
    }
    const data = await res.json();
    if (!data.ok) return { error: data.error || "agent_error" };
    return data.result;
  } catch (err) {
    state.reachable = false;
    emit();
    return { error: "pc_agent_unreachable", message: String(err.message || err) };
  }
}

export async function pcSetPaused(paused) {
  const res = await authed(paused ? "/pause" : "/resume");
  const data = await res.json();
  state.paused = !!data.paused;
  emit();
}

export function forgetPcToken() {
  state.token = "";
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  emit();
}

// Opens the agent's own "Allow Edith?" page in a popup; the token comes back
// via postMessage only after the user clicks Allow there, and only to this
// site's origin.
export function pairPcAgent() {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      `${AGENT_URL}/pair?origin=${encodeURIComponent(window.location.origin)}`,
      "edith-pair",
      "width=520,height=460"
    );
    if (!popup) return reject(new Error("Popup blocked - allow popups for this site and try again."));
    const onMessage = (e) => {
      if (e.origin !== AGENT_URL || e.data?.type !== "edith-agent-paired" || !e.data.token) return;
      window.removeEventListener("message", onMessage);
      state.token = e.data.token;
      try { localStorage.setItem(TOKEN_KEY, state.token); } catch {}
      refreshPcStatus(true).then(() => resolve(true));
    };
    window.addEventListener("message", onMessage);
    setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(false);
    }, 120000);
  });
}
