// Voice out (TTS). Voice in now lives in scribeStream.js (ElevenLabs
// realtime STT) - the browser's native SpeechRecognition proved unreliable
// (e.g. blocked/crippled by Brave's shields) and had no punctuation.

let cachedVoice = null;
function pickFemaleVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis?.getVoices() || [];
  const preferred =
    voices.find((v) => /female/i.test(v.name)) ||
    voices.find((v) => /Samantha|Zira|Google UK English Female|Victoria/i.test(v.name)) ||
    voices.find((v) => v.lang?.startsWith("en")) ||
    voices[0];
  cachedVoice = preferred || null;
  return cachedVoice;
}

// Voices load async in some browsers; call this once on app start.
export function primeVoices() {
  window.speechSynthesis?.getVoices();
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
    cachedVoice = null;
    pickFemaleVoice();
  });
}

// Fallback: the free browser voice. Used only if the Neural2 call fails.
export function speakBrowser(text, { onBoundary, onEnd } = {}) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickFemaleVoice();
  if (voice) utterance.voice = voice;
  utterance.pitch = 1.05;
  utterance.rate = 1.02;
  utterance.onboundary = () => onBoundary?.();
  utterance.onend = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

let currentAudio = null;
let currentAudioCtx = null;

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentAudioCtx) {
    currentAudioCtx.close().catch(() => {});
    currentAudioCtx = null;
  }
}

// Google Cloud Neural2 voice via the Worker's /api/tts. ampRef gets driven
// by the *actual* playing audio's amplitude (not a synthetic pulse), so the
// orb reacts to the real cadence of the voice.
export async function speakNeural(text, { workerUrl, idToken, ampRef, onStart, onEnd, onError } = {}) {
  stopSpeaking();
  try {
    const res = await fetch(`${workerUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    if (!blob.size) throw new Error("No audio returned");
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    currentAudioCtx = audioCtx;
    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function pump() {
      if (audio !== currentAudio) return; // superseded by a newer call
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      if (ampRef) ampRef.current = Math.min(1, avg / 100);
      if (!audio.paused && !audio.ended) requestAnimationFrame(pump);
    }

    audio.onended = () => {
      if (ampRef) ampRef.current = 0;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      if (currentAudioCtx === audioCtx) currentAudioCtx = null;
      audioCtx.close().catch(() => {});
      onEnd?.();
    };

    onStart?.();
    await audio.play();
    pump();
  } catch (err) {
    onError?.(err);
  }
}
