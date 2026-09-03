import React, { useRef, useState } from "react";
import Orb3D from "./Orb3D.jsx";
import Clock from "./Clock.jsx";
import ChatPanel from "./ChatPanel.jsx";
import CalendarView from "./CalendarView.jsx";
import UploadSchedule from "./UploadSchedule.jsx";
import TimerReminderPanel from "./TimerReminderPanel.jsx";
import HealthPanel from "./HealthPanel.jsx";
import TaskList from "./TaskList.jsx";
import DomainSettings from "./DomainSettings.jsx";
import Onboarding from "./Onboarding.jsx";
import { ChatIcon, CalendarIcon, TaskIcon, HealthIcon, TimerIcon, ProfileIcon } from "./Icons.jsx";
import { signOutUser } from "../lib/firebase.js";

const TABS = [
  { key: "chat", label: "Edith", Icon: ChatIcon },
  { key: "tasks", label: "Tasks", Icon: TaskIcon },
  { key: "calendar", label: "Calendar", Icon: CalendarIcon },
  { key: "health", label: "Health", Icon: HealthIcon },
  { key: "timers", label: "Timers", Icon: TimerIcon },
  { key: "profile", label: "Profile", Icon: ProfileIcon },
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
          {tab === "tasks" && <TaskList />}
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
              <t.Icon className="tab-icon" />
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
