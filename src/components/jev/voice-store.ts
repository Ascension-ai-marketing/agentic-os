// One voice controller for the whole app. The sidebar dock and the Live page
// both read this store, so there is a single microphone, a single speaker and
// a single history no matter how many views are mounted.
import { useSyncExternalStore } from "react";
import type { OrbMood } from "./voice-orb-canvas";
import { JEV_SAMPLES, demoVoiceResult } from "./jev-samples";
import { focusMemory, openCurrentMemory } from "@/components/brain/brain-focus";
// Dev only: ?jevDemo=1 rehearses voice turns with sample picks. No API call, no speech.
const JEV_DEMO = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("jevDemo") === "1";
import {
  listVoices,
  routeVoice,
  speakVoice,
  transcribe,
  VoiceEngineMissing,
  type VoiceOption,
  type VoiceRouteOptions,
  type VoiceRouteResult,
  type ActiveTask,
  fishKeyMissing,
} from "./voice-client";
import { FISH_SIGNUP_URL } from "@/lib/fish";

export type VoiceTurn = {
  id: number;
  text: string;
  at: number;
  result?: VoiceRouteResult;
  sample?: boolean;
  error?: string;
};

export type VoiceState = {
  mood: OrbMood;
  interim: string;
  lastJobId?: string; // the newest agent job started by voice
  turn: VoiceTurn | null;
  history: VoiceTurn[];
  voices: VoiceOption[];
  voiceId: string;
  voiceMode: "auto" | "fixed"; // auto: Jev casts voice + tone per reply
  speed: number;
  speakingAs?: { name: string; tone?: string };
  previewing?: string; // voice id being previewed
  engine: "unknown" | "live" | "missing";
  muted: boolean; // replies stay text only
  paused: boolean; // the reply being spoken is on hold
  fishMissing?: boolean; // no FISH_API_KEY: show the Fish Audio sign-up link
};

const VOICE_KEY = "claude-os.voice.fish.v2";
const MODE_KEY = "claude-os.voice.mode.v2";
const SPEED_KEY = "claude-os.voice.speed.v1";
// v2: an old test left v1 muted, so everyone starts with sound on again.
const MUTE_KEY = "claude-os.voice.muted.v2";

function load(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window */
  }
}

let state: VoiceState = {
  mood: "idle",
  interim: "",
  turn: null,
  history: [],
  voices: [],
  voiceId: typeof window !== "undefined" ? load(VOICE_KEY, "") : "",
  // You pick the voice (Jarvis by default). Jev's job is the lane, not the casting.
  voiceMode: typeof window !== "undefined" && load(MODE_KEY, "fixed") === "auto" ? "auto" : "fixed",
  speed: typeof window !== "undefined" ? Math.min(2, Math.max(0.5, Number(load(SPEED_KEY, "1")) || 1)) : 1,
  engine: "unknown",
  muted: typeof window !== "undefined" && load(MUTE_KEY, "0") === "1",
  paused: false,
};
const listeners = new Set<() => void>();
let errorTimer = 0;
function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  if (patch.mood !== undefined && typeof window !== "undefined") {
    window.clearTimeout(errorTimer);
    // An error is a short soft pulse, then the orb rests again.
    if (patch.mood === "error") errorTimer = window.setTimeout(() => state.mood === "error" && set({ mood: "idle" }), 3000);
  }
  listeners.forEach((l) => l());
}

export const voiceLevel = { current: 0 };
// The task open in the chat, so "also make it blue" continues it rather than starting over.
let activeTask: ActiveTask | undefined;
export function setVoiceActiveTask(task: ActiveTask | undefined) {
  activeTask = task;
}
let navigateTo: ((to: string) => void) | null = null;
export function setVoiceNavigator(fn: ((to: string) => void) | null) {
  navigateTo = fn;
}

export function useVoice(): VoiceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

// Real Jev decisions replayed only when this server has no voice engine.
const SAMPLES: Record<string, Omit<VoiceRouteResult, "decision"> & { sampleId: string }> = {
  "open my morning brief": { sampleId: "sample-voice1", tier: "tier-1", intent: "open-brief", replyText: "Opening your morning brief.", navigateTo: "/business" },
  "what was the biggest ai news today?": {
    sampleId: "sample-voice2",
    tier: "tier-2",
    intent: "answer",
    replyText: "Sample only. With the voice engine running, a small model answers this from today's saved brief.",
  },
};
function sampleFor(text: string): VoiceRouteResult | null {
  const hit = SAMPLES[text.trim().toLowerCase()];
  const decision = hit && JEV_SAMPLES.find((d) => d.id === hit.sampleId);
  if (!hit || !decision) return null;
  const { sampleId: _s, ...rest } = hit;
  return { ...rest, decision };
}

function rmsOf(an: AnalyserNode, buf: Uint8Array<ArrayBuffer>) {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

let seq = 0;
const mic: {
  stream?: MediaStream;
  ctx?: AudioContext;
  raf?: number;
  rec?: any;
  recorder?: MediaRecorder;
  backup?: MediaRecorder; // records alongside the browser recogniser
  backupChunks?: Blob[];
  finalText: string;
  interimText: string;
  done: boolean;
} = { finalText: "", interimText: "", done: true };
let out: { audio?: HTMLAudioElement; nodes?: AudioNode[]; raf?: number; url?: string; stop?: () => void } = {};
let speakToken = 0; // bumped by stopOutput; a spoken reply stops when it changes

// One output context for every spoken reply, unlocked by the first tap or
// key press (Chrome only lets a page start audio from a user gesture).
let outCtx: AudioContext | null = null;
function outputContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!outCtx || outCtx.state === "closed") outCtx = new AudioContext();
  return outCtx;
}
if (typeof window !== "undefined") {
  const unlock = () => void outputContext()?.resume().catch(() => {});
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

function releaseMic() {
  if (mic.raf) cancelAnimationFrame(mic.raf);
  if (mic.backup?.state === "recording") {
    mic.backup.ondataavailable = null;
    mic.backup.stop();
  }
  mic.backup = undefined;
  mic.backupChunks = undefined;
  mic.stream?.getTracks().forEach((t) => t.stop());
  mic.ctx?.close().catch(() => {});
  mic.stream = undefined;
  mic.ctx = undefined;
  mic.raf = undefined;
  voiceLevel.current = 0;
}

export function stopOutput() {
  speakToken++;
  out.stop?.();
  if (out.raf) cancelAnimationFrame(out.raf);
  out.audio?.pause();
  if (out.url) URL.revokeObjectURL(out.url);
  out.nodes?.forEach((n) => {
    try {
      n.disconnect();
    } catch {
      /* already gone */
    }
  });
  out = {};
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  voiceLevel.current = 0;
  if (state.paused) set({ paused: false });
}

/** Mute: replies show as text and are not spoken. Muting mid-reply stops it. */
/** The chosen Fish voice, speed and mute, for live voice's Fish speaker. */
export const voiceSettings = () => ({ voiceId: state.voiceId || "14129c3e320149449d6bada6862f7338", speed: state.speed, muted: state.muted, fishMissing: state.fishMissing });

/** Live voice mirrors its phase here, so the dock orb and every other view follow it. */
export function mirrorLiveMood(mood: OrbMood) {
  if (state.mood !== mood) set({ mood });
}

export function setMuted(muted: boolean) {
  save(MUTE_KEY, muted ? "1" : "0");
  set({ muted });
  if (muted && state.mood === "speaking") {
    stopOutput();
    set({ mood: "idle", speakingAs: undefined });
  }
}

/** Stop everything now: listening, a pending answer, or a reply being spoken. */
export function stopAll() {
  seq++; // any answer still on its way is ignored
  if (!mic.done) {
    mic.done = true;
    try {
      mic.rec?.abort?.();
    } catch {
      /* already stopped */
    }
    if (mic.recorder?.state === "recording") {
      mic.recorder.onstop = null;
      mic.recorder.stop();
    }
    releaseMic();
  }
  stopOutput();
  set({ mood: "idle", interim: "", speakingAs: undefined, paused: false });
}

/** Pause or resume the reply that is being spoken. */
export function togglePause() {
  if (state.mood !== "speaking") return;
  const paused = !state.paused;
  if (out.audio) void (paused ? out.audio.pause() : out.audio.play().catch(() => {}));
  else if (typeof speechSynthesis !== "undefined") paused ? speechSynthesis.pause() : speechSynthesis.resume();
  if (paused) voiceLevel.current = 0;
  set({ paused });
}

let voicesLoading: Promise<void> | null = null;
function ensureVoices() {
  voicesLoading ??= loadVoices().finally(() => (voicesLoading = null));
  return voicesLoading;
}

export function loadVoices() {
  return listVoices()
    .then((list) => {
      // Your own clone stays out of the pickers: the voice is always a Fish library voice.
      const fish = list.filter((v) => v.kind !== "browser" && v.kind !== "self");
      const keep = fish.some((v) => v.id === state.voiceId) ? state.voiceId : (fish.find((v) => v.name === "Jarvis") ?? fish[0])?.id ?? "";
      set({ voices: fish, voiceId: keep, engine: "live", fishMissing: fishKeyMissing });
      save(VOICE_KEY, keep);
    })
    .catch((e) => set({ voices: [], engine: e instanceof VoiceEngineMissing ? "missing" : state.engine }));
}

export function setVoice(id: string) {
  set({ voiceId: id, voiceMode: "fixed" });
  save(VOICE_KEY, id);
  save(MODE_KEY, "fixed");
}
export function setVoiceMode(mode: "auto" | "fixed") {
  set({ voiceMode: mode });
  save(MODE_KEY, mode);
}
export function setSpeed(speed: number) {
  const v = Math.min(2, Math.max(0.5, speed));
  set({ speed: v });
  save(SPEED_KEY, String(v));
}
const PREVIEW_LINE: Record<string, string> = {
  self: "Hey, it's me. Everything's running. What do you need?",
  Jarvis: "Good evening. All systems are running. What can I do for you?",
  Atlas: "Here is your brief for today. Three things matter.",
  Raven: "Today's headline: three launches, and one of them changes everything.",
  Sage: "Take a breath. You've got this. Let's start with the first thing.",
};
/** Play a short line in one voice so the cast can be auditioned. */
export async function previewVoice(voice: VoiceOption, tone?: string) {
  stopOutput();
  set({ previewing: voice.id });
  const line = voice.kind === "self" ? PREVIEW_LINE.self : PREVIEW_LINE[voice.name] ?? "Hello, this is how I sound.";
  await speak(line, "idle", { voiceId: voice.id, voiceName: voice.kind === "self" ? "Your voice" : voice.name, tone }, true);
  set({ previewing: undefined });
}


async function speak(text: string, after: OrbMood, as?: { voiceId: string; voiceName: string; tone?: string }, evenIfMuted = false) {
  stopOutput();
  const finish = () => {
    voiceLevel.current = 0;
    set({ mood: after, speakingAs: undefined });
  };
  // The voice list loads with the Live or Chat panels; talking from the
  // sidebar alone must still use Fish (Jarvis), not the Mac's built-in voice.
  if (!as?.voiceId && !state.voiceId) await ensureVoices();
  const voiceId = as?.voiceId ?? state.voiceId;
  const voiceName = as?.voiceName ?? state.voices.find((v) => v.id === voiceId)?.name ?? "Voice";
  // Speak plain words: no markdown stars, bullets or list numbers read aloud.
  text = text
    .replace(/[*_#`>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!text || (state.muted && !evenIfMuted)) return finish();
  // Built-in speech is the silent fallback when no Fish voice is set up.
  const builtIn = () => {
    if (typeof speechSynthesis === "undefined") return finish();
    const u = new SpeechSynthesisUtterance(text);
    u.onboundary = () => {
      voiceLevel.current = 0.75;
      window.setTimeout(() => (voiceLevel.current = 0.2), 120);
    };
    u.onend = finish;
    u.onerror = finish;
    set({ mood: "speaking" });
    speechSynthesis.speak(u);
  };
  if (!voiceId) return builtIn();
  // Sentence by sentence: the first sentence is sent to Fish on its own so it
  // starts talking fast, and the next parts are fetched while it plays.
  const token = speakToken;
  const parts = splitForSpeech(text);
  const pending: (Promise<Blob> | undefined)[] = [];
  const part = (i: number) => (pending[i] ??= speakVoice(parts[i], voiceId, { tone: as?.tone, speed: state.speed }));
  set({ speakingAs: { name: voiceName, tone: as?.tone } });
  part(0);
  if (parts.length > 1) part(1);
  const ctx = outputContext();
  await ctx?.resume().catch(() => {});
  for (let i = 0; i < parts.length; i++) {
    let blob: Blob;
    try {
      blob = await part(i);
    } catch {
      if (token !== speakToken) return;
      // The first part failed: say it all with the built-in voice instead.
      if (i === 0) return builtIn();
      break;
    }
    if (token !== speakToken) return;
    if (i + 2 < parts.length) part(i + 2);
    set({ mood: "speaking" });
    const played = await playPart(blob, ctx, token);
    if (!played || token !== speakToken) return;
  }
  stopOutput();
  finish();
}

/** Splits a reply into a short first sentence, then parts of up to ~220 characters. */
function splitForSpeech(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    const last = out.at(-1);
    if (out.length > 1 && last && last.length + s.length < 220) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out.length ? out : [text];
}

/** Plays one part; resolves true when it ends, false if stopped. */
function playPart(blob: Blob, ctx: AudioContext | null, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    // Chrome starts an AudioContext made outside a click muted, so a reply
    // routed through it plays silently. Use the shared context your tap
    // unlocked; if it still is not running, play the audio directly.
    let an: AnalyserNode | null = null;
    let src: MediaElementAudioSourceNode | null = null;
    if (ctx && ctx.state === "running") {
      an = ctx.createAnalyser();
      an.fftSize = 512;
      src = ctx.createMediaElementSource(audio);
      src.connect(an);
      an.connect(ctx.destination);
    }
    const buf = new Uint8Array(512);
    const tick = () => {
      voiceLevel.current = state.paused ? 0 : an ? Math.min(1, rmsOf(an, buf) * 5) : 0.35 + 0.25 * Math.sin(performance.now() / 90);
      out.raf = requestAnimationFrame(tick);
    };
    const release = () => {
      if (out.raf) cancelAnimationFrame(out.raf);
      URL.revokeObjectURL(url);
      [src, an].forEach((n) => {
        try {
          n?.disconnect();
        } catch {
          /* already gone */
        }
      });
    };
    out = { audio, url, nodes: [src, an].filter(Boolean) as AudioNode[], stop: () => resolve(false) };
    audio.onended = () => {
      release();
      out = {};
      resolve(token === speakToken);
    };
    audio.onerror = () => {
      release();
      resolve(false);
    };
    const start = () => {
      if (token !== speakToken) return resolve(false);
      // A pause between parts holds the next one until you press Play.
      if (state.paused) return void window.setTimeout(start, 150);
      audio.play().then(tick, () => resolve(false));
    };
    start();
  });
}

/** Turn provider errors into one plain sentence with the fix. */
function plainError(e: unknown, fallback: string) {
  const m = e instanceof Error ? e.message : "";
  if (/Fish .*HTTP 40[13]/.test(m)) return "Fish Audio did not accept the key. Check FISH_API_KEY in ~/.config/agentic-os.env, then restart the OS.";
  if (/Fish .*HTTP 402/.test(m)) return "Fish Audio is out of credit. Top up, then try again.";
  if (/Fish .*HTTP 429/.test(m)) return "Fish Audio is busy. Wait a moment and try again.";
  if (/FISH_API_KEY/.test(m)) return `Create a free Fish Audio account at ${FISH_SIGNUP_URL}, then add FISH_API_KEY to ~/.config/agentic-os.env so the OS can hear and speak.`;
  return m || fallback;
}

function remember(turn: VoiceTurn) {
  const history = [turn, ...state.history.filter((t) => t.id !== turn.id)].slice(0, 12);
  set({ turn, history });
}

export async function processVoice(raw: string, opts: VoiceRouteOptions = {}) {
  const text = raw.trim();
  if (!text) {
    set({ mood: "error", turn: { id: ++seq, text: "", at: Date.now(), error: "Didn't catch that. Tap to try again." } });
    return;
  }
  const id = ++seq;
  const at = Date.now();
  remember({ id, text, at });
  set({ mood: "thinking", interim: text });
  let result: VoiceRouteResult;
  let sample = false;
  try {
    if (JEV_DEMO) {
      await new Promise((r) => window.setTimeout(r, 900 + Math.random() * 300));
      result = demoVoiceResult(text, activeTask);
      sample = true;
    } else result = await routeVoice(text, { ...opts, cast: state.voiceMode === "auto", ...(activeTask ? { activeTask } : {}) });
    set({ engine: "live" });
  } catch (e) {
    const s = e instanceof VoiceEngineMissing ? sampleFor(text) : null;
    if (e instanceof VoiceEngineMissing) set({ engine: "missing" });
    if (!s) {
      if (seq !== id) return;
      remember({
        id,
        text,
        at,
        error:
          e instanceof VoiceEngineMissing
            ? "The voice engine is not running on this server yet."
            : plainError(e, "Voice request failed."),
      });
      set({ mood: e instanceof VoiceEngineMissing ? "idle" : "error" });
      return;
    }
    await new Promise((r) => window.setTimeout(r, s.decision?.ms ?? 600));
    result = s;
    sample = true;
  }
  if (seq !== id) return;
  remember({ id, text, at, result, sample });
  // "When did I chat to Claude about X?": Memory opens focused on the matches.
  if (result.memoryFocus) focusMemory(result.memoryFocus);
  if (result.openCurrent) openCurrentMemory();
  if (result.navigateTo && navigateTo) {
    // Already on the Reels page: the page will not remount, so press its
    // button directly instead of relying on the ?audio=run it reads on load.
    const onReels = window.location.pathname === "/design" && /[?&]mode=reels\b/.test(window.location.search);
    const target = result.navigateTo;
    window.setTimeout(() => {
      navigateTo?.(target);
      if (onReels && /[?&]audio=run\b/.test(target)) window.setTimeout(() => window.dispatchEvent(new Event("agentic:reels-audio")), 300);
    }, 700);
  }
  // Real work runs in the background; Chat shows it inline as a task card.
  if (result.jobId) set({ lastJobId: result.jobId });
  const after: OrbMood = result.jobId ? "working" : "idle";
  if (sample) return set({ mood: "idle" });
  const cast = state.voiceMode === "auto" ? result.cast : undefined;
  void speak(result.replyText, after, cast ? { voiceId: cast.voiceId, voiceName: cast.voiceName, tone: cast.tone } : undefined);
}

async function finishListening(text: string) {
  if (mic.done) return;
  mic.done = true;
  releaseMic();
  set({ interim: text });
  await processVoice(text);
}

export async function startListening() {
  stopOutput();
  set({ interim: "", mood: "listening" });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    set({ mood: "error", turn: { id: ++seq, text: "", at: Date.now(), error: "The microphone is blocked. Allow it for this site, or type your request." } });
    return;
  }
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  Object.assign(mic, { stream, ctx, finalText: "", interimText: "", done: false, rec: undefined, recorder: undefined });
  const startedAt = performance.now();
  let heard = false;
  let srStopped = false;
  let lastLoud = startedAt;
  const tick = () => {
    const lvl = Math.min(1, rmsOf(an, buf) * 6);
    voiceLevel.current = lvl;
    const now = performance.now();
    if (lvl > 0.12) {
      heard = true;
      lastLoud = now;
    }
    if (mic.recorder && mic.recorder.state === "recording" && ((heard && now - lastLoud > 1400) || now - startedAt > 15000)) mic.recorder.stop();
    // The browser recogniser gets the same end rule: 1.4 s after you stop
    // talking, or 8 s of nothing at all, so a turn never hangs.
    if (mic.rec && !mic.done && !srStopped && ((heard && now - lastLoud > 1400) || (!heard && now - startedAt > 8000) || now - startedAt > 15000)) {
      srStopped = true;
      try {
        mic.rec.stop();
      } catch {
        /* already ending */
      }
    }
    mic.raf = requestAnimationFrame(tick);
  };
  mic.raf = requestAnimationFrame(tick);

  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (SR && !browserSpeechBroken) {
    const rec = new SR();
    rec.lang = navigator.language || "en-GB";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let fin = "";
      let mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else mid += r[0].transcript;
      }
      mic.finalText = fin;
      mic.interimText = mid;
      set({ interim: (fin + " " + mid).trim() });
    };
    rec.onerror = (e: any) => {
      // Brave and some Chromium builds block the built-in recogniser. Switch
      // to recording + Fish speech-to-text and keep the same microphone.
      if (["network", "service-not-allowed", "not-allowed", "language-not-supported"].includes(e?.error)) {
        browserSpeechBroken = true;
        mic.rec = undefined;
        startRecorder(stream);
      }
    };
    rec.onend = () => {
      if (mic.rec !== rec) return;
      const heardText = (mic.finalText + " " + mic.interimText).trim();
      // Chrome's recogniser often ends empty on a quiet or fast start. The
      // same audio was recorded alongside it, so Fish transcribes it instead.
      if (heardText || !mic.backup) return void finishListening(heardText);
      void backupTranscript().then((t) => finishListening(t));
    };
    mic.rec = rec;
    startBackup(stream);
    rec.start();
    return;
  }
  startRecorder(stream);
}

function startBackup(stream: MediaStream) {
  try {
    const backup = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    backup.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    backup.start();
    mic.backup = backup;
    mic.backupChunks = chunks;
  } catch {
    mic.backup = undefined;
  }
}

async function backupTranscript(): Promise<string> {
  const backup = mic.backup;
  const chunks = mic.backupChunks ?? [];
  if (!backup) return "";
  set({ mood: "thinking", interim: "Listening again with Fish…" });
  await new Promise<void>((resolve) => {
    backup.onstop = () => resolve();
    if (backup.state === "recording") backup.stop();
    else resolve();
  });
  mic.backup = undefined;
  if (!chunks.length) return "";
  try {
    return (await transcribe(new Blob(chunks, { type: backup.mimeType || "audio/webm" }))).trim();
  } catch {
    return "";
  }
}

// Brave ships the speech API but blocks Google's service behind it.
let browserSpeechBroken = typeof navigator !== "undefined" && !!(navigator as any).brave;

function startRecorder(stream: MediaStream) {
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    set({ mood: "thinking", interim: "Transcribing…" });
    try {
      await finishListening(await transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" })));
    } catch (e) {
      mic.done = true;
      releaseMic();
      set({ mood: "error", turn: { id: ++seq, text: "", at: Date.now(), error: plainError(e, "Could not transcribe.") } });
    }
  };
  mic.recorder = recorder;
  recorder.start();
}

export function stopListening() {
  if (mic.rec) mic.rec.stop();
  else if (mic.recorder?.state === "recording") mic.recorder.stop();
}

export function tapOrb() {
  if (state.mood === "listening") return stopListening();
  if (state.mood === "speaking") {
    stopOutput();
    return set({ mood: "idle" });
  }
  void startListening();
}

export function settleWorking() {
  if (state.mood === "working") set({ mood: "idle" });
}

// Dev only: rehearse every look with no microphone and no API call.
// Add ?voiceMood=listening (thinking, working, speaking, error) and/or
// ?voiceDemo=thread to any page. The mood holds until you tap the orb.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.setTimeout(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("voiceDemo") === "thread") {
      const history = demoThread();
      state = { ...state, history, turn: history[0] };
    }
    const mood = q.get("voiceMood") as OrbMood | null;
    if (mood && ["idle", "listening", "thinking", "working", "speaking", "error"].includes(mood)) state = { ...state, mood };
    listeners.forEach((l) => l());
  }, 0);
  (window as unknown as { __voice: unknown }).__voice = { set, get: () => state, say: (t: string) => processVoice(t) };
}

function demoThread(): VoiceTurn[] {
  const d = (id: string) => JEV_SAMPLES.find((s) => s.id === id)!;
  const now = Date.now();
  const turns: VoiceTurn[] = [
    { id: 901, at: now - 240e3, text: "Open my morning brief", sample: true, result: { decision: d("sample-voice1"), tier: "tier-1", intent: "open-brief", replyText: "Opening your morning brief.", cast: { voiceId: "", voiceName: "Jarvis", tone: "calm" } } },
    { id: 902, at: now - 150e3, text: "What was the biggest AI news today?", sample: true, result: { decision: d("sample-voice2"), tier: "tier-2", intent: "answer", replyText: "Three stories stand out in today's brief. I put them at the top of your dashboard.", cast: { voiceId: "", voiceName: "Atlas", tone: "curious" } } },
    { id: 903, at: now - 60e3, text: "Build me a landing page for the gym", sample: true, result: { decision: d("sample-voice3"), tier: "tier-3", intent: "build", replyText: "On it. Claude Code is building the gym page now. Watch it in the terminal below.", cast: { voiceId: "", voiceName: "Raven", tone: "confident" } } },
  ];
  return turns.reverse();
}
