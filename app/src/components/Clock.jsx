import React, { useEffect, useState } from "react";

export default function Clock({ compact = false }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString(
    [],
    compact
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "long", year: "numeric", month: "long", day: "numeric" }
  );

  return (
    <div className={compact ? "clock-panel clock-compact" : "clock-panel"}>
      <div className="clock-time glow-text">{time}</div>
      <div className="clock-date">{date}</div>
    </div>
  );
}
