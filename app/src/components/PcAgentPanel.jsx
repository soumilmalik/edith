import React, { useEffect, useState } from "react";
import { getPcState, subscribePc, refreshPcStatus, pairPcAgent, pcSetPaused, forgetPcToken } from "../lib/pcAgent.js";

// Desktop-only control for the optional local PC agent: connect (one click,
// approved on the agent's own page), a pause switch, and disconnect.
export default function PcAgentPanel() {
  const [pc, setPc] = useState(getPcState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribePc(setPc);
    refreshPcStatus(true);
    const id = setInterval(() => refreshPcStatus(true), 15000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  let dot = "var(--danger)";
  let label = "Agent not running on this PC";
  if (pc.reachable && !pc.token) {
    dot = "#f5b301";
    label = "Agent found - not connected";
  } else if (pc.reachable && pc.paused) {
    dot = "#f5b301";
    label = "Paused - Edith can't use your PC";
  } else if (pc.reachable && pc.token) {
    dot = "#2ee66b";
    label = "Connected";
  }

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-title">PC Agent</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, boxShadow: `0 0 8px ${dot}` }} />
        <span className="small">{label}</span>
      </div>
      <div className="row wrap">
        {pc.reachable && !pc.token && (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const ok = await pairPcAgent();
                if (!ok) throw new Error("Not connected - click Allow in the popup.");
              })
            }
          >
            Connect
          </button>
        )}
        {pc.reachable && pc.token && (
          <button disabled={busy} onClick={() => run(() => pcSetPaused(!pc.paused))}>
            {pc.paused ? "Resume" : "Pause"}
          </button>
        )}
        {pc.token && <button onClick={forgetPcToken}>Disconnect</button>}
        {!pc.reachable && (
          <button disabled={busy} onClick={() => run(() => refreshPcStatus(true))}>
            Retry
          </button>
        )}
      </div>
      {error && (
        <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>
          {error}
        </div>
      )}
      {!pc.reachable && (
        <div className="small" style={{ marginTop: 6 }}>
          Start it with <code>node agent.js</code> in <code>C:\Users\ashmi\EdithAgent</code>.
        </div>
      )}
    </div>
  );
}
