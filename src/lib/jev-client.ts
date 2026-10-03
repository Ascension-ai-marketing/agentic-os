import type { JevDecision } from "./jev-types";

export async function jevFetch(path: string, init: RequestInit = {}) {
  const tokenResponse = await fetch("/__token", { signal: init.signal });
  if (!tokenResponse.ok) throw new Error("Local workspace unavailable");
  const { token } = await tokenResponse.json();
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init.headers, "x-claude-os-token": token } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Request failed (${response.status})`);
  return response;
}
/** Native EventSource cannot send the workspace token header. Use fetch streaming. */
export async function streamJev(onDecision: (d: JevDecision) => void, signal: AbortSignal) {
  const response = await jevFetch("/__jev/stream", { signal });
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let pending = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read(); if (done) break;
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const event = pending.slice(0, end); pending = pending.slice(end + 2);
        if (event.startsWith("data: ")) onDecision(JSON.parse(event.slice(6)));
      }
    }
  } finally { reader.releaseLock(); }
}
