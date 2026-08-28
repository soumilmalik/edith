import React, { useEffect, useState } from "react";
import { useAppState } from "../state/appState.js";

export default function Onboarding() {
  const { profile, updateProfile } = useAppState();
  const [form, setForm] = useState(profile);
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(profile), [profile]);

  async function save(e) {
    e.preventDefault();
    await updateProfile(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="panel">
      <div className="section-title">Profile & Goals</div>
      <p className="small">
        Edith uses this for every conversation. Fill it in here, or just tell Edith about yourself in
        chat/voice and she'll save it as you go.
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label>Bio / background</label>
          <textarea rows={3} value={form.bio || ""} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </div>
        <div className="field">
          <label>Decade goals</label>
          <textarea rows={2} value={form.decadeGoals || ""} onChange={(e) => setForm({ ...form, decadeGoals: e.target.value })} />
        </div>
        <div className="field">
          <label>This year's goals</label>
          <textarea rows={2} value={form.yearGoals || ""} onChange={(e) => setForm({ ...form, yearGoals: e.target.value })} />
        </div>
        <div className="field">
          <label>This month's goals</label>
          <textarea rows={2} value={form.monthGoals || ""} onChange={(e) => setForm({ ...form, monthGoals: e.target.value })} />
        </div>
        <div className="field">
          <label>This week's goals</label>
          <textarea rows={2} value={form.weekGoals || ""} onChange={(e) => setForm({ ...form, weekGoals: e.target.value })} />
        </div>
        <button type="submit">{saved ? "Saved" : "Save"}</button>
      </form>
    </div>
  );
}
