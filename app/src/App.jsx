import React, { useEffect, useRef, useState } from "react";
import { AppStateProvider, useAppState } from "./state/appState.js";
import Login from "./components/Login.jsx";
import Clock from "./components/Clock.jsx";
import Orb3D from "./components/Orb3D.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import CalendarView from "./components/CalendarView.jsx";
import TimerReminderPanel from "./components/TimerReminderPanel.jsx";
import HealthPanel from "./components/HealthPanel.jsx";
import DomainSettings from "./components/DomainSettings.jsx";
import Onboarding from "./components/Onboarding.jsx";
import UploadSchedule from "./components/UploadSchedule.jsx";
import MobileLayout from "./components/MobileLayout.jsx";
import { signOutUser } from "./lib/firebase.js";
import { useIsMobile } from "./lib/useIsMobile.js";

function DesktopDashboard() {
  const ampRef = useRef(0);

  return (
    <div className="app-shell">
      <Orb3D ampRef={ampRef} />
      <div className="hud-layer">
        <div className="left-col">
          <CalendarView />
          <UploadSchedule />
        </div>

        <Clock />

        <div className="right-col">
          <HealthPanel />
          <TimerReminderPanel />
          <Onboarding />
          <DomainSettings />
          <button onClick={signOutUser}>Sign out</button>
        </div>

        <ChatPanel ampRef={ampRef} />
      </div>
    </div>
  );
}

function Dashboard() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileLayout /> : <DesktopDashboard />;
}

function Gate() {
  const { user, authorized, loadingData } = useAppState();
  // "loading" (red) -> "online" (blue, brief "EDITH ONLINE") -> "done" (dashboard)
  const [bootPhase, setBootPhase] = useState("loading");
  const transitionedRef = useRef(false);

  const isReady = user && authorized && !loadingData;

  // Deliberately depends only on isReady, not bootPhase: setting bootPhase
  // inside this effect while also listing it as a dependency caused the
  // effect to immediately re-run and its cleanup to cancel the very timer it
  // had just started, before the 900ms ever elapsed - stuck on "online"
  // forever. transitionedRef (not state) guards against re-entering.
  useEffect(() => {
    if (isReady && !transitionedRef.current) {
      transitionedRef.current = true;
      setBootPhase("online");
      const t = setTimeout(() => setBootPhase("done"), 900);
      return () => clearTimeout(t);
    }
  }, [isReady]);

  if (user === undefined) {
    return <div className="login-screen glow-text theme-red">EDITH BOOTING...</div>;
  }
  if (!user || !authorized) {
    return <Login />;
  }
  if (!isReady || bootPhase === "loading") {
    return <div className="login-screen glow-text theme-red">EDITH BOOTING...</div>;
  }
  if (bootPhase === "online") {
    return <div className="login-screen glow-text">EDITH ONLINE</div>;
  }
  return <Dashboard />;
}

export default function App() {
  return (
    <AppStateProvider>
      <Gate />
    </AppStateProvider>
  );
}
