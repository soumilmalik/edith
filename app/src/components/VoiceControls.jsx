import React from "react";
import { IconMic } from "./SmallIcons.jsx";

// A single icon button - normally compact, sitting inline in the chat input
// row, but also used at a larger size on mobile (size="lg"), in its own row
// just above the input rather than replacing the log/input row entirely.
// State (listening/speaking) reads through the glow/pulse alone, so it
// doesn't need a text label to stay legible.
export default function VoiceControls({ listening, speaking, onToggleMic, supported, size = "md" }) {
  const large = size === "lg";
  const iconSize = large ? 32 : 20;
  return (
    <button
      type="button"
      className={`round-btn mic-btn ${large ? "mic-btn-lg" : ""} ${listening ? "listening" : speaking ? "speaking" : ""}`}
      onClick={onToggleMic}
      disabled={!supported}
      title={supported ? "Talk to Edith" : "Voice input not supported in this browser"}
    >
      {listening ? (
        <span
          style={{ width: large ? 16 : 10, height: large ? 16 : 10, borderRadius: "50%", background: "currentColor" }}
        />
      ) : (
        <IconMic width={iconSize} height={iconSize} style={{ margin: 0 }} />
      )}
    </button>
  );
}
