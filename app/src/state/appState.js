import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  watchAuth,
  isAllowedEmail,
  getProfile,
  getDomains,
  saveProfile,
  saveDomains,
  checkRedirectResult,
} from "../lib/firebase.js";

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [authorized, setAuthorized] = useState(false);
  const [profile, setProfile] = useState({ bio: "", decadeGoals: "", yearGoals: "", monthGoals: "", weekGoals: "" });
  const [domains, setDomains] = useState(["Health", "Academics", "Business/Money", "Extracurriculars"]);
  const [loadingData, setLoadingData] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    checkRedirectResult().catch((err) => setAuthError(err.message || String(err)));
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
    authError,
    updateProfile,
    updateDomains,
    setProfileLocal: setProfile,
  };
  return React.createElement(AppStateContext.Provider, { value }, children);
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
