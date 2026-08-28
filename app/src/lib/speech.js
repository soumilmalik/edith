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

export function speak(text, { onBoundary, onEnd } = {}) {
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

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
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
