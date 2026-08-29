import * as cal from "./googleCalendar.js";
import * as fb from "./firebase.js";
import { pushAppleReminder } from "./appleReminders.js";

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
    name: "create_event",
    description:
      "Create a calendar event. Always call list_events for the same window first if you haven't already this turn, to check for conflicts.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        start: { type: "string", description: "ISO datetime" },
        end: { type: "string", description: "ISO datetime" },
        domain: { type: "string", description: "Life domain this belongs to" },
        priority: { type: "integer", description: "1 (low) to 5 (critical)" },
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
    description: "Log water intake (ml), calories, or a gym session for a given date (defaults to today).",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        waterMl: { type: "integer" },
        calories: { type: "integer" },
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
    description: "Add a standalone task/goal (not tied to a specific calendar time) tagged with a domain and priority.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        domain: { type: "string" },
        priority: { type: "integer" },
        dueDate: { type: "string" },
      },
      required: ["title", "domain"],
    },
  },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

const CALENDAR_TOOLS = new Set(["list_events", "create_event", "update_event", "delete_event"]);

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
      return events.map((e) => ({
        id: e.id,
        calendarId: e.calendarId,
        calendarName: e.calendarName,
        title: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        description: e.description || "",
      }));
    }
    case "create_event": {
      const existing = await cal.listEvents(input.start, input.end);
      const conflicts = existing.filter((e) => e.status !== "cancelled");
      if (conflicts.length > 0) {
        return {
          conflict: true,
          conflictingEvents: conflicts.map((e) => ({
            id: e.id,
            calendarId: e.calendarId,
            title: e.summary,
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
          })),
          note: "Overlapping event(s) found. Discuss priority with the user before creating, updating, or deleting anything.",
        };
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
      const patch = { water: current.water || 0, calories: current.calories || 0, gymSessions: current.gymSessions || [] };
      if (input.waterMl) patch.water += input.waterMl;
      if (input.calories) patch.calories += input.calories;
      if (input.gymSession) patch.gymSessions = [...patch.gymSessions, input.gymSession];
      await fb.saveHealthLog(ctx.uid, date, patch);
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
    case "update_profile": {
      const current = await fb.getProfile(ctx.uid);
      const next = { ...current, ...input };
      await fb.saveProfile(ctx.uid, next);
      ctx.onProfileUpdated?.(next);
      return { saved: true, profile: next };
    }
    case "add_task": {
      const id = await fb.addTask(ctx.uid, {
        title: input.title,
        domain: input.domain,
        priority: input.priority || 3,
        dueDate: input.dueDate || null,
        done: false,
      });
      return { id, ...input };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
