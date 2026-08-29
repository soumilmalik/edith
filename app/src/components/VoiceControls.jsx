import React from "react";

export default function VoiceControls({
  listening,
  speaking,
  onToggleMic,
  supported,
  wakeEnabled,
  wakeActive,
  onToggleWake,
}) {
  return (
    <div className="row wrap">
      <button
        className={`mic-btn ${listening ? "listening" : ""}`}
        onClick={onToggleMic}
        disabled={!supported}
        title={supported ? "Talk to Edith" : "Speech recognition not supported in this browser"}
      >
        {listening ? "●" : "🎙"}
      </button>
      <label className="small row" style={{ cursor: supported ? "pointer" : "not-allowed" }}>
        <input
          type="checkbox"
          checked={wakeEnabled}
          onChange={onToggleWake}
          disabled={!supported}
          style={{ width: "auto" }}
        />
        "Hey Edith"
        {wakeEnabled && <span className="badge">{wakeActive ? "listening" : "reconnecting..."}</span>}
      </label>
      {speaking && <span className="badge">speaking</span>}
    </div>
  );
}
