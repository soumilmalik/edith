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

  const historyRef = useRef([]);
  const recognizerRef = useRef(null);
  const analyserRef = useRef(null);
  const logEndRef = useRef(null);
  const speakPulseId = useRef(null);

  useEffect(() => {
    primeVoices();
  }, []);

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

  async function toggleMic() {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    if (!isSpeechRecognitionSupported()) return;

    const recognizer = createRecognizer({
      onStart: async () => {
        setListening(true);
        try {
          analyserRef.current = await createMicAnalyser();
          pumpMicAmplitude();
        } catch {
          // mic permission denied; recognition can still work without the visual amplitude
        }
      },
      onEnd: () => {
        setListening(false);
        analyserRef.current?.stop();
        analyserRef.current = null;
        if (ampRef) ampRef.current = 0;
      },
      onResult: ({ finalText }) => {
        if (finalText) handleSend(finalText, { viaVoice: true });
      },
    });
    recognizerRef.current = recognizer;
    recognizer.start();
  }

  function pumpMicAmplitude() {
    if (!analyserRef.current) return;
    const amp = analyserRef.current.getAmplitude();
    if (ampRef) ampRef.current = amp;
    if (analyserRef.current) requestAnimationFrame(pumpMicAmplitude);
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
