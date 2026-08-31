// Local-timezone YYYY-MM-DD, so a day's health log rolls over at local
// midnight. (toISOString() is UTC-based - in IST that rolled logs over at
// 5:30am instead of midnight, which is the bug this replaces.)
export function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
