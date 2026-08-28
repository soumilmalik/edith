import React, { useCallback, useEffect, useState } from "react";
import * as cal from "../lib/googleCalendar.js";
import { useAppState } from "../state/appState.js";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
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
  const [rangeDays, setRangeDays] = useState(1);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const min = startOfDay(new Date());
      const max = new Date(min.getTime() + rangeDays * 24 * 60 * 60 * 1000);
      const items = await cal.listEvents(min, max);
      setEvents(items.sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    setForm({ ...emptyForm, start: toLocalInput(now), end: toLocalInput(in1h), domain: domains[0] || "" });
  }

  function openEdit(e) {
    setForm({
      id: e.id,
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
        await cal.updateEvent(form.id, { title: form.title, start: form.start, end: form.end });
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

  async function remove(id) {
    if (!window.confirm("Delete this event?")) return;
    try {
      await cal.deleteEvent(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel">
      <div className="section-title">Calendar</div>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <select value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}>
          <option value={1}>Today</option>
          <option value={7}>This week</option>
        </select>
        <button onClick={openNew}>+ New event</button>
        <button onClick={load} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      {error && <div className="small" style={{ color: "var(--danger)" }}>{error}</div>}
      {events.length === 0 && !loading && <div className="small">No events.</div>}
      {events.map((e) => (
        <div className="list-item" key={e.id}>
          <div>
            <div>{e.summary}</div>
            <div className="small">
              {new Date(e.start?.dateTime || e.start?.date).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="row">
            <button onClick={() => openEdit(e)}>Edit</button>
            <button onClick={() => remove(e.id)}>Del</button>
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
