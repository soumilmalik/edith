import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_EMAIL: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
}

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

function corsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

// ALLOWED_ORIGIN may be a comma-separated allowlist (e.g. the deployed site
// plus http://localhost:5173 for local dev). Reflect back whichever one the
// request actually came from, since a single Access-Control-Allow-Origin
// value can't match multiple origins at once.
function resolveAllowedOrigin(request: Request, rawAllowed: string): string {
  const origin = request.headers.get("Origin") || "";
  const allowed = rawAllowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return origin;
  return allowed[0] || "*";
}

function json(data: unknown, env: Env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function requireAuthorizedUser(request: Request, env: Env): Promise<Response | null> {
  const auth = request.headers.get("Authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) return json({ error: "Missing bearer token" }, env, 401);

  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    if (!payload.email || (payload.email as string).toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
      return json({ error: "Not authorized" }, env, 403);
    }
    if (!payload.email_verified) {
      return json({ error: "Email not verified" }, env, 403);
    }
  } catch (err) {
    return json({ error: "Invalid token" }, env, 401);
  }
  return null; // authorized
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { system?: string; messages?: unknown[]; tools?: unknown[] };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: body.system || "",
      messages: body.messages || [],
      tools: body.tools || [],
    }),
  });

  const data = await res.json();
  if (!res.ok) return json(data, env, res.status);
  return json(data, env);
}

const EXTRACT_SYSTEM = `You extract calendar events from an uploaded schedule/timetable image or PDF.
Respond with ONLY strict JSON, no prose, no markdown fences, in this exact shape:
{"events":[{"title":"string","start":"ISO 8601 datetime","end":"ISO 8601 datetime","domain":"string or omit"}]}
If the document is a recurring weekly timetable with only day-of-week and time (no dates), generate events for
the next upcoming occurrence of each listed day, starting from today, using the current date given below.
If duration is unclear, default to 1 hour. If nothing can be extracted, return {"events":[]}.`;

async function handleExtract(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { mimeType: string; base64: string };
  if (!body?.base64 || !body?.mimeType) {
    return json({ error: "mimeType and base64 are required" }, env, 400);
  }

  const isPdf = body.mimeType === "application/pdf";
  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.base64 } }
    : { type: "image", source: { type: "base64", media_type: body.mimeType, data: body.base64 } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system: `${EXTRACT_SYSTEM}\nCurrent date: ${new Date().toISOString()}`,
      messages: [
        {
          role: "user",
          content: [contentBlock, { type: "text", text: "Extract the events as instructed." }],
        },
      ],
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) return json(data, env, res.status);

  const text = (data.content || []).find((b: any) => b.type === "text")?.text || "{}";
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return json(parsed, env);
  } catch {
    return json({ events: [], raw: text }, env);
  }
}

// Exchanges a one-time Google authorization code (from the frontend's
// initCodeClient popup) for an access token + refresh token. The refresh
// token is handed back to the frontend to store in the user's own Firestore
// doc - this Worker stores nothing itself.
async function handleCalendarExchange(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { code?: string };
  if (!body?.code) return json({ error: "code is required" }, env, 400);

  const params = new URLSearchParams({
    code: body.code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: "postmessage",
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await res.json()) as any;
  if (!res.ok) return json(data, env, res.status);

  return json(
    { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in },
    env
  );
}

// Mints a fresh access token from a previously stored refresh token. No
// Google popup involved at all - this is what lets the app "remember" the
// user across page reloads.
async function handleCalendarRefresh(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { refreshToken?: string };
  if (!body?.refreshToken) return json({ error: "refreshToken is required" }, env, 400);

  const params = new URLSearchParams({
    refresh_token: body.refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = (await res.json()) as any;
  if (!res.ok) return json(data, env, res.status);

  return json({ access_token: data.access_token, expires_in: data.expires_in }, env);
}

// Synthesizes speech via ElevenLabs and streams the raw MP3 bytes straight
// back to the frontend (no base64 round-trip needed).
async function handleTts(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { text?: string };
  const text = (body.text || "").slice(0, 5000);
  if (!text.trim()) return json({ error: "text is required" }, env, 400);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": env.ELEVENLABS_API_KEY,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      // Flash v2.5: 0.5 credits/char (half the cost of the default model),
      // and ElevenLabs' lowest-latency option - the right tradeoff for a
      // real-time assistant on a free-tier credit budget.
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return json({ error: "ElevenLabs TTS failed", detail: errText }, env, res.status);
  }

  return new Response(res.body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", ...corsHeaders(env) },
  });
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    // Resolve the multi-origin allowlist down to the single origin this
    // request actually came from, then thread it through as env.ALLOWED_ORIGIN
    // so every existing handler/json()/corsHeaders() call works unchanged.
    const env: Env = { ...rawEnv, ALLOWED_ORIGIN: resolveAllowedOrigin(request, rawEnv.ALLOWED_ORIGIN) };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const authError = await requireAuthorizedUser(request, env);
    if (authError) return authError;

    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/extract") {
      return handleExtract(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/calendar/exchange") {
      return handleCalendarExchange(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/calendar/refresh") {
      return handleCalendarRefresh(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/tts") {
      return handleTts(request, env);
    }
    return json({ error: "Not found" }, env, 404);
  },
};
