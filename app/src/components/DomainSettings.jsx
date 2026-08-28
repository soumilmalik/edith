import React, { useState } from "react";
import { useAppState } from "../state/appState.js";

export default function DomainSettings() {
  const { domains, updateDomains } = useAppState();
  const [newDomain, setNewDomain] = useState("");

  function add(e) {
    e.preventDefault();
    const name = newDomain.trim();
    if (!name || domains.includes(name)) return;
    updateDomains([...domains, name]);
    setNewDomain("");
  }

  function remove(name) {
    if (!window.confirm(`Remove domain "${name}"?`)) return;
    updateDomains(domains.filter((d) => d !== name));
  }

  function rename(oldName) {
    const next = window.prompt("Rename domain", oldName);
    if (!next || next === oldName) return;
    updateDomains(domains.map((d) => (d === oldName ? next : d)));
  }

  return (
    <div className="panel">
      <div className="section-title">Life Domains</div>
      {domains.map((d) => (
        <div className="list-item" key={d}>
          <span>{d}</span>
          <div className="row">
            <button onClick={() => rename(d)}>Rename</button>
            <button onClick={() => remove(d)}>Del</button>
          </div>
        </div>
      ))}
      <form className="row" onSubmit={add} style={{ marginTop: 8 }}>
        <input placeholder="New domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
