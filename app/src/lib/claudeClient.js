import { auth } from "./firebase.js";
import { TOOL_SCHEMAS, executeTool } from "./tools.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const MAX_TOOL_ROUNDS = 6;

export function buildSystemPrompt({ profile, domains }) {
  return [
    "You are EDITH, a warm but efficient personal life-manager assistant for a BTech Mathematics & Computing student at DTU, one month into their first semester.",
    "You have direct tool access to the user's Google Calendar and their Firestore-stored profile, health logs, tasks, and reminders. Use the tools rather than guessing.",
    "The user's calendar events are spread across several Google Calendars (e.g. separate per-subject timetable calendars), not just their primary one. list_events already searches all of them - always carry the calendarId it returns for an event into any update_event/delete_event call on that same event.",
    "Always tag calendar events and tasks with one of the user's life domains, and a priority from 1-5, inferring sensible defaults if the user doesn't specify.",
    `Current life domains: ${domains.join(", ")}.`,
    "When create_event or update_event reports a conflict, do NOT silently pick a resolution: explain the conflicting event(s) and their apparent priority to the user, ask how to proceed, and only call delete_event or an overwriting update_event after the user explicitly confirms.",
    "Keep spoken/chat replies concise and natural - this may be read aloud by text-to-speech.",
    "",
    "User profile:",
    `Bio: ${profile.bio || "(not provided yet)"}`,
    `Decade goals: ${profile.decadeGoals || "(not provided yet)"}`,
    `Year goals: ${profile.yearGoals || "(not provided yet)"}`,
    `Month goals: ${profile.monthGoals || "(not provided yet)"}`,
    `Week goals: ${profile.weekGoals || "(not provided yet)"}`,
    "",
    `Current datetime: ${new Date().toString()}`,
  ].join("\n");
}

async function callWorker(body) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`${WORKER_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Worker /api/chat ${res.status}: ${await res.text()}`);
  return res.json();
}

// messages: [{role:'user'|'assistant', content: string | array}]
// toolCtx: passed straight through to executeTool - {uid, onProfileUpdated, onCalendarChanged, onStartTimer}
// Returns { messages: <updated full history>, replyText: <final assistant text> }
export async function sendMessage({ messages, system, uid, toolCtx = {} }) {
  let working = [...messages];
  let replyText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callWorker({ system, messages: working, tools: TOOL_SCHEMAS });
    const content = data.content || [];
    working = [...working, { role: "assistant", content }];

    const toolUses = content.filter((b) => b.type === "tool_use");
    const textBlocks = content.filter((b) => b.type === "text");
    replyText = textBlocks.map((b) => b.text).join("\n").trim() || replyText;

    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    const toolResults = [];
    for (const use of toolUses) {
      let result;
      try {
        result = await executeTool(use.name, use.input, { uid, ...toolCtx });
      } catch (err) {
        result = { error: String(err.message || err) };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    working = [...working, { role: "user", content: toolResults }];
  }

  return { messages: working, replyText };
}
