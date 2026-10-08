// "Say Jarvis": a small detector (Picovoice Porcupine) that runs in the page and
// hears one word. Nothing it hears leaves this computer. It is off until you
// switch it on, and it lets go of the microphone whenever a conversation, live
// voice or push-to-talk needs it, which is also what stops Jarvis waking itself.
import { useSyncExternalStore } from "react";
import { operatorRequest } from "@/lib/operator";
import { WAKE_KEY_HELP, WAKE_MODEL_HELP, wakeStatus, type WakeStatus } from "@/lib/wake-word";

const SAVED = "agentic-os.wake-word.v1";
const MODEL = "/porcupine/porcupine_params.pv";

export type WakeState = { enabled: boolean; status: WakeStatus; error?: string };

let enabled = false;
let clicked = false;
let ready = false;
let error: string | undefined;
const holds = new Set<string>();
let state: WakeState = { enabled: false, status: "off" };
const listeners = new Set<() => void>();
let onWake: (() => void) | null = null;

type Detector = { subscribe: () => Promise<void>; unsubscribe: () => Promise<void>; release: () => Promise<void> };
let detector: Detector | null = null;
let subscribed = false;
// One change at a time: the microphone is taken and given back in order.
let queue: Promise<void> = Promise.resolve();
let make: () => Promise<Detector> = porcupine;

function publish() {
  const status = wakeStatus({ enabled, clicked, holds: holds.size, ready, error });
  if (status === state.status && enabled === state.enabled && error === state.error) return;
  state = { enabled, status, ...(enabled && error ? { error } : {}) };
  listeners.forEach((l) => l());
}

async function porcupine(): Promise<Detector> {
  const reply = await operatorRequest<{ key?: string; missing?: boolean }>("/ceo/wake-key", {});
  if (!reply.key) throw new Error(WAKE_KEY_HELP);
  const model = await fetch(MODEL, { method: "HEAD" }).catch(() => null);
  if (!model?.ok || model.headers.get("content-type")?.includes("text/html")) throw new Error(WAKE_MODEL_HELP);
  const [{ PorcupineWorker, BuiltInKeyword }, { WebVoiceProcessor }] = await Promise.all([import("@picovoice/porcupine-web"), import("@picovoice/web-voice-processor")]);
  const worker = await PorcupineWorker.create(reply.key, [BuiltInKeyword.Jarvis], () => heard(), { publicPath: MODEL });
  return {
    subscribe: () => WebVoiceProcessor.subscribe(worker),
    unsubscribe: () => WebVoiceProcessor.unsubscribe(worker),
    release: async () => {
      await worker.release();
      worker.terminate();
    },
  };
}

function heard() {
  if (state.status === "listening") onWake?.();
}

/** Bring the microphone in line with what is wanted now. */
function settle() {
  queue = queue.then(async () => {
    const want = enabled && clicked && holds.size === 0 && !error;
    try {
      if (want && !detector) detector = await make();
      // Things can change while the detector loads.
      const still = enabled && clicked && holds.size === 0 && !error;
      if (still && detector && !subscribed) {
        await detector.subscribe();
        subscribed = true;
      } else if (!still && detector && subscribed) {
        await detector.unsubscribe();
        subscribed = false;
      }
      if (!enabled && detector) {
        const old = detector;
        detector = null;
        await old.release();
      }
      ready = subscribed;
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      error = /permission|notallowed|denied/i.test(`${(e as Error)?.name} ${message}`) ? "The browser has not allowed the microphone for this page." : message || "The wake word could not start.";
      ready = false;
      subscribed = false;
    }
    publish();
  });
  return queue;
}

function save() {
  try {
    localStorage.setItem(SAVED, enabled ? "on" : "off");
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}

export function setWakeEnabled(on: boolean) {
  enabled = on;
  error = undefined;
  // Switching it on is itself a click.
  if (on) clicked = true;
  save();
  publish();
  void settle();
}

/** Something else needs the microphone (or is about to say "Jarvis" out loud). */
export function holdWake(who: string) {
  if (holds.has(who)) return;
  holds.add(who);
  publish();
  void settle();
}
export function releaseWake(who: string) {
  if (!holds.delete(who)) return;
  publish();
  void settle();
}

/** What happens when the word is heard. One listener: the Jarvis conversation. */
export function setWakeHandler(fn: (() => void) | null) {
  onWake = fn;
}

/** Called once the page is up: restores the saved choice. A browser plays no sound before the first click, so listening waits for it. */
export function restoreWake() {
  if (typeof window === "undefined" || enabled) return;
  try {
    enabled = localStorage.getItem(SAVED) === "on";
  } catch {
    enabled = false;
  }
  if (!enabled) return;
  clicked = navigator.userActivation?.hasBeenActive === true;
  publish();
  if (clicked) return void settle();
  const first = () => {
    window.removeEventListener("pointerdown", first, true);
    window.removeEventListener("keydown", first, true);
    clicked = true;
    publish();
    void settle();
  };
  window.addEventListener("pointerdown", first, true);
  window.addEventListener("keydown", first, true);
}

export function useWakeWord(): WakeState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

if (import.meta.hot) {
  // A code reload would otherwise leave the old detector on the microphone.
  import.meta.hot.dispose(() => {
    const old = detector;
    detector = null;
    void (async () => {
      if (subscribed) await old?.unsubscribe().catch(() => undefined);
      await old?.release().catch(() => undefined);
    })();
  });
}

// Dev only: checks drive the detector without a key or a voice. `fake()` swaps in a detector that never touches the microphone; `fire()` is the word being heard.
if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __wake: unknown }).__wake = {
    get: () => ({ ...state, holds: [...holds], subscribed }),
    fire: heard,
    fake: () => {
      make = async () => ({ subscribe: async () => {}, unsubscribe: async () => {}, release: async () => {} });
    },
  };
