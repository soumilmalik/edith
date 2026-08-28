import React, { useRef, useState } from "react";
import Orb3D from "./Orb3D.jsx";
import Clock from "./Clock.jsx";
import ChatPanel from "./ChatPanel.jsx";
import CalendarView from "./CalendarView.jsx";
import UploadSchedule from "./UploadSchedule.jsx";
import TimerReminderPanel from "./TimerReminderPanel.jsx";
import HealthPanel from "./HealthPanel.jsx";
import DomainSettings from "./DomainSettings.jsx";
import Onboarding from "./Onboarding.jsx";
import { signOutUser } from "../lib/firebase.js";

const TABS = [
  { key: "chat", label: "Edith", icon: "●" },
  { key: "calendar", label: "Calendar", icon: "▦" },
  { key: "health", label: "Health", icon: "✦" },
  { key: "timers", label: "Timers", icon: "⏱" },
  { key: "profile", label: "Profile", icon: "⚙" },
];

export default function MobileLayout() {
  const ampRef = useRef(0);
  const [tab, setTab] = useState("chat");

  return (
    <div className="app-shell mobile-shell">
      <Orb3D ampRef={ampRef} />
      <div className="mobile-layer">
        <Clock compact />

        <div className="mobile-content">
          {tab === "chat" && <ChatPanel ampRef={ampRef} />}
          {tab === "calendar" && (
            <>
              <CalendarView />
              <UploadSchedule />
            </>
          )}
          {tab === "health" && <HealthPanel />}
          {tab === "timers" && <TimerReminderPanel />}
          {tab === "profile" && (
            <>
              <Onboarding />
              <DomainSettings />
              <button onClick={signOutUser}>Sign out</button>
            </>
          )}
        </div>

        <nav className="tab-bar">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="tab-icon">{t.icon}</span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
