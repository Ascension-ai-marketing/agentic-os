// The Jarvis conversation inside the OS: the word "Jarvis" (or the Jarvis page)
// opens a call to the same voice brain the test page uses. ElevenLabs listens
// and speaks; the brain on this computer thinks and acts. A spoken "yes" to an
// approval is heard and recorded by the brain, never by this page.
import { useSyncExternalStore } from "react";
import { operatorRequest } from "@/lib/operator";
import { quietTooLong } from "@/lib/wake-word";
import { liveOn } from "./live-voice";
import { mirrorLiveMood, voiceLevel } from "./voice-store";
import { holdWake, releaseWake } from "./wake-word";

export type CeoVoicePhase = "off" | "connecting" | "listening" | "speaking";
export type CeoVoiceState = { phase: CeoVoicePhase; caption: string; error?: string };

type Call = { endSession: () => Promise<void>; getInputVolume: () => number; getOutputVolume: () => number };
type CallOptions = {
  conversationToken: string;
  overrides?: { agent: { firstMessage: string } };
  onConnect?: () => void;
  onDisconnect?: () => void;
  onMessage?: (m: { message?: string; source?: string; role?: string }) => void;
  onModeChange?: (m: { mode?: string }) => void;
  onError?: (e: unknown) => void;
};

let state: CeoVoiceState = { phase: "off", caption: "" };
const listeners = new Set<() => void>();
function set(patch: Partial<CeoVoiceState>) {
  state = { ...state, ...patch };
  if ("phase" in patch) mirrorLiveMood(state.phase === "off" ? "idle" : state.phase === "connecting" ? "thinking" : state.phase);
  listeners.forEach((l) => l());
}
export function useCeoVoice(): CeoVoiceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

let call: Call | null = null;
let attempt = 0;
let raf = 0;
let quiet = 0;
let lastSound = 0;
let awaitingReply = false;
let connect: (options: CallOptions) => Promise<Call> = async (options) => (await import("@elevenlabs/client")).Conversation.startSession(options as never) as unknown as Promise<Call>;

export const ceoVoiceOn = () => state.phase !== "off";

export async function startCeoVoice() {
  // One conversation at a time: live voice in Chat keeps the microphone if it has it.
  if (ceoVoiceOn() || liveOn()) return;
  const mine = ++attempt;
  holdWake("jarvis");
  set({ phase: "connecting", caption: "", error: undefined });
  try {
    const { token, firstMessage } = await operatorRequest<{ token: string; firstMessage?: string }>("/ceo/voice-token", {});
    if (mine !== attempt) return;
    const started = await connect({
      conversationToken: token,
      // Without the greeting sent here the call opens silent.
      ...(firstMessage ? { overrides: { agent: { firstMessage } } } : {}),
      onDisconnect: () => mine === attempt && finish(),
      onMessage: (m) => {
        if (mine !== attempt || !m.message) return;
        lastSound = Date.now();
        const jarvis = m.source === "ai" || m.role === "agent";
        awaitingReply = !jarvis;
        if (jarvis) set({ caption: m.message });
      },
      onModeChange: (m) => {
        if (mine !== attempt || !call) return;
        lastSound = Date.now();
        set({ phase: m.mode === "speaking" ? "speaking" : "listening" });
      },
      onError: (e) => mine === attempt && set({ error: typeof e === "string" ? e : (e as Error)?.message || "The conversation hit a problem." }),
    });
    if (mine !== attempt) return void started.endSession().catch(() => undefined);
    call = started;
    lastSound = Date.now();
    awaitingReply = false;
    set({ phase: firstMessage ? "speaking" : "listening" });
    // The orb breathes with whoever is talking, as it does for live voice.
    let level = 0;
    const tick = () => {
      if (call !== started) return;
      const target = state.phase === "speaking" ? started.getOutputVolume() : started.getInputVolume();
      // Your voice counts as sound before its words arrive, so a long sentence is not cut off.
      if (state.phase === "listening" && target > 0.12) lastSound = Date.now();
      level += (target - level) * (target > level ? 0.65 : 0.14);
      voiceLevel.current = level;
      raf = requestAnimationFrame(tick);
    };
    tick();
    // Gone quiet: close, and the page goes back to listening for the word.
    quiet = window.setInterval(() => {
      if (quietTooLong({ now: Date.now(), lastSound, speaking: state.phase === "speaking", awaitingReply })) stopCeoVoice();
    }, 1000);
  } catch (e) {
    if (mine !== attempt) return;
    finish();
    const denied = /permission|notallowed|denied/i.test(`${(e as Error)?.name} ${(e as Error)?.message}`);
    set({ error: denied ? "The browser has not allowed the microphone for this page." : (e as Error)?.message || "Jarvis could not start." });
  }
}

function finish() {
  attempt++;
  cancelAnimationFrame(raf);
  window.clearInterval(quiet);
  call = null;
  voiceLevel.current = 0;
  set({ phase: "off", caption: "" });
  releaseWake("jarvis");
}

export function stopCeoVoice() {
  if (!ceoVoiceOn()) return;
  const ending = call;
  finish();
  void ending?.endSession().catch(() => undefined);
}

if (import.meta.hot) import.meta.hot.dispose(() => stopCeoVoice());

// Dev only: checks run the conversation's states with a made-up call, so no real call is placed.
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __ceoVoice: unknown }).__ceoVoice = {
    get: () => ({ ...state, awaitingReply, quietFor: lastSound ? Date.now() - lastSound : 0 }),
    start: startCeoVoice,
    stop: stopCeoVoice,
    fake: (make: (options: CallOptions) => Promise<Call>) => {
      connect = make;
    },
    age: (ms: number) => {
      lastSound -= ms;
    },
  };
