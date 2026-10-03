/** Read the shared text-delta SSE protocol without treating heartbeats as text. */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  onEvent?: (name: string, data: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    segment = false,
    ended = false;
  const stopped = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", stopped, { once: true });
  const consume = (event: string) => {
    let name = "message";
    const lines: string[] = [];
    for (const line of event.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") name = value;
      if (field === "data") lines.push(value);
    }
    const data = lines.join("\n");
    if (name === "error")
      throw new Error(
        data.trim().slice(0, 1000) ||
          "The selected model failed. Try again or choose another model.",
      );
    if (name === "done") {
      if (data === "cancelled") throw new DOMException("Response stopped.", "AbortError");
      ended = true;
    } else if (name === "seg") segment = !!text;
    else if (name === "jev" || name === "navigate" || name === "info" || name === "action") onEvent?.(name, data);
    else if (name === "chunk" && lines.length) {
      text += (segment && text && !text.endsWith("\n\n") ? "\n\n" : "") + data;
      segment = false;
      onChunk(text);
    }
  };
  try {
    signal?.throwIfAborted();
    while (!ended) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize only complete CRLF pairs; a CR can straddle network chunks.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while (!ended && (boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (buffer.length > 2_000_000)
        throw new Error("The model returned an oversized stream event. Try a shorter answer.");
      if (done) break;
    }
    if (!ended)
      throw new Error(
        "The connection closed before the model finished. Your reply is incomplete; try again.",
      );
    if (!text.trim())
      throw new Error("The model returned no answer. Try again or choose another model.");
    return text.trim();
  } finally {
    signal?.removeEventListener("abort", stopped);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
