/**
 * The rules behind "Hey Jarvis": when the page listens for the word, and when a
 * conversation that has gone quiet is closed. Kept free of the browser so they
 * are tested directly.
 */
export type WakeStatus = "off" | "waiting" | "starting" | "listening" | "paused" | "error";

/**
 * Listening only happens when it is switched on, the page has been clicked once
 * (the browser stays silent until then) and nothing else holds the microphone.
 */
export function wakeStatus(wake: { enabled: boolean; clicked: boolean; holds: number; ready: boolean; error?: string }): WakeStatus {
  if (!wake.enabled) return "off";
  if (wake.error) return "error";
  if (!wake.clicked) return "waiting";
  if (wake.holds > 0) return "paused";
  return wake.ready ? "listening" : "starting";
}

export const WAKE_LABEL: Record<WakeStatus, string> = {
  off: "",
  waiting: "Click anywhere, then say “Hey Jarvis”",
  starting: "Getting ready to listen…",
  listening: "Say “Hey Jarvis”",
  paused: "",
  error: "",
};

/** How long a conversation may sit silent before it closes and the page listens for the word again. */
export const QUIET_MS = 20_000;
/** While Jarvis is working on an answer, silence is expected. This is the longest it may last. */
export const REPLY_MS = 90_000;

/** `lastSound` is the last moment either side was heard; `awaitingReply` is true from the person's words until Jarvis answers. */
export function quietTooLong(call: { now: number; lastSound: number; speaking: boolean; awaitingReply: boolean }) {
  if (call.speaking) return false;
  return call.now - call.lastSound > (call.awaitingReply ? REPLY_MS : QUIET_MS);
}
