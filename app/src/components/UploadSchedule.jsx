import React, { useState } from "react";
import { auth } from "../lib/firebase.js";
import * as cal from "../lib/googleCalendar.js";
import { useAppState } from "../state/appState.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function UploadSchedule() {
  const { domains } = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null); // [{title,start,end,domain}]
  const [creating, setCreating] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setExtracted(null);
    try {
      const base64 = await fileToBase64(file);
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(`${WORKER_URL}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ mimeType: file.type, base64 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setExtracted((data.events || []).map((ev) => ({ ...ev, domain: ev.domain || domains[0] || "" })));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateRow(i, patch) {
    setExtracted((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i) {
    setExtracted((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function confirmAll() {
    setCreating(true);
    setError("");
    try {
      for (const ev of extracted) {
        const conflicts = await cal.listEvents(ev.start, ev.end);
        if (conflicts.length > 0) {
          const names = conflicts.map((c) => c.summary).join(", ");
          if (!window.confirm(`"${ev.title}" overlaps with: ${names}. Create anyway?`)) continue;
        }
        await cal.createEvent(ev);
      }
      setExtracted(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-title">Upload Schedule</div>
      <p className="small">Upload a timetable/schedule image or PDF and Edith will extract events for you to review.</p>
      <input type="file" accept="image/*,application/pdf" onChange={handleFile} disabled={busy} />
      {busy && <div className="small">Reading document...</div>}
      {error && <div className="small" style={{ color: "var(--danger)" }}>{error}</div>}

      {extracted && (
        <div style={{ marginTop: 10 }}>
          {extracted.length === 0 && <div className="small">No events found.</div>}
          {extracted.map((ev, i) => (
            <div className="list-item" key={i}>
              <div style={{ flex: 1 }}>
                <input
                  style={{ width: "100%", marginBottom: 4 }}
                  value={ev.title}
                  onChange={(e) => updateRow(i, { title: e.target.value })}
                />
                <div className="row wrap">
                  <input
                    type="datetime-local"
                    value={ev.start?.slice(0, 16)}
                    onChange={(e) => updateRow(i, { start: e.target.value })}
                  />
                  <input
                    type="datetime-local"
                    value={ev.end?.slice(0, 16)}
                    onChange={(e) => updateRow(i, { end: e.target.value })}
                  />
                  <select value={ev.domain} onChange={(e) => updateRow(i, { domain: e.target.value })}>
                    {domains.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button onClick={() => removeRow(i)}>Remove</button>
            </div>
          ))}
          {extracted.length > 0 && (
            <button onClick={confirmAll} disabled={creating} style={{ marginTop: 8 }}>
              {creating ? "Creating..." : `Add ${extracted.length} event(s) to calendar`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
