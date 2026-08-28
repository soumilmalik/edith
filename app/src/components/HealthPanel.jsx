import React, { useEffect, useState } from "react";
import { useAppState } from "../state/appState.js";
import { getHealthLog, saveHealthLog } from "../lib/firebase.js";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function HealthPanel() {
  const { user } = useAppState();
  const [log, setLog] = useState({ water: 0, calories: 0, gymSessions: [] });
  const [gymType, setGymType] = useState("");
  const [gymMin, setGymMin] = useState(30);

  const dateKey = todayKey();

  useEffect(() => {
    if (!user) return;
    getHealthLog(user.uid, dateKey).then(setLog);
  }, [user, dateKey]);

  async function addWater(ml) {
    const next = { ...log, water: (log.water || 0) + ml };
    setLog(next);
    await saveHealthLog(user.uid, dateKey, next);
  }

  async function addCalories(kcal) {
    const next = { ...log, calories: (log.calories || 0) + kcal };
    setLog(next);
    await saveHealthLog(user.uid, dateKey, next);
  }

  async function addGym(e) {
    e.preventDefault();
    if (!gymType) return;
    const next = { ...log, gymSessions: [...(log.gymSessions || []), { type: gymType, durationMin: gymMin }] };
    setLog(next);
    await saveHealthLog(user.uid, dateKey, next);
    setGymType("");
  }

  return (
    <div className="panel">
      <div className="section-title">Health</div>

      <div className="small">Water: {log.water || 0} ml</div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button onClick={() => addWater(250)}>+250ml</button>
        <button onClick={() => addWater(500)}>+500ml</button>
      </div>

      <div className="small">Calories: {log.calories || 0} kcal</div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button onClick={() => addCalories(200)}>+200</button>
        <button onClick={() => addCalories(500)}>+500</button>
      </div>

      <div className="small" style={{ marginBottom: 4 }}>
        Gym sessions today
      </div>
      {(log.gymSessions || []).map((g, i) => (
        <div className="list-item" key={i}>
          <span>{g.type}</span>
          <span className="badge">{g.durationMin} min</span>
        </div>
      ))}
      <form className="row wrap" onSubmit={addGym} style={{ marginTop: 8 }}>
        <input placeholder="e.g. Legs" value={gymType} onChange={(e) => setGymType(e.target.value)} style={{ width: 90 }} />
        <input type="number" min={1} value={gymMin} onChange={(e) => setGymMin(Number(e.target.value))} style={{ width: 60 }} />
        <span className="small">min</span>
        <button type="submit">Log</button>
      </form>
    </div>
  );
}
