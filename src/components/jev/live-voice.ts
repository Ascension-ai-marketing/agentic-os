// Live voice in Chat: one tap starts a continuous OpenAI Realtime conversation.
// The mic stays open, the server hears when you stop, and you can interrupt
// just by talking. Tools drive the OS directly (pages, Memory, lookups); only
// explicit work is delegated, where Jev picks the agent and model.
//
// Listening and speaking are separate seams (see `speak` below) so a later
// step can keep OpenAI listening and hand the speaking to Fish Audio.
import { useSyncExternalStore } from "react";
import { startOpenAIVoice, type VoicePhase } from "@/lib/openai-voice-client";
import { operatorRequest } from "@/lib/operator";
import { focusMemory, openCurrentMemory } from "@/components/brain/brain-focus";
import { JEV_PAGES } from "@/lib/jev-pages";
import { MEMORY_SOURCES } from "@/lib/jev-memory";
import { loadVoices, mirrorLiveMood, setMuted, setSpeed, voiceLevel, voiceSettings } from "./voice-store";
import { FISH_SIGNUP_URL } from "@/lib/fish";
import { createChunker, createFishSpeaker } from "./fish-speaker";
import { HUMOUR_LEVELS, loadPersonality, nextHumour, personalityInstructions, savePersonality, type Personality } from "@/lib/jev-personality";
import { asksForStyleChange, CONFIRM_WINDOW_MS, confirmsTask } from "@/lib/voice-confirm";

export type LivePhase = "off" | "connecting" | VoicePhase;
export type LiveState = {
  phase: LivePhase;
  caption: string;
  error?: string;
  /** OpenAI voice is configured on this server (undefined until checked). */
  configured?: boolean;
  /** The last few turns and actions of this conversation (not saved as a chat). */
  recent?: LiveLine[];
  /** A work request opened a task chat: its title, for the "Opened task chat" link. */
  taskChat?: string;
  /** Something to show while Jarvis talks about it: emails or an agenda. */
  card?: LiveCard;
  /** Your words so far, while you talk (live transcription). */
  heard?: string;
  /** Time from the end of your speech to the first reply audio, last turn. */
  firstAudioMs?: number;
};
export type LiveCard =
  | { type: "email"; items: { from: string; subject: string; date?: string; snippet?: string; provider?: string; link?: string }[]; query: string }
  | { type: "calendar"; date: string; events: { title: string; start: string; end?: string; allDay?: boolean; location?: string }[] }
  | { type: "task"; prompt: string; agent?: "claude" | "codex" | "hermes" };
export type LiveHandlers = {
  /** Explicit work: Jev picks the model (and the agent, unless named) and a new task chat shows it. Returns a short result for the model. */
  onDelegate: (prompt: string, agent?: "claude" | "codex" | "hermes") => Promise<string>;
  navigate: (href: string) => void;
};

let state: LiveState = { phase: "off", caption: "" };
const listeners = new Set<() => void>();
function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  if ("phase" in patch) mirrorLiveMood(state.phase === "off" ? "idle" : state.phase === "connecting" ? "thinking" : state.phase);
  listeners.forEach((l) => l());
}
export function useLiveVoice(): LiveState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

let handlers: LiveHandlers | null = null;
/** A new personality applies to the running conversation straight away. */
export function applyPersonality(p: Personality) {
  savePersonality(p);
  session?.sendContextualUpdate(`From now on, use this personality (tone only): ${personalityInstructions(p)}`);
}
/** Jarvis says something out loud now (and it shows as a line in the strip). */
export function announce(text: string, speak: string) {
  pushRecent("action", text);
  session?.say(`Say this to the user in one short sentence, in your own voice: ${speak}`);
}
/** A line in the voice strip from outside (e.g. "Started Codex on GPT-6 Astra"). */
export function liveNote(text: string) {
  pushRecent("action", text);
}
/** Close the email or agenda card (closing a task card cancels the task). */
export function closeLiveCard() {
  if (state.card?.type === "task") return cancelPendingTask();
  set({ card: undefined });
}
/** A work request opened a task chat: the strip shows "Opened task chat". */
export function noteTaskChat(title: string) {
  set({ taskChat: title });
}
export function setLiveHandlers(h: LiveHandlers | null) {
  handlers = h;
}

export async function checkLiveVoice() {
  try {
    const s = await (await fetch("/__operator/voice/openai/status")).json();
    set({ configured: s?.configured === true });
  } catch {
    set({ configured: false });
  }
  return state.configured;
}

let session: Awaited<ReturnType<typeof startOpenAIVoice>> | null = null;
let speaker: ReturnType<typeof createFishSpeaker> | null = null;
let controller: AbortController | null = null;
let meterRaf = 0;
let speechStoppedAt = 0;
// Where the time goes after you stop talking: first reply text, first chunk sent to Fish, first sound.
let timing: { text?: number; chunk?: number } = {};
const timings: { text?: number; chunk?: number; audio: number }[] = [];

let token: Promise<string> | null = null;
const getToken = () => (token ??= fetch("/__token").then((r) => r.json()).then((b) => b.token as string).catch((e) => ((token = null), Promise.reject(e))));
async function lookup(name: string, args: Record<string, unknown>) {
  const r = await fetch("/__voice/tool", { method: "POST", headers: { "Content-Type": "application/json", "x-claude-os-token": await getToken() }, body: JSON.stringify({ name, args }) });
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(body.error || "Lookup failed");
  return JSON.stringify(body.result).slice(0, 12000);
}

const LOOKUP_LABEL: Record<string, string> = {
  calendar: "Checked calendar",
  inbox: "Checked inbox",
  search_email: "Searched email",
  search_memory: "Searched memory",
  usage: "Checked usage",
  business: "Checked business",
  skills: "Checked skills",
  reels: "Checked Reels",
  agent_jobs: "Checked agent tasks",
  web_search: "Searched the web",
};

// Heavy pages (Memory's 3D graph, Design) block the page for a moment while
// they build. Open them just after the short spoken reply has started, so the
// voice answers straight away; light pages open at once.
let pendingNav: string | null = null;
let navTimer = 0;
function go(href: string) {
  if (!/^\/(memory|design)/.test(href)) return handlers?.navigate(href);
  pendingNav = href;
  window.clearTimeout(navTimer);
  navTimer = window.setTimeout(flushNav, 1800);
}
function flushNav() {
  window.clearTimeout(navTimer);
  const href = pendingNav;
  pendingNav = null;
  if (href) handlers?.navigate(href);
}

/** Every tool the live model can call. Returns a short result string for the model. */
async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const h = handlers;
  if (!h) return "The chat is not open.";
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
  switch (name) {
    case "open_page": {
      const page = JEV_PAGES[str(args.page)];
      if (!page) return "Unknown page.";
      actionLine(`Opened ${page.label}`);
      go(page.path);
      return `Opened ${page.label}.`;
    }
    case "os_lookup": {
      const tool = str(args.tool);
      if (tool === "now") {
        const d = new Date();
        return `${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
      }
      actionLine(LOOKUP_LABEL[tool] ?? "Looked it up");
      return lookup(tool, { query: str(args.query) });
    }
    case "show_in_memory": {
      const source = str(args.source);
      const focus = { ...(source && source !== "any" ? { source } : {}), query: str(args.query), view: "timeline" as const, open: true };
      focusMemory(focus);
      actionLine(`Opened Memory${focus.source ? ` in ${MEMORY_SOURCES[focus.source]?.label ?? focus.source}` : ""}${focus.query ? ` · "${focus.query}"` : ""}`);
      go("/memory");
      return "Memory is open on the matches.";
    }
    case "set_voice_style": {
      // Only the user's own recent words (spoken or typed) can change the style,
      // never text the model read in an email, a page or a memory.
      const recentAsk = () => Date.now() - lastUser.spokenAt < 45_000 && asksForStyleChange(lastUser.text);
      // Your words can still be transcribing: give them up to 3 s to land.
      for (let i = 0; i < 12 && !recentAsk(); i++) await new Promise((r) => setTimeout(r, 250));
      const asked = recentAsk();
      if (!asked) return "Not changed: only the user's own words can change your style. Ask them if they want it.";
      const before = loadPersonality();
      const humour = nextHumour(before.humour, str(args.humour));
      if (humour !== before.humour) applyPersonality({ ...before, humour });
      const now = voiceSettings().speed;
      const want = str(args.speed);
      const speed = want === "faster" ? now + 0.25 : want === "slower" ? now - 0.25 : want === "normal" ? 1 : Number(want) || now;
      const clamped = Math.round(Math.min(2, Math.max(0.5, speed)) * 100) / 100;
      if (clamped !== now) setSpeed(clamped);
      const label = HUMOUR_LEVELS.find((h) => h.id === humour)?.label ?? humour;
      actionLine(`Humour ${label} · Speed ${clamped.toFixed(2)}×`);
      return `Done. Humour is now ${label}, speed ${clamped.toFixed(2)}x. Say one short line in the new style.`;
    }
    case "open_current_record":
      openCurrentMemory();
      actionLine("Opened the record");
      return "Opened the record in view.";
    case "walkthrough": {
      const q = encodeURIComponent(str(args.query));
      const steps: Record<string, [string, string]> = {
        sort_inbox: ["/inbox?jev=sort", "Sorting your inbox"],
        find_invoices: [`/inbox?jev=invoices&q=${q}`, "Finding invoices"],
        reels_pick: ["/design?mode=reels&jev=pick", "Opened Reels · Let Jev pick"],
        image_search: [`/design?mode=library&q=${q}&ask=1`, "Searching your images"],
      };
      const step = steps[str(args.action)];
      if (!step) return "Unknown action.";
      actionLine(step[1]);
      go(step[0]);
      return `${step[1]}.`;
    }
    case "get_recent_meetings": {
      actionLine("Checked meetings");
      // What the OS already has (calendar + imported notes), plus Granola live when it answers quickly.
      const [saved, granola] = await Promise.all([
        lookup("meetings", { query: str(args.query) }).catch(() => "{}"),
        Promise.race([operatorRequest("/voice/recent-meetings", { query: str(args.query) }).then((r) => JSON.stringify(r).slice(0, 6000)), new Promise<string>((r) => setTimeout(() => r(""), 3500))]).catch(() => ""),
      ]);
      return JSON.stringify({ saved: JSON.parse(saved), granolaLive: granola ? JSON.parse(granola) : "Granola did not answer (not connected or slow)." }).slice(0, 12000);
    }
    case "show_email": {
      const raw = JSON.parse(await lookup("search_email", { query: str(args.query) }));
      const items = (raw.items ?? []).slice(0, 4);
      // A new card replaces a pending "Start this task?" card: that proposal is cancelled.
      if (pendingTask) cancelPendingTask();
      set({ card: { type: "email", items, query: str(args.query) } });
      actionLine(items.length ? `Showing ${items.length === 1 ? "the email" : `${items.length} emails`}` : "No matching email");
      return JSON.stringify({ shownOnScreen: items.length, emails: items.map((i: { from: string; subject: string; date?: string; snippet?: string }) => ({ from: i.from, subject: i.subject, date: i.date, snippet: i.snippet })) });
    }
    case "show_calendar": {
      const want = str(args.day).toLowerCase();
      const d = new Date();
      if (want === "tomorrow") d.setDate(d.getDate() + 1);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(want) ? want : d.toLocaleDateString("en-CA");
      const raw = JSON.parse(await lookup("calendar", { date }));
      if (pendingTask) cancelPendingTask();
      set({ card: { type: "calendar", date, events: raw.events ?? [] } });
      actionLine(`Showing ${date === new Date().toLocaleDateString("en-CA") ? "today" : date}`);
      return JSON.stringify({ shownOnScreen: true, date, events: raw.events ?? [] });
    }
    case "agent_task_status": {
      actionLine("Checked agent tasks");
      return lookup("agent_jobs", {});
    }
    case "delegate_task":
      return requestTask(typeof args.prompt === "string" ? args.prompt.slice(0, 6000).trim() : "", args.agent === "codex" || args.agent === "claude" || args.agent === "hermes" ? args.agent : undefined);
  }
  return "Unknown tool.";
}

// Real work waits for your yes: said out loud (your own transcribed words) or
// the Start button on the task card. Text inside an email, a page or a memory
// can steer the model, but it cannot speak into your microphone.
let pendingTask: { prompt: string; agent?: "claude" | "codex" | "hermes"; at: number } | null = null;
let startedTaskAt = 0;
// When each of your utterances began, by its audio item, so a transcript that
// arrives late is matched to words spoken before the card, not after it.
let speechStarts = new Map<string, number>();
let lastUser = { text: "", spokenAt: 0 };
async function requestTask(prompt: string, agent?: "claude" | "codex" | "hermes"): Promise<string> {
  if (!prompt) return "No task was given.";
  if (Date.now() - startedTaskAt < 15_000) return "The task has started. Say so in a few words.";
  if (pendingTask && Date.now() - pendingTask.at > CONFIRM_WINDOW_MS) cancelPendingTask(true);
  if (pendingTask) {
    // Your "yes" can still be transcribing: give it up to 3 s to land.
    const since = pendingTask.at;
    for (let i = 0; i < 12 && lastUser.spokenAt <= since; i++) await new Promise((r) => setTimeout(r, 250));
    if (pendingTask && state.card?.type === "task" && confirmsTask(lastUser, pendingTask.at) === "yes") return startPendingTask();
    if (!pendingTask) return Date.now() - startedTaskAt < 15_000 ? "The task has started. Say so in a few words." : "The task was cancelled. Nothing was started.";
    return "Not started. It starts only when the user plainly says yes, or taps Start on the card.";
  }
  const proposal = { prompt, agent, at: Date.now() };
  pendingTask = proposal;
  window.setTimeout(() => pendingTask === proposal && cancelPendingTask(true), CONFIRM_WINDOW_MS);
  set({ card: { type: "task", prompt, agent } });
  actionLine("Waiting for your OK");
  return `Not started. In one short sentence, ask the user whether to start ${agent === "codex" ? "Codex" : agent === "claude" ? "Claude Code" : agent === "hermes" ? "Hermes" : "an agent"} on this task. It starts only when they plainly say yes or tap Start on screen.`;
}
async function startPendingTask(): Promise<string> {
  const t = pendingTask;
  if (!t || !handlers) return "That task has already started. Say so in a few words.";
  pendingTask = null;
  startedTaskAt = Date.now();
  if (state.card?.type === "task") set({ card: undefined });
  return handlers.onDelegate(t.prompt, t.agent);
}
/** The Start button on the task card. */
export function confirmPendingTask() {
  if (!pendingTask) return;
  if (Date.now() - pendingTask.at > CONFIRM_WINDOW_MS) return cancelPendingTask(true);
  void startPendingTask().then((result) => session?.sendContextualUpdate(`The user tapped Start. ${result}`));
}
/** The Cancel button on the task card, a spoken "no", or the card expiring. */
export function cancelPendingTask(expired = false) {
  if (!pendingTask) return;
  pendingTask = null;
  if (state.card?.type === "task") set({ card: undefined });
  pushRecent("action", expired ? "Task not started (no answer)" : "Task cancelled");
  session?.sendContextualUpdate(expired ? "The proposed task expired without a yes. Nothing was started." : "The user cancelled the proposed task. Nothing was started.");
}
function heardUser(text: string, meta?: { itemId?: string; typed?: boolean }) {
  // Typed now, or spoken when that audio item began. Unknown timing never confirms.
  const started = meta?.itemId ? speechStarts.get(meta.itemId) : undefined;
  if (meta?.itemId) speechStarts.delete(meta.itemId);
  lastUser = { text, spokenAt: meta?.typed ? Date.now() : started ?? 0 };
  if (!pendingTask) return;
  if (Date.now() - pendingTask.at > CONFIRM_WINDOW_MS) return cancelPendingTask(true);
  const answer = confirmsTask(lastUser, pendingTask.at);
  // A yes only counts while the task card is still on screen.
  if (answer === "yes" && state.card?.type === "task") void startPendingTask();
  else if (answer === "no") cancelPendingTask();
}

// Your words are transcribed a moment after you stop, and the reply can land
// first. Hold the reply until your words arrive (at most 2.5 s) so the chat
// reads in order.
let userPending = false;
let held: { role: "assistant" | "action"; text: string }[] = [];
let heldTimer = 0;
function flushHeld() {
  window.clearTimeout(heldTimer);
  const out = held;
  held = [];
  out.forEach((t) => pushRecent(t.role, t.text));
}
function turnOrder(role: "user" | "assistant", text: string, meta?: { itemId?: string; typed?: boolean }) {
  if (role === "user") {
    heardUser(text, meta);
    userPending = false;
    pushRecent("user", text);
    flushHeld();
    return;
  }
  if (userPending) {
    held.push({ role: "assistant", text });
    window.clearTimeout(heldTimer);
    heldTimer = window.setTimeout(() => {
      userPending = false;
      flushHeld();
    }, 2500);
    return;
  }
  pushRecent("assistant", text);
}

/**
 * A conversation is not a chat: the last few turns and actions live here, in
 * the voice strip, and fade. Only real work opens a chat (a task chat).
 */
export type LiveLine = { id: number; role: "user" | "assistant" | "action"; text: string };
let lineId = 0;
/** The model sometimes writes em dashes despite being told not to: show a comma instead. */
const plain = (text: string) => text.replace(/\s*[—–]\s*/g, ", ");
function pushRecent(role: LiveLine["role"], text: string) {
  set({ recent: [...(state.recent ?? []), { id: ++lineId, role, text: plain(text) }].slice(-4) });
}

/** An action line ("Opened Dashboard"), kept after the words that asked for it. */
function actionLine(text: string) {
  if (!userPending) return pushRecent("action", text);
  held.push({ role: "action", text });
  window.clearTimeout(heldTimer);
  heldTimer = window.setTimeout(() => {
    userPending = false;
    flushHeld();
  }, 2500);
}

/** Start a live conversation. The mic stays open until you stop it. */
let userStopped = false;
let reconnects: number[] = [];
function reconnect() {
  const now = Date.now();
  reconnects = reconnects.filter((t) => now - t < 60_000);
  cancelAnimationFrame(meterRaf);
  session = null;
  controller = null;
  if (reconnects.length >= 3) {
    stopLive();
    set({ error: "The voice connection keeps dropping. Tap the orb to start again." });
    return;
  }
  reconnects.push(now);
  set({ phase: "connecting", caption: "Reconnecting…", error: undefined });
  window.setTimeout(() => void startLive(true), 400);
}

let lastSpeakError = 0;
export async function startLive(resume = false) {
  if (session || (state.phase === "connecting" && !resume)) return;
  userStopped = false;
  controller = new AbortController();
  set({ phase: "connecting", caption: "", error: undefined });
  // OpenAI listens and writes, Fish Audio (Jarvis) speaks the streamed text.
  // Without a Fish key there would be no sound at all, so say so before connecting.
  if (voiceSettings().fishMissing === undefined) await loadVoices().catch(() => undefined);
  if (voiceSettings().fishMissing) {
    set({ phase: "off", error: `Jarvis needs a Fish Audio key to speak. Create a free account at ${FISH_SIGNUP_URL}, then run: bun run setup:voice` });
    return;
  }
  const fishVoice = true;
  // A conversation always starts with sound on (an old test could leave it muted).
  if (voiceSettings().muted) setMuted(false);
  if (!resume || !speaker) {
    speaker?.stop();
    speaker = null;
  }
  const chunker = createChunker((text) => {
    if (speechStoppedAt && !timing.chunk) timing.chunk = Math.round(performance.now() - speechStoppedAt);
    if (!voiceSettings().muted) speaker?.speak(text);
  });
  if (fishVoice && !speaker) {
    speaker = createFishSpeaker({
      voiceId: () => voiceSettings().voiceId,
      speed: () => voiceSettings().speed,
      token: getToken,
      onError: (status) => {
        const now = Date.now();
        if (now - lastSpeakError < 10_000) return;
        lastSpeakError = now;
        pushRecent("action", status === 401 || status === 402 || status === 403 ? "Fish Audio refused the key or the account has no credit. Check it with: bun run setup:voice --check" : "Jarvis could not speak that line (Fish Audio did not answer)");
      },
      onStart: () => {
        if (speechStoppedAt) {
          set({ firstAudioMs: Math.round(performance.now() - speechStoppedAt) });
          timings.push({ ...timing, audio: Math.round(performance.now() - speechStoppedAt) });
          speechStoppedAt = 0;
        }
        set({ phase: "speaking", heard: "" });
        if (pendingNav) window.setTimeout(flushNav, 900);
      },
      onIdle: () => {
        if (session && state.phase === "speaking") set({ phase: "listening" });
      },
    });
    speaker.unlock(); // inside the tap, so the browser lets it play
  }
  try {
    session = await startOpenAIVoice({
      signal: controller.signal,
      createSession: (sdp) => operatorRequest("/voice/openai/session", { sdp, mode: fishVoice ? "live-fish" : "live", personality: loadPersonality() }),
      ...(fishVoice
        ? {
            onTextDelta: (delta: string) => {
              if (speechStoppedAt && !timing.text) timing.text = Math.round(performance.now() - speechStoppedAt);
              chunker.push(delta);
            },
            onResponseDone: (_id: string, cancelled: boolean) => (cancelled ? chunker.reset() : chunker.flush()),
          }
        : {}),
      onMessage: (role, text, meta) => turnOrder(role, text, meta),
      onCaption: (caption) => set({ caption: plain(caption) }),
      onUserDelta: (delta) => set({ heard: `${state.heard ?? ""}${delta}`.slice(-240) }),
      onSpeechStarted: (itemId) => {
        if (itemId) {
          speechStarts.set(itemId, Date.now());
          if (speechStarts.size > 12) speechStarts.delete(speechStarts.keys().next().value!);
        }
        // Barge-in: silence the Fish voice and drop what it was about to say.
        speaker?.stop();
        // Warm the line to Fish while you talk, so the reply's first words start sooner.
        if (fishVoice) void getToken().then((t) => fetch("/__voice/speak-warm", { method: "POST", headers: { "Content-Type": "application/json", "x-claude-os-token": t }, body: "{}" })).catch(() => {});
        chunker.reset();
        set({ phase: "listening", heard: "", caption: "" });
      },
      onPhase: (phase) => {
        // While Fish is still talking, the reply being "done" does not mean listening yet.
        if (speaker?.isSpeaking() && phase !== "speaking") return;
        if (phase === "thinking" && state.phase === "listening") {
          speechStoppedAt = performance.now();
          timing = {};
          userPending = true;
        }
        if (phase === "speaking" && speechStoppedAt) {
          set({ firstAudioMs: Math.round(performance.now() - speechStoppedAt) });
          speechStoppedAt = 0;
        }
        set(phase === "speaking" ? { phase, heard: "" } : { phase });
      },
      onError: (message) => set({ error: message }),
      // A dropped connection (not your End) reconnects by itself, keeping the chat.
      onDisconnect: () => (userStopped ? stopLive() : reconnect()),
      onTool: (name, args) => runTool(name, args),
    });
    set({ phase: "listening" });
    // The orb breathes with whoever is talking: your voice while you speak,
    // the reply while it speaks. Fast attack, soft release, so every syllable shows.
    let level = 0;
    const tick = () => {
      if (!session) return;
      const target = state.phase === "speaking" ? (speaker ? speaker.level() : session.getOutputVolume()) : state.phase === "listening" ? session.getInputVolume() : 0;
      level += (target - level) * (target > level ? 0.65 : 0.14);
      voiceLevel.current = level;
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Live voice could not start.";
    session = null;
    controller?.abort();
    controller = null;
    set({ phase: "off", error: (e as Error)?.name === "AbortError" ? undefined : message });
  }
}

export function stopLive() {
  userStopped = true;
  pendingTask = null;
  speechStarts = new Map();
  set({ card: undefined, recent: [], taskChat: undefined });
  pendingNav = null;
  cancelAnimationFrame(meterRaf);
  speaker?.stop();
  speaker?.close();
  speaker = null;
  voiceLevel.current = 0;
  const s = session;
  session = null;
  controller?.abort();
  controller = null;
  void s?.endSession();
  set({ phase: "off", caption: "" });
}

/**
 * One voice mode: OpenAI Realtime is the ears and brain (continuous, barge-in,
 * tools, text only), Fish Audio's Jarvis is the only voice.
 */
export function voiceEngine() {
  return "fish-live" as const;
}

/**
 * The one way voice starts: the sidebar orb, the header Voice button and any
 * "operator:voice" event. It starts (or ends) the live conversation at once,
 * on the page you are on.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function activateVoice(_navigate?: (href: string) => void) {
  // Voice starts where you are: the Live pill (and any card) shows on this page.
  // Only the Chat nav item and the expand button open /chat.
  if (session || state.phase === "connecting") return stopLive();
  void startLive(); // inside the tap, so the mic and audio are allowed
}

export const liveOn = () => !!session || state.phase === "connecting";
/** Stop the reply now (the same as starting to talk). */
export function interruptLive() {
  session?.sendUserActivity();
}
export function setLiveMicMuted(muted: boolean) {
  session?.setMicMuted(muted);
}

// Dev only: tests drive the live session from outside and read the orb level.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __live: unknown }).__live = { get: () => ({ ...state, level: voiceLevel.current, timings }), start: startLive, stop: stopLive };
