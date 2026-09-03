import { createRemoteJWKSet, jwtVerify } from "jose";
import { createAppleReminder } from "./appleReminders.js";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_EMAIL: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  APPLE_ID_EMAIL: string;
  APPLE_APP_PASSWORD: string;
}

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

// claude-sonnet-5 has extended thinking on by default with no way to opt out
// of the hidden reasoning pass short of this - it was adding real latency to
// every single reply (even "what's on my calendar") for a personal assistant
// that mostly does short structured tool calls and casual chat, not deep
// reasoning tasks. It was also the root cause of a real bug: with thinking on
// and display defaulting to "omitted" (no summary text), a client-side
// streaming bug that dropped a thinking block's signature produced a
// malformed empty thinking block that got rejected by the API the next time
// it was resent as part of the conversation history.
const THINKING_DISABLED = { type: "disabled" as const };

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

// Server-side tool: runs entirely on Anthropic's infra (no client execution
// loop needed, unlike our custom tools). max_uses caps it at 3 searches per
// message so one request can't run away - at $10/1000 searches that's 3
// cents worst case, plus normal token cost for the results. The _20260209
// variant adds dynamic filtering (Claude writes code to filter results before
// they hit context), which keeps those token costs down too.
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 };

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { system?: string; messages?: unknown[]; tools?: unknown[] };

  // The system prompt and tool schemas are identical on every single request
  // in a conversation (system only changes if the user edits their profile;
  // tools never change) - marking cache breakpoints on both means Anthropic
  // reuses that processed prefix instead of reprocessing it from scratch on
  // every message and every tool-loop round, which is a real latency (and
  // cost) win, not just a perceived one. Requires >=1024 tokens on Sonnet to
  // actually take effect - below that it's a harmless no-op.
  const tools: Record<string, any>[] = [...(body.tools || []), WEB_SEARCH_TOOL] as Record<string, any>[];
  if (tools.length > 0) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
  }

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
      system: [{ type: "text", text: body.system || "", cache_control: { type: "ephemeral" } }],
      messages: body.messages || [],
      tools,
      thinking: THINKING_DISABLED,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json();
    return json(data, env, res.status);
  }

  // Pipe Anthropic's SSE stream straight through to the browser (same
  // passthrough technique already used for TTS audio below) - the client
  // parses events itself so text can render as it's generated instead of
  // waiting for the whole reply.
  return new Response(res.body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...corsHeaders(env) },
  });
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
      thinking: THINKING_DISABLED,
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

const NUTRITION_SYSTEM = `You estimate rough nutrition for a food entry, from up to a few photos and/or a text
description. This is a personal-tracking estimate, not lab-precise - use your general knowledge and say so via
the confidence field.

When multiple images are provided, use them together - e.g. a product's front-of-package photo identifies what
the item actually is (so name it specifically in the description, like "Diet Coke" not just "soda can"), while
a separate nutrition-facts-panel photo gives the numbers. Combine both rather than only looking at one.

Reading a nutrition facts panel - do this precisely, it is the most common source of errors:
1. Labels list one row per nutrient (Energy/Calories, Protein, Carbohydrate, Sugars, Fat, Sodium, etc.), often
   with TWO value columns side by side ("Per 100g/100ml" and "Per Serving" - headers vary: "per serve", "per
   can", "%RDA"). Read the column headers first, before reading any numbers, so you know which column is which.
2. Match each value to its OWN row by reading the nutrient name and its number together in one pass - do not
   read a column of numbers top-to-bottom and assign them by vertical position. Rows are frequently uneven
   (a name can wrap to two lines, a serving-size note can sit between rows), so a number's height on the label
   is not reliable evidence of which nutrient it belongs to; the text label immediately next to it is. Protein
   and Carbohydrate are the two nutrients most often swapped this way - explicitly re-check both against their
   own row label before finalizing your answer.
3. If both a "per 100g" and a "per serving" column exist, base your numbers on the "per serving" column - that
   is what one actual serving contains. Only fall back to the per-100g column, scaled by the stated serving
   size (e.g. "Serving size: 30g" -> multiply per-100g values by 30/100), when no per-serving column is given.
4. Then scale further for the portion actually consumed if the text/photo indicates less than one full serving
   (e.g. "shared half", "drank half the can").

If no label is visible, estimate from your general knowledge of typical dishes/ingredients/serving sizes
instead, and reflect the added uncertainty in confidence.

Respond with ONLY strict JSON, no prose, no markdown fences, in this exact shape:
{"description":"short label, e.g. 'Diet Coke, 1 can (355ml)'","calories":number,"proteinG":number,"confidence":"low"|"medium"|"high"}
If you truly cannot estimate anything (no food shown/described), return {"description":"","calories":0,"proteinG":0,"confidence":"low"}.`;

async function handleNutrition(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    images?: { mimeType: string; base64: string }[];
    mimeType?: string;
    base64?: string;
    text?: string;
  };
  const images = body.images?.length
    ? body.images
    : body.base64 && body.mimeType
    ? [{ mimeType: body.mimeType, base64: body.base64 }]
    : [];
  if (images.length === 0 && !body?.text?.trim()) {
    return json({ error: "Provide at least one image, text, or both" }, env, 400);
  }

  const content: any[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType, data: img.base64 },
  }));
  content.push({
    type: "text",
    text: body.text?.trim() || "Estimate the nutrition for what's shown in the image(s).",
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      system: NUTRITION_SYSTEM,
      messages: [{ role: "user", content }],
      thinking: THINKING_DISABLED,
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) return json(data, env, res.status);

  const text = (data.content || []).find((b: any) => b.type === "text")?.text || "{}";
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    return json(JSON.parse(cleaned), env);
  } catch {
    return json({ description: "", calories: 0, proteinG: 0, confidence: "low", raw: text }, env);
  }
}

const PRIORITIZE_SYSTEM = `You assign a priority (1 = lowest, 5 = most urgent/important) and a life domain to a
single new task for a personal task list that is always displayed highest-priority first.

Base the priority on: explicit urgency/deadline language in the task text (e.g. "today", "asap", "due tomorrow"
imply higher priority than something with no time pressure), how it compares to the other tasks already on the
list (given below - spread tasks across the 1-5 range so the ordering is actually useful; do not call
everything a 3 or a 5), and which of the user's life domains it most plausibly belongs to.

Respond with ONLY strict JSON, no prose, no markdown fences, in this exact shape:
{"priority":number,"domain":"string"}`;

async function handlePrioritize(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    title?: string;
    domains?: string[];
    existingTasks?: { title: string; priority: number }[];
  };
  if (!body?.title?.trim()) return json({ error: "title is required" }, env, 400);

  const context = [
    `Life domains: ${(body.domains || []).join(", ") || "(none set)"}`,
    body.existingTasks?.length
      ? `Other tasks currently on the list (title - priority):\n${body.existingTasks
          .map((t) => `- ${t.title} - ${t.priority}`)
          .join("\n")}`
      : "No other tasks currently on the list.",
    `New task to prioritize: "${body.title.trim()}"`,
  ].join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      system: PRIORITIZE_SYSTEM,
      messages: [{ role: "user", content: context }],
      thinking: THINKING_DISABLED,
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) return json(data, env, res.status);

  const text = (data.content || []).find((b: any) => b.type === "text")?.text || "{}";
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const priority = Math.max(1, Math.min(5, Math.round(Number(parsed.priority)) || 3));
    return json({ priority, domain: parsed.domain || "" }, env);
  } catch {
    return json({ priority: 3, domain: "" }, env);
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

// Mints a short-lived (15min), single-use token scoped to realtime speech-to-
// text - the browser connects to ElevenLabs' STT WebSocket directly with
// this instead of the permanent API key (which never reaches the client).
async function handleSttToken(request: Request, env: Env): Promise<Response> {
  const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
  });
  const data = (await res.json()) as any;
  if (!res.ok) return json(data, env, res.status);
  return json(data, env);
}

// Pushes a reminder into the user's actual Apple Reminders app via iCloud
// CalDAV, using an app-specific password (never the real Apple ID password).
async function handleAppleReminder(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { text?: string; dueAt?: string };
  if (!body?.text) return json({ error: "text is required" }, env, 400);
  if (!env.APPLE_ID_EMAIL || !env.APPLE_APP_PASSWORD) {
    return json({ error: "Apple Reminders sync isn't configured on the server yet" }, env, 501);
  }
  try {
    await createAppleReminder(env.APPLE_ID_EMAIL, env.APPLE_APP_PASSWORD, { text: body.text, dueAt: body.dueAt });
    return json({ ok: true }, env);
  } catch (err: any) {
    console.error("Apple Reminders push failed:", err?.message || err);
    return json({ error: String(err?.message || err) }, env, 502);
  }
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
    if (request.method === "POST" && url.pathname === "/api/nutrition") {
      return handleNutrition(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/prioritize") {
      return handlePrioritize(request, env);
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
    if (request.method === "POST" && url.pathname === "/api/stt/token") {
      return handleSttToken(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/reminders/apple") {
      return handleAppleReminder(request, env);
    }
    return json({ error: "Not found" }, env, 404);
  },
};
