import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { watchAuth, isAllowedEmail, getProfile, getDomains, saveProfile, saveDomains } from "../lib/firebase.js";
import { notify } from "../lib/notify.js";

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [authorized, setAuthorized] = useState(false);
  const [profile, setProfile] = useState({ bio: "", decadeGoals: "", yearGoals: "", monthGoals: "", weekGoals: "" });
  const [domains, setDomains] = useState(["Health", "Academics", "Business/Money", "Extracurriculars"]);
  const [loadingData, setLoadingData] = useState(false);

  // Bumped whenever a calendar event is created/edited/deleted from chat or
  // the upload-schedule flow, so CalendarView (a sibling component) knows to
  // reload without the user manually hitting Refresh.
  const [calendarVersion, setCalendarVersion] = useState(0);
  const bumpCalendarRefresh = useCallback(() => setCalendarVersion((v) => v + 1), []);

  // Same idea for health logs: log_health from chat/voice writes straight to
  // Firestore, but HealthPanel only fetches on mount - without this it'd
  // show stale numbers until manually reloaded.
  const [healthVersion, setHealthVersion] = useState(0);
  const bumpHealthRefresh = useCallback(() => setHealthVersion((v) => v + 1), []);

  // Timer lives here (not inside TimerReminderPanel) so: (a) Edith can start
  // one from chat/voice and it's the same timer the panel displays, and (b)
  // it keeps counting even if the panel unmounts (e.g. switching mobile
  // tabs), since it tracks an absolute end time rather than a local interval.
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [timerRemainingMs, setTimerRemainingMs] = useState(null);
  const [timerLabel, setTimerLabel] = useState("");

  useEffect(() => {
    if (!timerEndAt) {
      setTimerRemainingMs(null);
      return;
    }
    const tick = () => {
      const rem = timerEndAt - Date.now();
      if (rem <= 0) {
        setTimerRemainingMs(0);
        setTimerEndAt(null);
        notify("Time's up", timerLabel ? `Timer: ${timerLabel}` : "Your timer finished.");
      } else {
        setTimerRemainingMs(rem);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerEndAt]);

  const startTimer = useCallback((minutes, label = "") => {
    setTimerLabel(label);
    setTimerEndAt(Date.now() + Math.max(1, minutes) * 60 * 1000);
  }, []);

  const cancelTimer = useCallback(() => {
    setTimerEndAt(null);
    setTimerRemainingMs(null);
    setTimerLabel("");
  }, []);

  useEffect(() => {
    return watchAuth(async (u) => {
      setUser(u);
      setAuthorized(isAllowedEmail(u));
      if (u && isAllowedEmail(u)) {
        setLoadingData(true);
        const [p, d] = await Promise.all([getProfile(u.uid), getDomains(u.uid)]);
        setProfile(p);
        setDomains(d);
        setLoadingData(false);
      }
    });
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      if (!user) return;
      const next = { ...profile, ...patch };
      setProfile(next);
      await saveProfile(user.uid, next);
    },
    [user, profile]
  );

  const updateDomains = useCallback(
    async (list) => {
      if (!user) return;
      setDomains(list);
      await saveDomains(user.uid, list);
    },
    [user]
  );

  const value = {
    user,
    authorized,
    profile,
    domains,
    loadingData,
    updateProfile,
    updateDomains,
    setProfileLocal: setProfile,
    calendarVersion,
    bumpCalendarRefresh,
    healthVersion,
    bumpHealthRefresh,
    timerRemainingMs,
    timerLabel,
    startTimer,
    cancelTimer,
  };
  return React.createElement(AppStateContext.Provider, { value }, children);
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
