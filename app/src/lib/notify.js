function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
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
