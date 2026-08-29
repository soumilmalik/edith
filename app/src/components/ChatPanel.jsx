import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/appState.js";
import { sendMessage, buildSystemPrompt } from "../lib/claudeClient.js";
import {
  createRecognizer,
  isSpeechRecognitionSupported,
  speakNeural,
  speakBrowser,
  primeVoices,
  createMicAnalyser,
  containsWakePhrase,
} from "../lib/speech.js";
import { auth } from "../lib/firebase.js";
import VoiceControls from "./VoiceControls.jsx";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

export default function ChatPanel({ ampRef }) {
  const { user, profile, domains, setProfileLocal } = useAppState();
  const isNewProfile = !profile.bio && !profile.decadeGoals && !profile.yearGoals;
  const [displayLog, setDisplayLog] = useState([
    {
      role: "assistant",
      text: isNewProfile
        ? "I'm online. I don't know much about you yet - tell me about yourself and your goals whenever you're ready, or fill in the Profile panel directly."
        : "I'm online. How can I help?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [wakeActive, setWakeActive] = useState(false); // background recognizer actually running

  const historyRef = useRef([]);
  const recognizerRef = useRef(null);
  const wakeRecognizerRef = useRef(null);
  const wakeRestartTimeoutRef = useRef(null);
  const analyserRef = useRef(null);
  const logEndRef = useRef(null);
  const speakPulseId = useRef(null);

  // Only one SpeechRecognition session may be alive at a time page-wide;
  // starting a new one before the old one's onend has actually fired throws
  // (silently, since callers didn't await it) and leaves everything stuck.
  // These refs are the single source of truth for transitions - React state
  // below mirrors them purely for rendering, never for control-flow
  // decisions inside recognizer callbacks (which would otherwise close over
  // stale values).
  const modeRef = useRef("idle"); // "idle" | "wake" | "command"
  const wakeEnabledRef = useRef(false);
  const wantCommandAfterStopRef = useRef(false);

  useEffect(() => {
    primeVoices();
  }, []);

  useEffect(() => {
    wakeEnabledRef.current = wakeEnabled;
    if (wakeEnabled) {
      if (modeRef.current === "idle") startWakeListening();
    } else if (modeRef.current === "wake") {
      wakeRecognizerRef.current?.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeEnabled]);

  useEffect(
    () => () => {
      clearTimeout(wakeRestartTimeoutRef.current);
      wakeRecognizerRef.current?.stop();
      recognizerRef.current?.stop();
    },
    []
  );

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLog]);

  // viaVoice: only replies to messages spoken through the mic get spoken
  // back - typed messages always get a text-only reply (saves TTS credits
  // and just makes sense: you typed because you wanted to read, not listen).
  async function handleSend(text, { viaVoice = false } = {}) {
    const trimmed = text.trim();
    if (!trimmed || !user) return;
    setSending(true);
    setDisplayLog((log) => [...log, { role: "user", text: trimmed }]);
    historyRef.current = [...historyRef.current, { role: "user", content: trimmed }];

    try {
      const system = buildSystemPrompt({ profile, domains });
      const { messages, replyText } = await sendMessage({
        messages: historyRef.current,
        system,
        uid: user.uid,
        onProfileUpdated: setProfileLocal,
      });
      historyRef.current = messages;
      const finalText = replyText || "(no reply)";
      setDisplayLog((log) => [...log, { role: "assistant", text: finalText }]);
      if (viaVoice) speakReply(finalText);
    } catch (err) {
      setDisplayLog((log) => [...log, { role: "assistant", text: `Error: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }

  function speakReplyFallback(text) {
    speakBrowser(text, {
      onBoundary: () => {
        if (ampRef) ampRef.current = 0.8;
        clearTimeout(speakPulseId.current);
        speakPulseId.current = setTimeout(() => {
          if (ampRef) ampRef.current = 0.15;
        }, 120);
      },
      onEnd: () => {
        setSpeaking(false);
        if (ampRef) ampRef.current = 0;
      },
    });
  }

  async function speakReply(text) {
    setSpeaking(true);
    const idToken = await auth.currentUser?.getIdToken();
    speakNeural(text, {
      workerUrl: WORKER_URL,
      idToken,
      ampRef,
      onEnd: () => {
        setSpeaking(false);
        if (ampRef) ampRef.current = 0;
      },
      onError: () => speakReplyFallback(text), // e.g. TTS not configured yet
    });
  }

  // Captures one spoken command. Used both by the manual mic button and by
  // wake-word detection - either way, this is what actually sends to Edith.
  // Only call this when modeRef is "idle": if wake is currently running, go
  // through requestCommandListening() instead so we wait for its real stop.
  function startCommandListeningNow() {
    if (!isSpeechRecognitionSupported() || modeRef.current !== "idle") return;

    const recognizer = createRecognizer({
      onStart: async () => {
        modeRef.current = "command";
        setListening(true);
        try {
          analyserRef.current = await createMicAnalyser();
          pumpMicAmplitude();
        } catch {
          // mic permission denied; recognition can still work without the visual amplitude
        }
      },
      onEnd: () => {
        modeRef.current = "idle";
        setListening(false);
        analyserRef.current?.stop();
        analyserRef.current = null;
        if (ampRef) ampRef.current = 0;
        recognizerRef.current = null;
        if (wakeEnabledRef.current) startWakeListening();
      },
      onResult: ({ finalText }) => {
        if (finalText) handleSend(finalText, { viaVoice: true });
      },
    });
    if (!recognizer) return;
    recognizerRef.current = recognizer;
    try {
      recognizer.start();
    } catch {
      recognizerRef.current = null;
      modeRef.current = "idle";
    }
  }

  // Entry point for both the manual mic button and wake-word detection.
  // Safe to call from any mode - if wake is active, stops it first and lets
  // its onEnd hand off to the command recognizer once it's actually gone.
  function requestCommandListening() {
    if (modeRef.current === "command") return;
    if (modeRef.current === "wake") {
      wantCommandAfterStopRef.current = true;
      wakeRecognizerRef.current?.stop();
      return;
    }
    startCommandListeningNow();
  }

  function toggleMic() {
    if (modeRef.current === "command") {
      recognizerRef.current?.stop();
      return;
    }
    requestCommandListening();
  }

  function pumpMicAmplitude() {
    if (!analyserRef.current) return;
    const amp = analyserRef.current.getAmplitude();
    if (ampRef) ampRef.current = amp;
    if (analyserRef.current) requestAnimationFrame(pumpMicAmplitude);
  }

  // Background always-on listener for "hey Edith" / "ok Edith" etc. Runs
  // continuously and restarts itself (browsers stop continuous recognition
  // after periods of silence), except after a fatal permission error or if
  // the user turned the toggle off.
  function startWakeListening() {
    if (!isSpeechRecognitionSupported() || modeRef.current !== "idle" || !wakeEnabledRef.current) return;
    clearTimeout(wakeRestartTimeoutRef.current);

    const recognizer = createRecognizer({
      continuous: true,
      onStart: () => {
        modeRef.current = "wake";
        setWakeActive(true);
      },
      onResult: ({ finalText, interimText }) => {
        if (containsWakePhrase(finalText) || containsWakePhrase(interimText)) {
          wantCommandAfterStopRef.current = true;
          wakeRecognizerRef.current?.stop();
        }
      },
      onError: (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          wakeEnabledRef.current = false;
          setWakeEnabled(false);
        }
      },
      onEnd: () => {
        modeRef.current = "idle";
        setWakeActive(false);
        wakeRecognizerRef.current = null;
        const wantsCommand = wantCommandAfterStopRef.current;
        wantCommandAfterStopRef.current = false;
        if (wantsCommand) {
          startCommandListeningNow();
        } else if (wakeEnabledRef.current) {
          wakeRestartTimeoutRef.current = setTimeout(startWakeListening, 300);
        }
      },
    });
    if (!recognizer) return;
    wakeRecognizerRef.current = recognizer;
    try {
      recognizer.start();
    } catch {
      wakeRecognizerRef.current = null;
      modeRef.current = "idle";
    }
  }

  return (
    <div className="panel chat-panel">
      <div className="section-title">Edith</div>
      <div className="chat-log">
        {displayLog.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
      <VoiceControls
        listening={listening}
        speaking={speaking}
        onToggleMic={toggleMic}
        supported={isSpeechRecognitionSupported()}
        wakeEnabled={wakeEnabled}
        wakeActive={wakeActive}
        onToggleWake={() => setWakeEnabled((v) => !v)}
      />
      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input;
          setInput("");
          handleSend(text);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Talk to Edith..."
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
