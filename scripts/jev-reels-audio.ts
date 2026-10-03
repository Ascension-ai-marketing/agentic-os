// The Reels audio pipeline, run in the background on the example reel:
// (1) Fish Audio transcribes the voice, (2) Jev places a sound effect on each
// section, (3) Fish Audio voices the hook in the chosen voice, (4) ffmpeg
// mixes the effects under the reel locally. The example sound effects are
// synthesised locally with ffmpeg: Fish Audio has no sound-effects endpoint.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import type { ReelSection } from "../src/lib/jev-reels";
import { SFX_NAMES, suggestSectionSfx, enabledEffects, type SfxName, type SectionSfx } from "../src/lib/reel-sfx";
import { findBinary } from "../src/motion/server/util";

const run = promisify(execFile);
export const JARVIS_VOICE_ID = "14129c3e320149449d6bada6862f7338";

/** ffmpeg recipes. Every one is original, made from sine waves and noise. */
const RECIPES: Record<SfxName, { label: string; seconds: number; graph: string }> = {
  whoosh: { label: "Whoosh", seconds: 0.9, graph: "anoisesrc=d=0.9:c=pink:a=0.9:r=44100,lowpass=f=2600,highpass=f=180,volume='pow(sin(PI*t/0.9),2)':eval=frame,aecho=0.6:0.4:40:0.25" },
  pop: { label: "Pop", seconds: 0.25, graph: "aevalsrc='0.9*sin(2*PI*(700*t+5200*t*t))*exp(-32*t)':d=0.25:s=44100" },
  impact: { label: "Impact", seconds: 1.4, graph: "aevalsrc='0.95*sin(2*PI*(62*t-14*t*t))*exp(-3.2*t)+0.35*(random(0)*2-1)*exp(-26*t)':d=1.4:s=44100,lowpass=f=1800" },
  riser: { label: "Riser", seconds: 1.6, graph: "aevalsrc='(0.28*sin(2*PI*(180*t+420*t*t))+0.12*sin(2*PI*(360*t+840*t*t))+0.18*(random(0)*2-1)*t/1.6)*pow(t/1.6,1.6)':d=1.6:s=44100,highpass=f=120,afade=t=out:st=1.5:d=0.1" },
  "cash-register": { label: "Cash register", seconds: 1.2, graph: "aevalsrc='0.6*(random(0)*2-1)*exp(-90*t)+gte(t,0.09)*(0.32*sin(2*PI*2093*(t-0.09))+0.26*sin(2*PI*2637*(t-0.09))+0.2*sin(2*PI*3136*(t-0.09)))*exp(-3.6*(t-0.09))':d=1.2:s=44100" },
  "clock-tick": { label: "Clock tick", seconds: 1.0, graph: "aevalsrc='0.85*sin(2*PI*if(lt(mod(t,0.5),0.25),3200,2400)*t)*exp(-160*mod(t,0.25))':d=1.0:s=44100,highpass=f=900" },
  "notification-ding": { label: "Ding", seconds: 1.3, graph: "aevalsrc='0.45*sin(2*PI*1318.5*t)*exp(-4.5*t)+gte(t,0.13)*0.45*sin(2*PI*1760*(t-0.13))*exp(-4.2*(t-0.13))':d=1.3:s=44100" },
  typing: { label: "Typing", seconds: 1.1, graph: "aevalsrc='0.7*(random(0)*2-1)*lt(mod(t+0.013*sin(37*t),0.105),0.011)':d=1.1:s=44100,highpass=f=1500,lowpass=f=7000" },
  "crowd-gasp": { label: "Crowd gasp", seconds: 1.1, graph: "anoisesrc=d=1.1:c=pink:a=0.8:r=44100,bandpass=f=1100:width_type=h:w=900,volume='min(1,t/0.22)*exp(-2.6*max(0,t-0.22))':eval=frame,aecho=0.7:0.5:22|37:0.3|0.25" },
};

export type SfxItem = { name: SfxName; label: string; seconds: number; peaks: number[] };
export type AudioStep = { id: "transcribe" | "place" | "voice" | "mix"; label: string; state: "pending" | "running" | "done" | "error"; ms?: number; detail?: string };
export type AudioPipeline = {
  running: boolean;
  startedAt?: string;
  steps: AudioStep[];
  transcript?: { text: string; segments: Array<{ text: string; start: number; end: number }>; source: string };
  placements?: SectionSfx[];
  voice?: { text: string; file: string; voiceId: string; bytes: number };
  mix?: { file: string; effects: number; version: number; placed: Array<{ sectionId: string; effect: SfxName; at: number }> };
  error?: string;
};

const STEP_LABELS: Record<AudioStep["id"], string> = {
  transcribe: "Fish Audio transcribes the voice",
  place: "Jev places a sound effect on each section",
  voice: "Fish Audio voices the hook in Jarvis",
  mix: "Mixing the effects under the reel",
};
const freshSteps = (): AudioStep[] => (Object.keys(STEP_LABELS) as AudioStep["id"][]).map((id) => ({ id, label: STEP_LABELS[id], state: "pending" }));

async function ffmpeg(args: string[], timeout = 60_000) {
  const bin = findBinary("ffmpeg");
  if (!bin) throw new Error("ffmpeg is unavailable");
  await run(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout, maxBuffer: 4_000_000 });
}

/** 48 loudness peaks, 0..1, for a small waveform. */
async function peaksOf(file: string, count = 48): Promise<number[]> {
  const bin = findBinary("ffmpeg");
  if (!bin) return [];
  const { stdout } = await run(bin, ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 8_000_000, timeout: 20_000 });
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
  const size = Math.max(1, Math.floor(samples.length / count));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let peak = 0;
    for (let j = i * size; j < Math.min(samples.length, (i + 1) * size); j++) peak = Math.max(peak, Math.abs(samples[j]));
    out.push(Math.round((peak / 32768) * 100) / 100);
  }
  return out;
}

export function createReelsAudio(options: { root: string; reference: string; sections: () => ReelSection[]; fishKey: () => string; fetch?: typeof fetch; voiceId?: string }) {
  const sfxDir = join(options.root, ".operator-data/reels/sfx");
  const outDir = join(options.root, ".operator-data/reels/audio-demo");
  const fetcher = options.fetch ?? fetch;
  // The last finished run survives a server restart, so the page can show it.
  const saved = join(outDir, "state.json");
  let state: AudioPipeline = { running: false, steps: freshSteps() };
  try {
    const last = JSON.parse(readFileSync(saved, "utf8")) as AudioPipeline;
    if (Array.isArray(last.steps)) state = { ...last, running: false };
  } catch { /* no earlier run */ }
  const persist = () => {
    try {
      mkdirSync(outDir, { recursive: true, mode: 0o700 });
      writeFileSync(saved, JSON.stringify({ ...state, running: false }), { mode: 0o600 });
    } catch { /* the page still has the live state */ }
  };
  let library: SfxItem[] | null = null;

  async function sfxLibrary(): Promise<SfxItem[]> {
    if (library) return library;
    mkdirSync(sfxDir, { recursive: true, mode: 0o700 });
    const items: SfxItem[] = [];
    for (const name of SFX_NAMES) {
      const file = join(sfxDir, `${name}.mp3`);
      if (!existsSync(file)) await ffmpeg(["-f", "lavfi", "-i", RECIPES[name].graph, "-t", String(RECIPES[name].seconds), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=" + Math.max(0, RECIPES[name].seconds - 0.08).toFixed(2) + ":d=0.08", "-ac", "1", "-ar", "44100", "-b:a", "160k", file]);
      items.push({ name, label: RECIPES[name].label, seconds: RECIPES[name].seconds, peaks: await peaksOf(file).catch(() => []) });
    }
    library = items;
    return items;
  }

  function status(): AudioPipeline {
    return state;
  }

  const step = (id: AudioStep["id"], patch: Partial<AudioStep>) => {
    state = { ...state, steps: state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
  };
  async function timed<T>(id: AudioStep["id"], work: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    step(id, { state: "running" });
    try {
      const out = await work();
      step(id, { state: "done", ms: Math.round(performance.now() - t0) });
      return out;
    } catch (e) {
      step(id, { state: "error", ms: Math.round(performance.now() - t0), detail: e instanceof Error ? e.message.slice(0, 160) : "Step failed" });
      throw e;
    }
  }

  async function pipeline() {
    const reel = join(options.reference, "media", "reel-A.mp4");
    if (!existsSync(reel)) throw new Error("The example reel is missing");
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const key = options.fishKey();
    const sections = options.sections();

    // 1. Extract the voice locally, then Fish Audio ASR with timestamps.
    await timed("transcribe", async () => {
      if (!key) throw new Error("FISH_API_KEY is missing");
      const wav = join(outDir, "voice.wav");
      await ffmpeg(["-i", reel, "-vn", "-ac", "1", "-ar", "16000", wav]);
      const fd = new FormData();
      fd.append("audio", new Blob([readFileSync(wav)], { type: "audio/wav" }), "voice.wav");
      fd.append("ignore_timestamps", "false");
      const r = await fetcher("https://api.fish.audio/v1/asr", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`Fish transcription HTTP ${r.status}`);
      const body = await r.json();
      const segments = (Array.isArray(body.segments) ? body.segments : [])
        .map((s: any) => ({ text: String(s.text ?? "").trim(), start: Number(s.start) || 0, end: Number(s.end) || 0 }))
        .filter((s: { text: string }) => s.text);
      state = { ...state, transcript: { text: String(body.text ?? "").trim(), segments, source: "Fish Audio ASR" } };
      step("transcribe", { detail: `${segments.length} timed segments` });
    });

    // 2. Three or four effect options per section, the best one on.
    await timed("place", async () => {
      await sfxLibrary();
      const placements: SectionSfx[] = [];
      for (const [i, s] of sections.entries()) {
        placements.push(suggestSectionSfx(s, i, sections.length));
        state = { ...state, placements: [...placements] };
        await new Promise((r) => setTimeout(r, 180));
      }
      step("place", { detail: `${placements.length} sections, ${enabledEffects(placements, toggles).length} effects on` });
    });

    // The hook voice and the mix are no longer automatic (28 Sep):
    // effects go under the reel only when "Add the sound effects" is pressed.
  }

  let toggles: Record<string, boolean> = {};
  let mixVersion = 0;
  async function mixNow() {
    const reel = join(options.reference, "media", "reel-A.mp4");
    await sfxLibrary();
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const sections = options.sections();
    const placed = enabledEffects(state.placements ?? sections.map((s, i) => suggestSectionSfx(s, i, sections.length)), toggles);
    const inputs = ["-i", reel, ...placed.flatMap((p) => ["-i", join(sfxDir, `${p.effect}.mp3`)])];
    const chains = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)},volume=0.55[s${i}]`);
    const mix = placed.length ? `[0:a]${placed.map((_, i) => `[s${i}]`).join("")}amix=inputs=${placed.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[a]` : "[0:a]anull[a]";
    await ffmpeg([...inputs, "-filter_complex", [...chains, mix].join(";"), "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", join(outDir, "reel-A-sfx.mp4")], 120_000);
    mixVersion++;
    state = { ...state, mix: { file: "reel-A-sfx.mp4", effects: placed.length, version: mixVersion, placed } };
    step("mix", { detail: `${placed.length} effects under the voice` });
  }

  /** Set which effects are on. Keys are "sectionId:effect". */
  function setToggles(next: unknown) {
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    toggles = Object.fromEntries(
      Object.entries(next as Record<string, unknown>)
        .filter(([k, v]) => /^s\d{1,2}:[a-z-]+$/.test(k) && (SFX_NAMES as string[]).includes(k.split(":")[1]) && typeof v === "boolean")
        .slice(0, 200),
    ) as Record<string, boolean>;
  }

  /** Re-mix only (local ffmpeg, no provider call) after toggles change. */
  function remix(next?: unknown) {
    setToggles(next);
    if (state.running) return state;
    state = { ...state, running: true, error: undefined };
    void timed("mix", () => mixNow())
      .catch((e) => {
        state = { ...state, error: e instanceof Error ? e.message.slice(0, 200) : "Mixing stopped" };
      })
      .finally(() => {
        state = { ...state, running: false };
        persist();
      });
    return state;
  }

  function start(next?: unknown) {
    setToggles(next);
    if (state.running) return state;
    state = { running: true, startedAt: new Date().toISOString(), steps: freshSteps() };
    void pipeline()
      .catch((e) => {
        state = { ...state, error: e instanceof Error ? e.message.slice(0, 200) : "The audio pipeline stopped" };
      })
      .finally(() => {
        state = { ...state, running: false };
        persist();
      });
    return state;
  }

  /** Stream one of the pipeline's own files. Names are a fixed whitelist. */
  function file(name: string) {
    const sfx = name.match(/^sfx\/([a-z-]+)\.mp3$/);
    let path: string;
    let type: string;
    if (sfx && (SFX_NAMES as string[]).includes(sfx[1])) {
      path = join(sfxDir, `${sfx[1]}.mp3`);
      type = "audio/mpeg";
    } else if (name === "hook-voice.mp3") {
      path = join(outDir, name);
      type = "audio/mpeg";
    } else if (name === "reel-A-sfx.mp4") {
      path = join(outDir, name);
      type = "video/mp4";
    } else throw new Error("Invalid audio file");
    if (!existsSync(path)) throw new Error("Invalid audio file");
    return { stream: createReadStream(path), bytes: statSync(path).size, type };
  }

  return { sfxLibrary, status, start, remix, file };
}
