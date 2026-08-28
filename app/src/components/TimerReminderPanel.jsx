import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/appState.js";
import { listReminders, addReminder, dismissReminder } from "../lib/firebase.js";

function fmt(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // ignore if audio isn't available
  }
}

function notify(title, body) {
  beep();
  // Bare `Notification` throws a ReferenceError on browsers that don't
  // implement it at all (e.g. iOS Safari) - window.Notification is a safe
  // property access instead, so use it everywhere, never the bare global.
  if (window.Notification && window.Notification.permission === "granted") {
    new window.Notification(title, { body });
  }
}

export default function TimerReminderPanel() {
  const { user } = useAppState();

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

  // Timer
  const [timerInputMin, setTimerInputMin] = useState(5);
  const [timerRemaining, setTimerRemaining] = useState(null); // ms
  useEffect(() => {
    if (timerRemaining === null) return;
    if (timerRemaining <= 0) {
      notify("Time's up", "Your timer finished.");
      setTimerRemaining(null);
      return;
    }
    const id = setTimeout(() => setTimerRemaining((r) => r - 1000), 1000);
    return () => clearTimeout(id);
  }, [timerRemaining]);

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
        {timerRemaining === null ? (
          <>
            <input
              type="number"
              min={1}
              style={{ width: 60 }}
              value={timerInputMin}
              onChange={(e) => setTimerInputMin(Number(e.target.value))}
            />
            <span className="small">min</span>
            <button onClick={() => setTimerRemaining(timerInputMin * 60 * 1000)}>Start</button>
          </>
        ) : (
          <>
            <div className="glow-text">{fmt(timerRemaining)}</div>
            <button onClick={() => setTimerRemaining(null)}>Cancel</button>
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
            <div className="small">{new Date(r.fireAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
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
