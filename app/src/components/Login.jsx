import React, { useEffect, useRef, useState } from "react";
import { signInWithGoogleIdToken, signOutUser } from "../lib/firebase.js";
import { useAppState } from "../state/appState.js";
import Orb3D from "./Orb3D.jsx";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function Login() {
  const { user, authorized } = useAppState();
  const [error, setError] = useState("");
  const buttonRef = useRef(null);
  const ampRef = useRef(0);

  const notAuthorized = user && !authorized;

  useEffect(() => {
    if (notAuthorized) return; // nothing to render, showing the sign-out screen instead

    let cancelled = false;
    let attempts = 0;

    function tryRender() {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        // The GIS script (loaded via <script> in index.html) may not be ready yet.
        if (attempts++ < 50) setTimeout(tryRender, 100);
        else setError("Couldn't load Google Sign-In. Check your connection and reload.");
        return;
      }
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async (response) => {
          try {
            await signInWithGoogleIdToken(response.credential);
          } catch (err) {
            setError(`${err.code || ""} ${err.message || String(err)}`.trim());
          }
        },
      });
      if (buttonRef.current) {
        buttonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "filled_black",
          shape: "pill",
          size: "large",
          text: "signin_with",
        });
      }
    }

    tryRender();
    return () => {
      cancelled = true;
    };
  }, [notAuthorized]);

  return (
    <div className="app-shell">
      <Orb3D ampRef={ampRef} />
      <div className="login-screen">
        <div className="login-title glow-text login-reveal" style={{ "--d": "0.05s" }}>
          EDITH
        </div>
        {notAuthorized ? (
          <>
            <p className="login-reveal" style={{ "--d": "0.2s" }}>
              This instance is locked to a single account.
            </p>
            <p className="small login-reveal" style={{ "--d": "0.3s" }}>
              Signed in as {user.email} - not authorized.
            </p>
            <button className="login-reveal" style={{ "--d": "0.4s" }} onClick={signOutUser}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="small login-tagline login-reveal" style={{ "--d": "0.2s" }}>
              Personal life management system
            </p>
            <div ref={buttonRef} className="login-reveal" style={{ "--d": "0.35s" }} />
            {error && (
              <p className="small login-reveal" style={{ "--d": "0.35s", color: "var(--danger)", maxWidth: 320 }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
