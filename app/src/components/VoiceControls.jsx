import React from "react";

export default function VoiceControls({ listening, speaking, onToggleMic, supported }) {
  return (
    <div className="row">
      <button
        className={`mic-btn ${listening ? "listening" : ""}`}
        onClick={onToggleMic}
        disabled={!supported}
        title={supported ? "Talk to Edith" : "Speech recognition not supported in this browser"}
      >
        {listening ? "●" : "🎙"}
      </button>
      <span className="small">{listening ? "Listening..." : "Tap to talk - typed messages stay text-only"}</span>
      {speaking && <span className="badge">speaking</span>}
    </div>
  );
}
