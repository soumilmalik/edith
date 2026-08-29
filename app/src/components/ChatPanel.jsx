import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/appState.js";
import { sendMessage, buildSystemPrompt } from "../lib/claudeClient.js";
import { speakNeural, speakBrowser, primeVoices } from "../lib/speech.js";
import { startScribeStream } from "../lib/scribeStream.js";
import { auth } from "../lib/firebase.js";
import VoiceControls from "./VoiceControls.jsx";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const MIC_SUPPORTED = !!navigator.mediaDevices?.getUserMedia && "WebSocket" in window;

export default function ChatPanel({ ampRef }) {
  const { user, profile, domains, setProfileLocal, bumpCalendarRefresh, startTimer } = useAppState();
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
  const [liveTranscript, setLiveTranscript] = useState("");
  const [micError, setMicError] = useState("");

  const historyRef = useRef([]);
  const scribeRef = useRef(null);
  const committedRef = useRef(""); // stable, punctuated text confirmed so far
  const partialRef = useRef(""); // live, still-changing tail
  const logEndRef = useRef(null);
  const speakPulseId = useRef(null);

  useEffect(() => {
    primeVoices();
  }, []);

  useEffect(() => () => scribeRef.current?.stop(), []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLog, liveTranscript]);

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
        toolCtx: {
          onProfileUpdated: setProfileLocal,
          onCalendarChanged: bumpCalendarRefresh,
          onStartTimer: startTimer,
        },
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

  async function toggleMic() {
    if (listening) {
      scribeRef.current?.stop();
      return;
    }

    setMicError("");
    committedRef.current = "";
    partialRef.current = "";
    setLiveTranscript("");

    try {
      const idToken = await auth.currentUser?.getIdToken();
      const controller = await startScribeStream({
        workerUrl: WORKER_URL,
        idToken,
        ampRef,
        onOpen: () => setListening(true),
        onPartial: (text) => {
          partialRef.current = text;
          setLiveTranscript(`${committedRef.current} ${partialRef.current}`.trim());
        },
        onCommitted: (text) => {
          committedRef.current = `${committedRef.current} ${text}`.trim();
          partialRef.current = "";
          setLiveTranscript(committedRef.current);
        },
        onError: () => setMicError("Voice input hit an error - check your connection and try again."),
        onClose: () => {
          setListening(false);
          scribeRef.current = null;
          const finalText = committedRef.current.trim();
          setLiveTranscript("");
          if (finalText) handleSend(finalText, { viaVoice: true });
        },
      });
      scribeRef.current = controller;
    } catch (err) {
      setMicError(err.message || "Couldn't start voice input.");
      setListening(false);
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
        {listening && (
          <div className="chat-msg user live-transcript">{liveTranscript || "Listening..."}</div>
        )}
        <div ref={logEndRef} />
      </div>
      {micError && (
        <div className="small" style={{ color: "var(--danger)" }}>
          {micError}
        </div>
      )}
      <VoiceControls listening={listening} speaking={speaking} onToggleMic={toggleMic} supported={MIC_SUPPORTED} />
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
