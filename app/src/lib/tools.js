import * as cal from "./googleCalendar.js";
import * as fb from "./firebase.js";
import { pushAppleReminder } from "./appleReminders.js";
import { todayKey } from "./dateKey.js";
import { computeInsertOrder, sortByOrder } from "./taskOrder.js";

// Claude tool schemas. Kept small and explicit so Claude always reasons
// about conflicts/domains through the model, not hidden app logic.
export const TOOL_SCHEMAS = [
  {
    name: "list_events",
    description:
      "List calendar events in a time window, to check the user's schedule or detect conflicts. Searches across all of the user's calendars (not just primary) - each result includes calendarId, which you must pass back into update_event/delete_event for that event.",
    input_schema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "ISO datetime, inclusive start" },
        timeMax: { type: "string", description: "ISO datetime, exclusive end" },
      },
      required: ["timeMin", "timeMax"],
    },
  },
  {
    name: "find_conflicts",
    description:
      "Scan a time window for calendar events that overlap each other (already on the calendar, not a new event you're about to create). Returns them grouped by clash, with each event's domain/priority if it has one. Overlap detection is done precisely in code - use this instead of eyeballing list_events results when asked to check the schedule for clashes.",
    input_schema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "ISO datetime, inclusive start" },
        timeMax: { type: "string", description: "ISO datetime, exclusive end" },
      },
      required: ["timeMin", "timeMax"],
    },
  },
  {
    name: "create_event",
    description:
      "Create a calendar event. If it overlaps an existing event, this returns the conflict instead of creating anything - discuss it with the user, then if they want both events kept (a deliberate double-booking), call this again with confirmed:true to actually create it despite the overlap.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        start: { type: "string", description: "ISO datetime" },
        end: { type: "string", description: "ISO datetime" },
        domain: { type: "string", description: "Life domain this belongs to" },
        priority: { type: "integer", description: "1 (low) to 5 (critical)" },
        confirmed: {
          type: "boolean",
          description: "Set true only after the user has explicitly confirmed they want this created despite a reported conflict",
        },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "update_event",
    description:
      "Edit an existing calendar event by its id. Pass the calendarId exactly as returned by list_events for that event (defaults to 'primary' if omitted, but many events live on other calendars, e.g. per-subject timetable calendars).",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        calendarId: { type: "string", description: "From list_events' calendarId field for this event" },
        title: { type: "string" },
        description: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "delete_event",
    description:
      "Delete a calendar event by id. Pass the calendarId exactly as returned by list_events for that event. Only call this after the user has explicitly confirmed in the conversation.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        calendarId: { type: "string", description: "From list_events' calendarId field for this event" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "log_health",
    description:
      "Log water intake (ml), calories, protein (g), or a gym session for a given date (defaults to today). If the user describes/shows food (including via an attached photo) rather than giving exact numbers, estimate calories and protein yourself using general nutritional knowledge - factor in any portion mentioned (e.g. 'shared half') - then log the estimate and tell the user it's a rough estimate. If a nutrition facts panel is attached, read it precisely: labels often show two value columns ('per 100g' and 'per serving') - identify the column headers before reading any numbers, use the 'per serving' column as the base (only scale from per-100g if no per-serving column exists), and match each number to its own row by reading the nutrient name and value together rather than by vertical position - Protein and Carbohydrate are the two rows most often swapped this way, so double-check both against their row label before answering. Whenever calories/protein come from food or drink (not a generic top-up), always include foodDescription too, so it shows up in the user's visible 'Food logged today' list, not just the totals.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        waterMl: { type: "integer" },
        calories: { type: "integer" },
        proteinG: { type: "integer", description: "Protein in grams" },
        foodDescription: {
          type: "string",
          description: "Short label for what was eaten/drunk, e.g. 'Half a can of Diet Coke' - set this whenever calories/proteinG are for food/drink.",
        },
        gymSession: {
          type: "object",
          properties: {
            type: { type: "string" },
            durationMin: { type: "integer" },
          },
        },
      },
    },
  },
  {
    name: "get_health_log",
    description: "Read the water/calorie/gym log for a given date.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" } },
      required: ["date"],
    },
  },
  {
    name: "set_reminder",
    description:
      "Create a reminder for a specific future point in time (e.g. 'remind me to call mom at 6pm', 'remind me about the meeting tomorrow morning') - fires a notification while the app is open. For a short countdown from right now (e.g. 'set a timer for 10 minutes'), use start_timer instead, which shows a live visible countdown.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        fireAt: { type: "string", description: "ISO datetime" },
        domain: { type: "string" },
      },
      required: ["text", "fireAt"],
    },
  },
  {
    name: "start_timer",
    description:
      "Start a countdown timer for N minutes from now, visible with a live countdown in the Timers panel. Use this for 'set a timer for X minutes', not set_reminder.",
    input_schema: {
      type: "object",
      properties: {
        minutes: { type: "number" },
        label: { type: "string", description: "Optional short label, e.g. 'pasta'" },
      },
      required: ["minutes"],
    },
  },
  {
    name: "list_reminders",
    description: "List all pending reminders.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_reminder",
    description: "Delete/dismiss a reminder by its id (from list_reminders).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_profile",
    description:
      "Save or update the user's life profile: bio/background, decade goals, year goals, month goals, week goals. Call this whenever the user shares this kind of information in conversation (e.g. during onboarding), merging with what's already known.",
    input_schema: {
      type: "object",
      properties: {
        bio: { type: "string" },
        decadeGoals: { type: "string" },
        yearGoals: { type: "string" },
        monthGoals: { type: "string" },
        weekGoals: { type: "string" },
      },
    },
  },
  {
    name: "add_task",
    description:
      "Add a standalone task/goal (not tied to a specific calendar time) to the user's Task List panel, tagged with a domain and priority. The Task List is always sorted highest-priority first, so weigh the priority (1 lowest - 5 most urgent/important) against the user's other current tasks rather than defaulting to the middle - use list_tasks first if you need to see what's already there.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        domain: { type: "string" },
        priority: { type: "integer", description: "1 (lowest) to 5 (most urgent/important)" },
        dueDate: { type: "string" },
      },
      required: ["title", "domain"],
    },
  },
  {
    name: "list_tasks",
    description: "List all current tasks on the Task List panel, with their priority/domain/done state.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "play_alexa_music",
    description:
      "Triggers the user's personal shortcut that plays 'Mulemantra' (aka 'Mool Mantra') on loop on their Alexa via Spotify. Call this whenever the user asks to play that song on Alexa - phrasing and voice transcription of the name vary a lot (e.g. 'play mole manter', 'play mool mantra', 'put on mulemantra'). No input needed.",
    input_schema: { type: "object", properties: {} },
  },
];

const DOMAIN_RE = /Domain:\s*(.+)/i;
const PRIORITY_RE = /Priority:\s*(\d+)/i;

function simplifyEvent(e) {
  const description = e.description || "";
  const domainMatch = description.match(DOMAIN_RE);
  const priorityMatch = description.match(PRIORITY_RE);
  return {
    id: e.id,
    calendarId: e.calendarId,
    calendarName: e.calendarName,
    title: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    description,
    domain: domainMatch ? domainMatch[1].trim() : null,
    priority: priorityMatch ? Number(priorityMatch[1]) : null,
  };
}

function timeOverlaps(a, b) {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}

// Transitively clusters events that overlap each other into groups; only
// groups with more than one event (an actual clash) are returned.
function groupOverlapping(events) {
  const groups = [];
  const used = new Set();
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const group = [events[i]];
    for (let j = i + 1; j < events.length; j++) {
      if (used.has(j)) continue;
      if (group.some((e) => timeOverlaps(e, events[j]))) {
        group.push(events[j]);
        used.add(j);
      }
    }
    if (group.length > 1) {
      groups.push(group);
      used.add(i);
    }
  }
  return groups;
}

const CALENDAR_TOOLS = new Set(["list_events", "find_conflicts", "create_event", "update_event", "delete_event"]);

// ctx = { uid }
export async function executeTool(name, input, ctx) {
  if (CALENDAR_TOOLS.has(name) && !cal.isConnected()) {
    return {
      error: "calendar_not_connected",
      message:
        "Google Calendar isn't connected in this browser session yet. Tell the user to click 'Connect Google Calendar' in the Calendar panel, then ask again.",
    };
  }
  switch (name) {
    case "list_events": {
      const events = await cal.listEvents(input.timeMin, input.timeMax);
      return events.map(simplifyEvent);
    }
    case "find_conflicts": {
      const events = await cal.listEvents(input.timeMin, input.timeMax);
      const simplified = events.filter((e) => e.status !== "cancelled").map(simplifyEvent);
      const groups = groupOverlapping(simplified);
      if (groups.length === 0) return { conflicts: [], note: "No overlapping events in this window." };
      return {
        conflicts: groups,
        note: "Each group is a set of events that overlap each other. Reason about which should yield using: explicit priority tags if present, proximity to deadlines/tests/exams (check nearby events or ask the user), and domain importance - then propose a specific resolution (shift to a free slot, or cancel) and get explicit confirmation before calling update_event or delete_event.",
      };
    }
    case "create_event": {
      if (!input.confirmed) {
        const existing = await cal.listEvents(input.start, input.end);
        const conflicts = existing.filter((e) => e.status !== "cancelled");
        if (conflicts.length > 0) {
          return {
            conflict: true,
            conflictingEvents: conflicts.map(simplifyEvent),
            note: "Overlapping event(s) found. Weigh priority/domain/proximity to deadlines and discuss with the user before creating, updating, or deleting anything - see the system prompt's conflict-resolution guidance. If the user wants both kept, call create_event again with confirmed:true.",
          };
        }
      }
      const created = await cal.createEvent(input);
      ctx.onCalendarChanged?.();
      return { created: true, id: created.id, htmlLink: created.htmlLink };
    }
    case "update_event": {
      const updated = await cal.updateEvent(input.eventId, input, input.calendarId || "primary");
      ctx.onCalendarChanged?.();
      return { updated: true, id: updated.id };
    }
    case "delete_event": {
      await cal.deleteEvent(input.eventId, input.calendarId || "primary");
      ctx.onCalendarChanged?.();
      return { deleted: true, id: input.eventId };
    }
    case "start_timer": {
      ctx.onStartTimer?.(input.minutes, input.label || "");
      return { started: true, minutes: input.minutes, label: input.label || "" };
    }
    case "log_health": {
      const date = input.date || todayKey();
      const current = await fb.getHealthLog(ctx.uid, date);
      const patch = {
        water: current.water || 0,
        calories: current.calories || 0,
        proteinG: current.proteinG || 0,
        gymSessions: current.gymSessions || [],
        foodEntries: current.foodEntries || [],
      };
      if (input.waterMl) patch.water += input.waterMl;
      if (input.calories) patch.calories += input.calories;
      if (input.proteinG) patch.proteinG += input.proteinG;
      if (input.gymSession) patch.gymSessions = [...patch.gymSessions, input.gymSession];
      if (input.foodDescription) {
        patch.foodEntries = [
          ...patch.foodEntries,
          { description: input.foodDescription, calories: input.calories || 0, proteinG: input.proteinG || 0, time: new Date().toISOString() },
        ];
      }
      await fb.saveHealthLog(ctx.uid, date, patch);
      ctx.onHealthChanged?.();
      return { date, ...patch };
    }
    case "get_health_log": {
      const log = await fb.getHealthLog(ctx.uid, input.date);
      return { date: input.date, ...log };
    }
    case "set_reminder": {
      const id = await fb.addReminder(ctx.uid, {
        text: input.text,
        fireAt: input.fireAt,
        domain: input.domain || null,
      });
      const apple = await pushAppleReminder(input.text, input.fireAt);
      return { id, ...input, appleReminders: apple.ok ? "synced" : `not synced: ${apple.error}` };
    }
    case "list_reminders": {
      return fb.listReminders(ctx.uid);
    }
    case "delete_reminder": {
      await fb.dismissReminder(ctx.uid, input.id);
      return { deleted: true, id: input.id };
    }
    case "update_profile": {
      const current = await fb.getProfile(ctx.uid);
      const next = { ...current, ...input };
      await fb.saveProfile(ctx.uid, next);
      ctx.onProfileUpdated?.(next);
      return { saved: true, profile: next };
    }
    case "add_task": {
      const priority = input.priority || 3;
      const existing = await fb.listTasks(ctx.uid);
      const order = computeInsertOrder(existing, priority);
      const id = await fb.addTask(ctx.uid, {
        title: input.title,
        domain: input.domain,
        priority,
        order,
        dueDate: input.dueDate || null,
        done: false,
      });
      ctx.onTasksChanged?.();
      return { id, ...input, priority };
    }
    case "list_tasks": {
      return sortByOrder(await fb.listTasks(ctx.uid));
    }
    case "play_alexa_music": {
      const url = import.meta.env.VITE_ALEXA_SHORTCUT_URL;
      if (!url) return { error: "Alexa shortcut URL isn't configured (VITE_ALEXA_SHORTCUT_URL)." };
      // A real new-tab open (not a background fetch/hidden iframe) is what
      // reliably lets iOS hand off to a URL-scheme-based Shortcuts trigger;
      // the tab itself shows nothing to the user either way.
      const win = window.open(url, "_blank", "noopener");
      if (!win) return { error: "Browser blocked opening the shortcut link." };
      setTimeout(() => {
        try {
          win.close();
        } catch {}
      }, 4000);
      return { triggered: true };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
