import React from "react";
import { IconMic } from "./SmallIcons.jsx";

// A single compact icon button, meant to sit inline in the chat input row
// rather than its own labeled row - state (listening/speaking) reads through
// the glow/pulse alone, so it doesn't need a text label to stay legible.
export default function VoiceControls({ listening, speaking, onToggleMic, supported }) {
  return (
    <button
      type="button"
      className={`round-btn mic-btn ${listening ? "listening" : speaking ? "speaking" : ""}`}
      onClick={onToggleMic}
      disabled={!supported}
      title={supported ? "Talk to Edith" : "Voice input not supported in this browser"}
    >
      {listening ? (
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "currentColor" }} />
      ) : (
        <IconMic width={20} height={20} style={{ margin: 0 }} />
      )}
    </button>
  );
}
