import React, { useState } from "react";
import { signInWithGoogle, signOutUser } from "../lib/firebase.js";
import { useAppState } from "../state/appState.js";

export default function Login() {
  const { user, authorized, authError } = useAppState();
  const [clickError, setClickError] = useState("");
  const [clicking, setClicking] = useState(false);

  const notAuthorized = user && !authorized;

  async function handleSignIn() {
    setClicking(true);
    setClickError("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setClickError(`${err.code || ""} ${err.message || String(err)}`.trim());
      setClicking(false);
    }
    // On success this navigates away to Google, so no need to reset clicking.
  }

  const shownError = clickError || authError;

  return (
    <div className="login-screen">
      <div className="login-title glow-text">EDITH</div>
      {notAuthorized ? (
        <>
          <p>This instance is locked to a single account.</p>
          <p className="small">Signed in as {user.email} - not authorized.</p>
          <button onClick={signOutUser}>Sign out</button>
        </>
      ) : (
        <>
          <p className="small">Personal life management system</p>
          <button onClick={handleSignIn} disabled={clicking}>
            {clicking ? "Redirecting..." : "Sign in with Google"}
          </button>
          {shownError && (
            <p className="small" style={{ color: "var(--danger)", maxWidth: 320 }}>
              {shownError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
