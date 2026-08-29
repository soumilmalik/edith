import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/appState.js";
import { listReminders, addReminder, dismissReminder } from "../lib/firebase.js";
import { notify } from "../lib/notify.js";

function fmt(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function TimerReminderPanel() {
  const { user, timerRemainingMs, timerLabel, startTimer, cancelTimer } = useAppState();

  // Stopwatch
  const [swRunning, setSwRunning] = useState(false);
  const [swElapsed, setSwElapsed] = useState(0);
  const swStartRef = useRef(0);
  useEffect(() => {
    if (!swRunning) return;
    swStartRef.current = Date.now() - swElapsed;
    const id = setInterval(() => setSwElapsed(Date.now() - swStartRef.current), 250);
    return () => clearInterval(id);
  }, [swRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer input (the running timer itself lives in appState so chat/voice
  // ("set a timer for 10 minutes") starts the exact same one this shows).
  const [timerInputMin, setTimerInputMin] = useState(5);

  // Reminders
  const [reminders, setReminders] = useState([]);
  const [reminderText, setReminderText] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const firedRef = useRef(new Set());

  const refreshReminders = async () => {
    if (!user) return;
    setReminders(await listReminders(user.uid));
  };

  useEffect(() => {
    if (window.Notification && window.Notification.permission === "default") {
      window.Notification.requestPermission().catch(() => {});
    }
    refreshReminders();
    const id = setInterval(async () => {
      if (!user) return;
      const list = await listReminders(user.uid);
      setReminders(list);
      const now = Date.now();
      for (const r of list) {
        if (!firedRef.current.has(r.id) && new Date(r.fireAt).getTime() <= now) {
          firedRef.current.add(r.id);
          notify("Reminder", r.text);
        }
      }
    }, 15000);
    return () => clearInterval(id);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitReminder(e) {
    e.preventDefault();
    if (!reminderText || !reminderAt || !user) return;
    await addReminder(user.uid, { text: reminderText, fireAt: new Date(reminderAt).toISOString(), domain: null });
    setReminderText("");
    setReminderAt("");
    refreshReminders();
  }

  return (
    <div className="panel">
      <div className="section-title">Timers & Reminders</div>

      <div className="small" style={{ marginBottom: 4 }}>
        Stopwatch
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="glow-text">{fmt(swElapsed)}</div>
        <button onClick={() => setSwRunning((r) => !r)}>{swRunning ? "Pause" : "Start"}</button>
        <button
          onClick={() => {
            setSwRunning(false);
            setSwElapsed(0);
          }}
        >
          Reset
        </button>
      </div>

      <div className="small" style={{ marginBottom: 4 }}>
        Timer
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        {timerRemainingMs === null ? (
          <>
            <input
              type="number"
              min={1}
              style={{ width: 60 }}
              value={timerInputMin}
              onChange={(e) => setTimerInputMin(Number(e.target.value))}
            />
            <span className="small">min</span>
            <button onClick={() => startTimer(timerInputMin)}>Start</button>
          </>
        ) : (
          <>
            <div className="glow-text">{fmt(timerRemainingMs)}</div>
            {timerLabel && <span className="badge">{timerLabel}</span>}
            <button onClick={cancelTimer}>Cancel</button>
          </>
        )}
      </div>

      <div className="small" style={{ marginBottom: 4 }}>
        Reminders
      </div>
      <form className="row wrap" onSubmit={submitReminder} style={{ marginBottom: 8 }}>
        <input placeholder="Remind me to..." value={reminderText} onChange={(e) => setReminderText(e.target.value)} />
        <input type="datetime-local" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} />
        <button type="submit">Add</button>
      </form>
      {reminders.map((r) => (
        <div className="list-item" key={r.id}>
          <div>
            <div>{r.text}</div>
            <div className="small">{new Date(r.fireAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
          </div>
          <button
            onClick={async () => {
              await dismissReminder(user.uid, r.id);
              refreshReminders();
            }}
          >
            Done
          </button>
        </div>
      ))}
    </div>
  );
}
