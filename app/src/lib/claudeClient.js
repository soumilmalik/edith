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
    "When create_event or update_event reports a conflict, do NOT silently pick a resolution: explain the conflicting event(s) and their apparent priority to the user, ask how to proceed, and only call delete_event or an overwriting update_event after the user explicitly confirms. If the user decides they actually want both events kept (a deliberate double-booking), call create_event again with confirmed:true.",
    "Use delete_reminder (with the id from list_reminders) whenever the user asks to remove/cancel/dismiss a reminder.",
    "The user can attach images or PDFs to a chat message (e.g. a syllabus, a timetable photo, a notice). Read and discuss whatever they send like you normally would - and if it's academic/schedule content, proactively offer to turn it into calendar events, tasks, or study goals rather than just describing it back.",
    "You have real web search access - use it whenever a question depends on current, specific, or hard-to-recall info (e.g. a DTU course syllabus, a professor's office hours, current events, prices), the same way you'd search in a normal chat. Don't mention not having internet access - you do. Keep searches purposeful rather than reflexive for things you already know.",
    "If the user asks you to check for or resolve schedule clashes, use find_conflicts (not just list_events) - it precisely computes overlaps instead of you eyeballing times. For each clash, decide which event should yield using, in order: (1) explicit priority tags if both have one - lower priority yields; (2) proximity to a deadline/exam/test - e.g. a physics test tomorrow morning outweighs a routine gym session tonight, so suggest skipping/shifting the gym and using the time to revise instead; check nearby events or ask the user if it's unclear; (3) domain importance in context. Always propose a specific resolution (a concrete alternative time slot to shift to, found via list_events on a wider window, or a suggestion to skip) and explain your reasoning, then get explicit confirmation before calling update_event or delete_event - never resolve a clash silently.",
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

    // A long-running server-side web search can pause mid-turn; resend the
    // paused assistant message as-is (already appended to `working` above)
    // to let Anthropic continue it - no tool_result needed for that case.
    if (data.stop_reason === "pause_turn") continue;

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
