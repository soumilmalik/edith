import React, { useCallback, useEffect, useState } from "react";
import * as cal from "../lib/googleCalendar.js";
import { useAppState } from "../state/appState.js";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Monday-start of the current calendar week, regardless of what day it is
// today - "this week" should include days that already passed this week.
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diffToMonday);
  return x;
}

function toLocalInput(dt) {
  const d = new Date(dt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyForm = { id: null, title: "", start: "", end: "", domain: "", priority: 3 };

export default function CalendarView() {
  const { domains } = useAppState();
  const [rangeMode, setRangeMode] = useState("week");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  // null = trying a silent restore from a stored refresh token (no popup);
  // false = no stored connection, needs one click; true = ready.
  const [connected, setConnected] = useState(() => (cal.isConnected() ? true : null));
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const now = new Date();
      const min = rangeMode === "week" ? startOfWeek(now) : startOfDay(now);
      const max = new Date(min.getTime() + (rangeMode === "week" ? 7 : 1) * 24 * 60 * 60 * 1000);
      const items = await cal.listEvents(min, max);
      setEvents(items.sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [rangeMode]);

  useEffect(() => {
    if (cal.isConnected()) {
      setConnected(true);
      return;
    }
    let cancelled = false;
    // Safe to auto-run: this only reads a stored refresh token and posts to
    // the Worker, no Google popup involved, so it never gets browser-blocked.
    cal.tryRestoreConnection().then((ok) => {
      if (!cancelled) setConnected(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (connected) load();
  }, [connected, load]);

  async function handleConnectClick() {
    setConnecting(true);
    setError("");
    try {
      await cal.connectCalendar();
      setConnected(true);
    } catch (err) {
      setError(`Couldn't connect: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  }

  function openNew() {
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    setForm({ ...emptyForm, start: toLocalInput(now), end: toLocalInput(in1h), domain: domains[0] || "" });
  }

  function openEdit(e) {
    setForm({
      id: e.id,
      calendarId: e.calendarId || "primary",
      title: e.summary || "",
      start: toLocalInput(e.start?.dateTime || e.start?.date),
      end: toLocalInput(e.end?.dateTime || e.end?.date),
      domain: "",
      priority: 3,
    });
  }

  async function submitForm(ev) {
    ev.preventDefault();
    setError("");
    try {
      if (form.id) {
        await cal.updateEvent(form.id, { title: form.title, start: form.start, end: form.end }, form.calendarId);
      } else {
        const conflicts = await cal.listEvents(form.start, form.end);
        if (conflicts.length > 0) {
          const names = conflicts.map((c) => c.summary).join(", ");
          if (!window.confirm(`This overlaps with: ${names}. Create anyway?`)) return;
        }
        await cal.createEvent(form);
      }
      setForm(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id, calendarId) {
    if (!window.confirm("Delete this event?")) return;
    try {
      await cal.deleteEvent(id, calendarId);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel">
      <div className="section-title">Calendar</div>
      {error && <div className="small" style={{ color: "var(--danger)" }}>{error}</div>}

      {connected === null && <div className="small">Reconnecting to Google Calendar...</div>}

      {connected === false && (
        <div>
          <p className="small">Connect your Google Calendar to see and manage events here.</p>
          <button onClick={handleConnectClick} disabled={connecting}>
            {connecting ? "Connecting..." : "Connect Google Calendar"}
          </button>
        </div>
      )}

      {connected && (
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)}>
            <option value="today">Today</option>
            <option value="week">This week</option>
          </select>
          <button onClick={openNew}>+ New event</button>
          <button onClick={load} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      )}
      {connected && events.length === 0 && !loading && <div className="small">No events.</div>}
      {connected && events.map((e) => (
        <div className="list-item" key={e.id}>
          <div>
            <div>
              {e.summary} {e.calendarName && <span className="badge">{e.calendarName}</span>}
            </div>
            <div className="small">
              {new Date(e.start?.dateTime || e.start?.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="row">
            <button onClick={() => openEdit(e)}>Edit</button>
            <button onClick={() => remove(e.id, e.calendarId)}>Del</button>
          </div>
        </div>
      ))}

      {form && (
        <div className="overlay" onClick={() => setForm(null)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="section-title">{form.id ? "Edit event" : "New event"}</div>
            <form onSubmit={submitForm}>
              <div className="field">
                <label>Title</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="field">
                <label>Start</label>
                <input
                  type="datetime-local"
                  required
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div className="field">
                <label>End</label>
                <input
                  type="datetime-local"
                  required
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
              {!form.id && (
                <>
                  <div className="field">
                    <label>Domain</label>
                    <select value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}>
                      {domains.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Priority (1-5)</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                    />
                  </div>
                </>
              )}
              <div className="row">
                <button type="submit">Save</button>
                <button type="button" onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
