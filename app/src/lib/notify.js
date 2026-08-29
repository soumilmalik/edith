function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Fade in/out instead of a hard on/off click - a soft, short chime
    // rather than an alarm-like beep.
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.06, t0 + 0.05);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.3);
    osc.start(t0);
    osc.stop(t0 + 0.3);
    osc.onended = () => ctx.close();
  } catch {
    // ignore if audio isn't available
  }
}

export function notify(title, body) {
  beep();
  // Bare `Notification` throws a ReferenceError on browsers that don't
  // implement it at all (e.g. iOS Safari) - window.Notification is a safe
  // property access instead, so use it everywhere, never the bare global.
  if (window.Notification && window.Notification.permission === "granted") {
    new window.Notification(title, { body });
  }
}
