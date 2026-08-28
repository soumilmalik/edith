import React from "react";

export default function VoiceControls({ listening, speaking, onToggleMic, voiceRepliesOn, onToggleVoiceReplies, supported }) {
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
      <label className="small row">
        <input type="checkbox" checked={voiceRepliesOn} onChange={onToggleVoiceReplies} style={{ width: "auto" }} />
        Voice replies
      </label>
      {speaking && <span className="badge">speaking</span>}
    </div>
  );
}
