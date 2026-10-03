// Talks to the voice engine on the local server (/__voice/*, built on the
// jev/astra-core branch). Every call carries the workspace token.
import type { JevDecision } from "@/lib/jev-types";

export type VoiceTier = "tier-1" | "tier-2" | "tier-3" | "unavailable";

export type VoiceRouteResult = {
  // Absent when the local gate handled it (a question, a page, Memory, a follow-up): no Jev call.
  decision?: JevDecision;
  gated?: boolean;
  tier: VoiceTier;
  intent: string;
  replyText: string;
  navigateTo?: string;
  jobId?: string;
  workerModel?: string;
  workerLabel?: string;
  osTools?: string[]; // tools the OS assistant used, e.g. ["calendar"] // e.g. "Sonnet 5", the model Jev picked for a quick answer
  workerCostUsd?: number | null;
  totalMs?: number;
  // "Open it": open the record Memory is showing.
  openCurrent?: boolean;
  // Tier 3 below the confidence bar: nothing started, the user decides.
  needsConfirm?: boolean;
  // Opened a page: its name, e.g. "Dashboard".
  pageLabel?: string;
  // Work: which agent runs it, on which model; `continued` when it resumed the open task.
  agent?: "claude" | "codex";
  agentModel?: { key: string; model: string; label: string; sure?: number };
  continued?: boolean;
  // A Memory lookup: where Memory should focus, and the source's name.
  memoryFocus?: { source?: string; query?: string; range?: "24h" | "7d" | "30d" | "90d" | "1y" | "all"; view?: "timeline"; open?: boolean };
  memoryLabel?: string;
  // Rehearsal only: lines the fake agent prints.
  demoScript?: string[];
  // Auto voice: who Jev cast to say the reply, and in what tone.
  cast?: { voiceId: string; voiceName: string; tone: string; sure?: number };
};

export type VoiceRouteOptions = {
  confirm?: boolean; // start the agent job the engine asked about
  force?: "tier-2"; // answer quickly instead
  cast?: boolean; // let Jev pick the voice and tone
  activeTask?: ActiveTask; // the task open in this chat, so a follow-up continues it
};
export type ActiveTask = { jobId: string; agent: "claude" | "codex"; prompt: string };

/** Chat's executor decision: what Jev would do with this message. Takes no action. */
export type TaskDecision = {
  decision: JevDecision;
  lane: "reply" | "open" | "memory" | "claude" | "codex" | "continue" | "error";
  intent: string;
  navigateTo?: string;
  pageLabel?: string;
  agent?: "claude" | "codex";
  agentModel?: { key: string; model: string; label: string; sure?: number };
  needsConfirm?: boolean;
  signedOut?: ("claude" | "codex")[];
  signInNeeded?: "claude" | "codex";
  /** The user named the agent: binding; the card shows only Jev's model pick within it. */
  bound?: boolean;
  memoryFocus?: { source?: string; query?: string; range?: "24h" | "7d" | "30d" | "90d" | "1y" | "all"; view?: "timeline"; open?: boolean };
  memoryLabel?: string;
};
export async function decideTask(text: string, opts: { activeTask?: ActiveTask; chatModel?: string; confirm?: boolean; agent?: "claude" | "codex" } = {}, signal?: AbortSignal): Promise<TaskDecision> {
  const res = await call("/__voice/task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ...opts }), signal });
  return res.json();
}

export type VoiceOption = {
  id: string;
  name: string;
  kind: "self" | "synthetic" | "browser";
  source?: string;
  persona?: string;
  bestFor?: string;
};

export class VoiceEngineMissing extends Error {}

let tokenPromise: Promise<string> | null = null;
function token(): Promise<string> {
  tokenPromise ??= fetch("/__token")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Local workspace unavailable"))))
    .then((b: { token?: string }) => b.token ?? "")
    .catch((e) => {
      tokenPromise = null;
      throw e;
    });
  return tokenPromise;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  const res = await fetch(path, { ...init, headers: { ...init.headers, "x-claude-os-token": t } });
  if (res.status === 404) throw new VoiceEngineMissing("The voice engine is not running on this server yet.");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Voice request failed (${res.status})`);
  }
  return res;
}

export async function routeVoice(text: string, opts: VoiceRouteOptions = {}, signal?: AbortSignal): Promise<VoiceRouteResult> {
  const res = await call("/__voice/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...opts }),
    signal,
  });
  return res.json();
}

export async function speakVoice(text: string, voiceId: string, opts: { tone?: string; speed?: number } = {}, signal?: AbortSignal): Promise<Blob> {
  const res = await call("/__voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId, ...opts }),
    signal,
  });
  return res.blob();
}

/** True once the server has said FISH_API_KEY is missing. */
export let fishKeyMissing = false;
export async function listVoices(): Promise<VoiceOption[]> {
  const res = await call("/__voice/voices");
  const body = await res.json();
  fishKeyMissing = /FISH_API_KEY is missing/.test(String(body?.warning ?? ""));
  const list: VoiceOption[] = Array.isArray(body) ? body : Array.isArray(body?.voices) ? body.voices : [];
  return list;
}

export async function transcribe(audio: Blob, signal?: AbortSignal): Promise<string> {
  const res = await call("/__voice/stt", {
    method: "POST",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
    signal,
  });
  const body = await res.json();
  return String(body?.text ?? "").trim();
}

export type OsStreamEvent =
  | { type: "tool"; name: string; label: string }
  | { type: "chunk"; text: string }
  | { type: "action"; action: { type: "open"; path: string; label: string } | { type: "memory"; focus: { source?: string; query: string; view: "timeline"; open: true }; label: string } }
  | { type: "done"; model: string; ms: number; costUsd: number | null; instant?: boolean }
  | { type: "error"; message: string };

/** The OS assistant: quick answers with tools over the OS. Streams events as they happen. */
export async function askOs(body: { text: string; history?: { role: "user" | "assistant"; content: string }[]; chatModel?: string; page?: string; personality?: unknown }, onEvent: (e: OsStreamEvent) => void, signal?: AbortSignal) {
  const res = await call("/__voice/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The OS assistant is unavailable");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const data = block.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
      if (!data) continue;
      let event: OsStreamEvent;
      try {
        event = JSON.parse(data) as OsStreamEvent;
      } catch {
        continue; /* malformed event */
      }
      // Outside the try: an "error" event must reach the caller so chat falls back to its own model.
      onEvent(event);
    }
  }
}
