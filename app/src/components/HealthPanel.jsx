import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/appState.js";
import { getHealthLog, saveHealthLog } from "../lib/firebase.js";
import { estimateNutrition } from "../lib/nutrition.js";
import { fileToBase64 } from "../lib/fileToBase64.js";
import { todayKey } from "../lib/dateKey.js";

export default function HealthPanel() {
  const { user, healthVersion } = useAppState();
  const [log, setLog] = useState({ water: 0, calories: 0, proteinG: 0, gymSessions: [] });
  const [gymType, setGymType] = useState("");
  const [gymMin, setGymMin] = useState(30);

  // Food logging (photo and/or text -> AI estimate -> editable review -> log)
  const [foodText, setFoodText] = useState("");
  const [foodImage, setFoodImage] = useState(null); // { base64, mimeType, previewUrl }
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null); // { description, calories, proteinG, confidence }
  const [foodError, setFoodError] = useState("");
  const foodFileRef = useRef(null);

  const dateKey = todayKey();

  useEffect(() => {
    if (!user) return;
    getHealthLog(user.uid, dateKey).then(setLog);
    // healthVersion: bumped whenever log_health runs from chat/voice, so this
    // reloads without the user needing to leave and reopen the panel.
  }, [user, dateKey, healthVersion]);

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

  async function addProtein(g) {
    const next = { ...log, proteinG: (log.proteinG || 0) + g };
    setLog(next);
    await saveHealthLog(user.uid, dateKey, next);
  }

  function promptAndAdd(question, addFn) {
    const raw = window.prompt(question);
    if (raw === null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    addFn(Math.round(value));
  }

  async function addGym(e) {
    e.preventDefault();
    if (!gymType) return;
    const next = { ...log, gymSessions: [...(log.gymSessions || []), { type: gymType, durationMin: gymMin }] };
    setLog(next);
    await saveHealthLog(user.uid, dateKey, next);
    setGymType("");
  }

  async function handleFoodFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFoodError("");
    try {
      const base64 = await fileToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      setFoodImage({ base64, mimeType: file.type, previewUrl });
    } catch {
      setFoodError("Couldn't read that image.");
    }
  }

  function clearFoodImage() {
    if (foodImage?.previewUrl) URL.revokeObjectURL(foodImage.previewUrl);
    setFoodImage(null);
  }

  async function runEstimate() {
    if (!foodText.trim() && !foodImage) return;
    setEstimating(true);
    setFoodError("");
    setEstimate(null);
    try {
      const result = await estimateNutrition({
        mimeType: foodImage?.mimeType,
        base64: foodImage?.base64,
        text: foodText.trim(),
      });
      setEstimate({
        description: result.description || foodText.trim() || "Food entry",
        calories: Math.round(result.calories) || 0,
        proteinG: Math.round(result.proteinG) || 0,
        confidence: result.confidence || "low",
      });
    } catch (err) {
      setFoodError(err.message || "Couldn't estimate nutrition.");
    } finally {
      setEstimating(false);
    }
  }

  async function confirmLogFood() {
    if (!estimate) return;
    const next = {
      ...log,
      calories: (log.calories || 0) + (estimate.calories || 0),
      proteinG: (log.proteinG || 0) + (estimate.proteinG || 0),
    };
    setLog(next);
    await saveHealthLog(user.uid, dateKey, next);
    cancelFoodEntry();
  }

  function cancelFoodEntry() {
    setEstimate(null);
    setFoodText("");
    clearFoodImage();
    setFoodError("");
  }

  return (
    <div className="panel">
      <div className="section-title">Health</div>

      <div className="small">Water: {log.water || 0} ml</div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button onClick={() => promptAndAdd("Water (ml)?", addWater)}>+ Water</button>
      </div>

      <div className="small">
        Calories: {log.calories || 0} kcal &middot; Protein: {log.proteinG || 0} g
      </div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button onClick={() => promptAndAdd("Calories (kcal)?", addCalories)}>+ Calories</button>
        <button onClick={() => promptAndAdd("Protein (g)?", addProtein)}>+ Protein</button>
      </div>

      <div className="small" style={{ marginBottom: 4 }}>
        Log food (photo and/or description)
      </div>

      {!estimate && (
        <>
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={foodFileRef}
              onChange={handleFoodFile}
              hidden
            />
            <button type="button" onClick={() => foodFileRef.current?.click()}>
              📷 Photo
            </button>
            {foodImage && (
              <>
                <img src={foodImage.previewUrl} alt="food" className="chat-attachment-preview" />
                <button type="button" onClick={clearFoodImage}>
                  Remove
                </button>
              </>
            )}
          </div>
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <input
              placeholder="e.g. dal ka parantha, or 'shared half'"
              value={foodText}
              onChange={(e) => setFoodText(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" onClick={runEstimate} disabled={estimating || (!foodText.trim() && !foodImage)}>
              {estimating ? "Estimating..." : "Estimate"}
            </button>
          </div>
        </>
      )}

      {foodError && (
        <div className="small" style={{ color: "var(--danger)" }}>
          {foodError}
        </div>
      )}

      {estimate && (
        <div className="field" style={{ border: "1px dashed var(--panel-border)", borderRadius: 8, padding: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small">{estimate.description}</span>
            <span className="badge">{estimate.confidence} confidence</span>
          </div>
          <label className="small">Calories (kcal)</label>
          <input
            type="number"
            value={estimate.calories}
            onChange={(e) => setEstimate({ ...estimate, calories: Number(e.target.value) })}
          />
          <label className="small">Protein (g)</label>
          <input
            type="number"
            value={estimate.proteinG}
            onChange={(e) => setEstimate({ ...estimate, proteinG: Number(e.target.value) })}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={confirmLogFood}>
              Log it
            </button>
            <button type="button" onClick={cancelFoodEntry}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="small" style={{ marginTop: 12, marginBottom: 4 }}>
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
