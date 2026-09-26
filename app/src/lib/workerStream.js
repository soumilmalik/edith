import { auth } from "./firebase.js";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// Parses Anthropic's SSE stream directly (no SDK - the whole Worker/client
// is raw-fetch by design) into the same {content, stop_reason} shape the old
// non-streaming response had, so the tool-loop below barely had to change.
// onTextDelta fires with each new chunk of visible text as it's generated,
// which is what lets the chat bubble grow live instead of appearing all at
// once at the end.
export async function callWorkerStream(body, { onTextDelta } = {}) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`${WORKER_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`Worker /api/chat ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const blocks = [];
  let stopReason = null;

  function handleEvent(evt) {
    switch (evt.type) {
      case "content_block_start": {
        blocks[evt.index] = { ...evt.content_block };
        break;
      }
      case "content_block_delta": {
        const block = blocks[evt.index];
        if (!block) break;
        const delta = evt.delta;
        if (delta.type === "text_delta") {
          block.text = (block.text || "") + delta.text;
          onTextDelta?.(delta.text);
        } else if (delta.type === "input_json_delta") {
          block._rawJson = (block._rawJson || "") + delta.partial_json;
        } else if (delta.type === "thinking_delta") {
          // Extended-thinking blocks stream their content this way, not via
          // text_delta - missing this meant a resent thinking block came
          // back with no actual thinking text, which the API rejects
          // ("each thinking block must contain thinking") on the very next
          // request that includes it in history.
          block.thinking = (block.thinking || "") + delta.thinking;
        } else if (delta.type === "signature_delta") {
          block.signature = (block.signature || "") + delta.signature;
        } else if (delta.type === "citations_delta") {
          block.citations = [...(block.citations || []), delta.citation];
        }
        break;
      }
      case "content_block_stop": {
        const block = blocks[evt.index];
        if (block && block._rawJson !== undefined) {
          try {
            block.input = block._rawJson ? JSON.parse(block._rawJson) : block.input || {};
          } catch {
            block.input = block.input || {};
          }
          delete block._rawJson;
        }
        break;
      }
      case "message_delta": {
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        break;
      }
      case "error":
        throw new Error(evt.error?.message || "Stream error");
      default:
        break;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        handleEvent(JSON.parse(dataLine.slice(5).trim()));
      } catch (err) {
        if (err instanceof SyntaxError) continue; // partial/malformed chunk, skip
        throw err;
      }
    }
  }

  return { content: blocks.filter(Boolean), stop_reason: stopReason };
}

