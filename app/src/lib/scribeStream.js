// Realtime speech-to-text via ElevenLabs Scribe (WebSocket), replacing the
// unreliable browser-native SpeechRecognition. Gets a short-lived single-use
// token from the Worker (the permanent API key never reaches the browser),
// streams mic audio as PCM16, and surfaces live partial + committed
// (punctuated) transcript text as it arrives.

function downsampleTo16k(float32, inRate) {
  if (inRate === 16000) return float32;
  const ratio = inRate / 16000;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    out[i] = float32[Math.floor(i * ratio)] || 0;
  }
  return out;
}

function floatTo16BitPCMBytes(float32) {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function startScribeStream({
  workerUrl,
  idToken,
  ampRef,
  onPartial,
  onCommitted,
  onOpen,
  onError,
  onClose,
}) {
  const tokenRes = await fetch(`${workerUrl}/api/stt/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!tokenRes.ok) throw new Error(await tokenRes.text());
  const tokenData = await tokenRes.json();
  const token = tokenData.token || tokenData.value || tokenData.single_use_token;
  if (!token) throw new Error("No single-use token returned");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${encodeURIComponent(token)}&model_id=scribe_v2_realtime`
  );

  let audioCtx = null;
  let source = null;
  let processor = null;
  let silentGain = null;
  let stopped = false;

  function cleanupAudio() {
    try {
      processor?.disconnect();
    } catch {}
    try {
      source?.disconnect();
    } catch {}
    try {
      silentGain?.disconnect();
    } catch {}
    try {
      audioCtx?.close();
    } catch {}
    stream.getTracks().forEach((t) => t.stop());
  }

  ws.onopen = () => {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessorNode only fires onaudioprocess while connected through
    // to a destination in some browsers; route through a muted gain node so
    // nothing is actually played back (avoids mic echo through speakers).
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      // Drive the orb from the same mic signal, like the old analyser did.
      if (ampRef) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        ampRef.current = Math.min(1, Math.sqrt(sum / input.length) * 6);
      }

      const down = downsampleTo16k(input, audioCtx.sampleRate);
      const pcmBytes = floatTo16BitPCMBytes(down);
      ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: bytesToBase64(pcmBytes),
          sample_rate: 16000,
        })
      );
    };

    onOpen?.();
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.message_type === "partial_transcript") onPartial?.(msg.text || "");
    else if (msg.message_type === "committed_transcript") onCommitted?.(msg.text || "");
  };

  ws.onerror = (e) => onError?.(e);
  ws.onclose = () => {
    cleanupAudio();
    if (ampRef) ampRef.current = 0;
    onClose?.();
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true }));
      }
    } catch {}
    // Give the server a moment to flush a final committed_transcript before closing.
    setTimeout(() => {
      try {
        ws.close();
      } catch {}
    }, 500);
  }

  return { stop };
}
