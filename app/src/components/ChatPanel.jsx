import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAppState } from "../state/appState.js";
import { sendMessage, buildSystemPrompt } from "../lib/claudeClient.js";
import { speakNeural, speakBrowser, primeVoices, unlockAudio, unlockSpeechSynthesis } from "../lib/speech.js";
import { showDebugError } from "../lib/debugBanner.js";
import { startScribeStream } from "../lib/scribeStream.js";
import { auth } from "../lib/firebase.js";
import { fileToBase64 } from "../lib/fileToBase64.js";
import VoiceControls from "./VoiceControls.jsx";
import { IconAttach } from "./SmallIcons.jsx";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const MIC_SUPPORTED = !!navigator.mediaDevices?.getUserMedia && "WebSocket" in window;

export default function ChatPanel({ ampRef, typeRef }) {
  const { user, profile, domains, setProfileLocal, bumpCalendarRefresh, bumpHealthRefresh, bumpTasksRefresh, startTimer } =
    useAppState();
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
  const [streamingText, setStreamingText] = useState(""); // grows live as the reply streams in; "" while still waiting on the first token
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [micError, setMicError] = useState("");
  const [attachment, setAttachment] = useState(null); // { base64, mimeType, previewUrl, name }
  const [attachError, setAttachError] = useState("");

  const fileInputRef = useRef(null);

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
  }, [displayLog, liveTranscript, streamingText]);

  async function attachFile(file) {
    setAttachError("");
    if (file.size > 5 * 1024 * 1024) {
      setAttachError("That file is too large (max ~5MB - Claude's own per-file limit).");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      const name = file.name || `pasted-image.${(file.type.split("/")[1] || "png").split("+")[0]}`;
      setAttachment({ base64, mimeType: file.type, previewUrl, name });
    } catch {
      setAttachError("Couldn't read that file.");
    }
  }

  function handleAttachFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) attachFile(file);
  }

  // Paste an image straight from the clipboard, like Claude's own chat.
  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          attachFile(file);
        }
        return;
      }
    }
  }

  function clearAttachment() {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
  }

  // viaVoice: only replies to messages spoken through the mic get spoken
  // back - typed messages always get a text-only reply (saves TTS credits
  // and just makes sense: you typed because you wanted to read, not listen).
  async function handleSend(text, { viaVoice = false } = {}) {
    const trimmed = text.trim();
    const att = attachment;
    if (!trimmed && !att) return;
    if (!user) return;
    setSending(true);
    setStreamingText("");

    setDisplayLog((log) => [
      ...log,
      {
        role: "user",
        text: trimmed || (att ? "(sent an attachment)" : ""),
        imagePreviewUrl: att?.previewUrl || null,
        attachmentName: att && !att.previewUrl ? att.name : null,
      },
    ]);

    const content = att
      ? [
          att.mimeType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: att.base64 } }
            : { type: "image", source: { type: "base64", media_type: att.mimeType, data: att.base64 } },
          { type: "text", text: trimmed || "What's in this?" },
        ]
      : trimmed;
    historyRef.current = [...historyRef.current, { role: "user", content }];
    // Don't revoke the preview URL here (unlike the explicit "Remove"
    // button) - the chat log entry above just started using that exact same
    // URL for its thumbnail, and revoking it immediately broke that image.
    setAttachment(null);

    try {
      const system = buildSystemPrompt({ profile, domains });
      const { messages, replyText } = await sendMessage({
        messages: historyRef.current,
        system,
        uid: user.uid,
        toolCtx: {
          onProfileUpdated: setProfileLocal,
          onCalendarChanged: bumpCalendarRefresh,
          onHealthChanged: bumpHealthRefresh,
          onTasksChanged: bumpTasksRefresh,
          onStartTimer: startTimer,
        },
        onTextUpdate: setStreamingText,
      });
      historyRef.current = messages;
      const finalText = replyText || "(no reply)";
      setDisplayLog((log) => [...log, { role: "assistant", text: finalText }]);
      if (viaVoice) speakReply(finalText);
    } catch (err) {
      setDisplayLog((log) => [...log, { role: "assistant", text: `Error: ${err.message}` }]);
    } finally {
      setSending(false);
      setStreamingText("");
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
      onError: (err) => {
        // Falls back to the free browser voice. "google_tts_not_configured"
        // is a known, expected state (no Google TTS API key set yet) - stay
        // quiet for that one so every single reply doesn't throw up an
        // alarming banner; still surface anything genuinely unexpected
        // loudly, since that's the only way to diagnose it without live
        // devtools.
        const message = err?.message || String(err);
        if (!message.includes("google_tts_not_configured")) {
          showDebugError(`Neural voice failed, used browser fallback: ${message}`);
        }
        speakReplyFallback(text);
      },
    });
  }

  async function toggleMic() {
    if (listening) {
      scribeRef.current?.stop();
      return;
    }

    // Must run synchronously inside this click handler (before any await) so
    // it still carries the tap's user-activation - this is what lets the TTS
    // reply play later, after the async round-trip to Claude, without iOS
    // Safari's autoplay policy silently blocking it. Covers both the neural
    // voice (AudioContext) and the browser-voice fallback (SpeechSynthesis) -
    // two separate APIs, each needing their own unlock.
    unlockAudio();
    unlockSpeechSynthesis();

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
            {m.imagePreviewUrl && <img src={m.imagePreviewUrl} alt="attachment" className="chat-attachment-img" />}
            {m.attachmentName && <div className="badge">{m.attachmentName}</div>}
            {m.role === "assistant" ? (
              <div className="chat-markdown">
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
            ) : (
              m.text
            )}
          </div>
        ))}
        {sending && (
          <div className="chat-msg assistant streaming">
            {streamingText ? (
              <div className="chat-markdown">
                <ReactMarkdown>{streamingText}</ReactMarkdown>
              </div>
            ) : (
              "Thinking..."
            )}
          </div>
        )}
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
      {attachError && (
        <div className="small" style={{ color: "var(--danger)" }}>
          {attachError}
        </div>
      )}
      {attachment && (
        <div className="row" style={{ marginBottom: 6 }}>
          {attachment.previewUrl ? (
            <img src={attachment.previewUrl} alt="attachment preview" className="chat-attachment-preview" />
          ) : (
            <span className="badge">{attachment.name}</span>
          )}
          <button type="button" onClick={clearAttachment}>
            Remove
          </button>
        </div>
      )}
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
          type="file"
          accept="image/*,application/pdf"
          ref={fileInputRef}
          onChange={handleAttachFile}
          hidden
        />
        <VoiceControls listening={listening} speaking={speaking} onToggleMic={toggleMic} supported={MIC_SUPPORTED} />
        <button
          type="button"
          className="round-btn"
          title="Attach an image or PDF (like a syllabus)"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
        >
          <IconAttach style={{ margin: 0 }} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={() => {
            if (typeRef) typeRef.current += 1;
          }}
          onPaste={handlePaste}
          placeholder="Talk to Edith... (paste an image too)"
          disabled={sending}
        />
        <button type="submit" disabled={sending || (!input.trim() && !attachment)}>
          Send
        </button>
      </form>
    </div>
  );
}
