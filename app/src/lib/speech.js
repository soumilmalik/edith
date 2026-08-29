// Browser-native voice in/out. No backend calls, no API key.

const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export function isSpeechRecognitionSupported() {
  return !!SpeechRecognitionImpl;
}

export function createRecognizer({ onResult, onEnd, onStart }) {
  if (!SpeechRecognitionImpl) return null;
  const recognizer = new SpeechRecognitionImpl();
  recognizer.continuous = false;
  recognizer.interimResults = true;
  recognizer.lang = "en-US";

  recognizer.onstart = () => onStart?.();
  recognizer.onend = () => onEnd?.();
  recognizer.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    onResult?.({ finalText, interimText });
  };
  return recognizer;
}

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
    const { audioContent } = await res.json();
    if (!audioContent) throw new Error("No audio returned");

    const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mpeg" });
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

// Live mic amplitude (0-1) for driving the orb while listening.
export async function createMicAnalyser() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  function getAmplitude() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    return Math.min(1, avg / 128);
  }

  function stop() {
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close();
  }

  return { getAmplitude, stop };
}
