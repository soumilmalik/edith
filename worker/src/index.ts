import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_EMAIL: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
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
  };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
    return json({ error: "Not found" }, env, 404);
  },
};
