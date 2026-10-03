// Chat with Hermes Agent (the local `hermes` CLI) from the Chat page and from
// voice. Each OS conversation keeps its own Hermes session, so a follow-up
// continues the same Hermes conversation with its memory of the earlier turns.
import { readChatStream } from "./chat-stream";

const SESSIONS_KEY = "agentic.hermes.sessions.v1";

/** The model Hermes runs on in the OS (30 Sep 2026): GPT-6.1 Sol through the Codex (ChatGPT) sign-in. */
export const HERMES_MODEL = { model: "gpt-6.1-sol", provider: "openai-codex", label: "GPT-6.1 Sol" } as const;

function readSessions(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The Hermes session behind an OS conversation, if it has one. */
export function hermesSessionFor(conversationId: string): string | undefined {
  const id = readSessions()[conversationId];
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : undefined;
}

export function rememberHermesSession(conversationId: string, sessionId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return;
  try {
    const all = readSessions();
    all[conversationId] = sessionId;
    // Keep the newest 200 conversations.
    const entries = Object.entries(all).slice(-200);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode or storage full: the next turn starts a new Hermes session */
  }
}

/** The session id Hermes prints at the end of a run ("session_id: 20260930_183143_5b1b01"). */
export function sessionIdFrom(info: string): string | undefined {
  return info.match(/session_id:\s*([A-Za-z0-9_-]{1,128})/)?.[1];
}

/**
 * One turn with Hermes Agent. Streams the reply through onText and returns the
 * full answer plus the Hermes session to resume next time. Hermes runs with
 * its own tools and memory, the same as on the Hermes page, on HERMES_MODEL.
 */
export async function askHermes(
  prompt: string,
  options: { conversationId?: string; signal?: AbortSignal; onText?: (text: string) => void; onAction?: (action: string, all: string[]) => void } = {},
): Promise<{ text: string; sessionId?: string; actions: string[] }> {
  const tokenResponse = await fetch("/__token", { signal: options.signal });
  if (!tokenResponse.ok) throw new Error("Could not authorize this local request.");
  const { token } = await tokenResponse.json();
  const resume = options.conversationId ? hermesSessionFor(options.conversationId) : undefined;
  const response = await fetch("/__hermes_chat", {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
    body: JSON.stringify({ prompt, streamFormat: "text-delta", yolo: true, progress: true, model: HERMES_MODEL.model, provider: HERMES_MODEL.provider, ...(resume ? { sessionId: resume } : {}) }),
  });
  if (!response.ok || !response.body) {
    let message = "Hermes is not answering. Check that Hermes Agent is installed and signed in (run hermes in Terminal).";
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      /* keep the plain message */
    }
    throw new Error(message);
  }
  let sessionId: string | undefined;
  const actions: string[] = [];
  const text = await readChatStream(response.body, (t) => options.onText?.(t), options.signal, (name, data) => {
    if (name === "info") sessionId = sessionIdFrom(data) ?? sessionId;
    if (name === "action" && data.trim()) {
      actions.push(data.trim());
      options.onAction?.(data.trim(), [...actions]);
    }
  });
  if (sessionId && options.conversationId) rememberHermesSession(options.conversationId, sessionId);
  return { text: text.trim(), sessionId, actions };
}
