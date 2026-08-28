import React from "react";
import { signInWithGoogle, signOutUser } from "../lib/firebase.js";
import { useAppState } from "../state/appState.js";

export default function Login() {
  const { user, authorized } = useAppState();

  const notAuthorized = user && !authorized;

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
          <button onClick={signInWithGoogle}>Sign in with Google</button>
        </>
      )}
    </div>
  );
}
