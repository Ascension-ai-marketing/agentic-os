import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { executableCandidates } from "./assistant-runtime";
import { existsSync } from "node:fs";

/**
 * Transcripts of the operator's own videos, fetched once from YouTube's public
 * caption feed (no API quota) and kept under data/youtube-transcripts/ so they
 * travel with the repo and are never fetched twice. Used to check drafted
 * replies against what the video actually says.
 */

export type Transcript = {
  videoId: string;
  fetchedAt: string;
  language?: string;
  generated?: boolean;
  text: string;
  segments: { start: number; text: string }[];
  error?: string;
};
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FETCH_GAP_MS = 5000;
const BLOCK_PAUSE_MS = 15 * 60 * 1000;
const STOPWORDS = new Set("the and that this with from your have will what when where which does about there their they them then than just like into over also only some more very much been being were was are is it its for you can not but his her our out how why who did has had do".split(" "));

function atomicWrite(file: string, value: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o644 });
  renameSync(tmp, file);
}
export function keywords(text: string) {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9$ ]+/g, " ").split(/\s+/).filter(w => w.length >= 4 && !STOPWORDS.has(w)))];
}
/** Splits a transcript into overlapping windows of about `words` words. */
export function chunkTranscript(text: string, words = 70) {
  const all = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < all.length; i += Math.max(1, words - 15)) chunks.push(all.slice(i, i + words).join(" "));
  return chunks;
}
/** The transcript windows most related to a question, in video order; the opening when nothing matches. */
export function excerptsFor(transcript: { text: string }, query: string, max = 6) {
  const chunks = chunkTranscript(transcript.text);
  if (!chunks.length) return [];
  const terms = keywords(query);
  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    return { index, chunk, score: terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0) };
  });
  const best = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, max);
  if (!best.length) return chunks.slice(0, Math.min(3, max));
  return best.sort((a, b) => a.index - b.index).map(s => s.chunk);
}

export function transcriptStore(root: string, options: { fetch?: (videoId: string) => Promise<Transcript>; gapMs?: number } = {}) {
  const gapMs = options.gapMs ?? FETCH_GAP_MS;
  const directory = join(root, "data", "youtube-transcripts");
  const fileFor = (id: string) => join(directory, `${id}.json`);
  const memory = new Map<string, Transcript>();
  const inflight = new Map<string, Promise<Transcript | undefined>>();
  let lastFetch = 0;
  let blockedUntil = 0;

  let pythonWithHelper: Promise<string | undefined> | undefined;
  /** The first Python on this machine that can import the transcript helper; PATH order alone picks the wrong one on Macs with Homebrew. */
  function findPython(): Promise<string | undefined> {
    if (pythonWithHelper) return pythonWithHelper;
    pythonWithHelper = (async () => {
      const candidates = [...executableCandidates("python3"), ...executableCandidates("python"), "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"].filter((file, index, all) => all.indexOf(file) === index && existsSync(file));
      for (const file of candidates) {
        const ok = await new Promise<boolean>(done => {
          const probe = spawn(file, ["-c", "import youtube_transcript_api"], { stdio: "ignore" });
          const timer = setTimeout(() => { probe.kill(); done(false); }, 8000);
          probe.on("error", () => { clearTimeout(timer); done(false); });
          probe.on("close", code => { clearTimeout(timer); done(code === 0); });
        });
        if (ok) return file;
      }
      return undefined;
    })();
    return pythonWithHelper;
  }
  async function fetchViaPython(videoId: string): Promise<Transcript> {
    const python = await findPython();
    if (!python) { pythonWithHelper = undefined; throw new Error("The transcript helper is missing. Run: pip3 install youtube-transcript-api"); }
    return new Promise((resolvePromise, reject) => {
      const child = spawn(python, [resolve(root, "scripts", "youtube-transcript.py"), videoId], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("YouTube took too long to return the transcript.")); }, 60000);
      child.stdout.on("data", chunk => { if (out.length < 4_000_000) out += chunk; });
      child.stderr.on("data", chunk => { if (err.length < 20000) err += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => {
        clearTimeout(timer);
        let data: any;
        try { data = JSON.parse(out.trim().split("\n").pop() || "{}"); } catch { data = {}; }
        if (code === 0 && typeof data.text === "string" && Array.isArray(data.segments)) {
          return resolvePromise({ videoId, fetchedAt: new Date().toISOString(), language: data.language, generated: data.generated, text: data.text.slice(0, 400000), segments: data.segments.slice(0, 20000).map((s: any) => ({ start: Number(s.start) || 0, text: String(s.text || "") })) });
        }
        const error = new Error(String(data.error || err.trim().split("\n").pop() || "The transcript could not be read.")) as Error & { kind?: string };
        error.kind = data.kind || "other";
        reject(error);
      });
    });
  }
  async function get(videoId: string): Promise<Transcript | undefined> {
    if (!VIDEO_ID.test(videoId)) return undefined;
    const cached = memory.get(videoId);
    if (cached) return cached.error ? undefined : cached;
    try {
      const saved = JSON.parse(readFileSync(fileFor(videoId), "utf8"));
      if (saved?.videoId === videoId && typeof saved.text === "string") { memory.set(videoId, saved); return saved.error ? undefined : saved; }
    } catch { /* Not saved yet. */ }
    const pending = inflight.get(videoId);
    if (pending) return pending;
    if (Date.now() < blockedUntil) throw Object.assign(new Error(`YouTube is blocking transcript reads from this network for a while. Checks retry after ${Math.ceil((blockedUntil - Date.now()) / 60000)} minutes.`), { kind: "blocked" });
    const task = (async () => {
      const wait = gapMs - (Date.now() - lastFetch);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastFetch = Date.now();
      try {
        const transcript = await (options.fetch || fetchViaPython)(videoId);
        mkdirSync(directory, { recursive: true });
        atomicWrite(fileFor(videoId), transcript);
        memory.set(videoId, transcript);
        return transcript;
      } catch (error) {
        // A block pauses every fetch for a while so the block does not get longer.
        if (/IpBlocked|RequestBlocked|Too Many Requests|429/i.test((error as Error).message || "")) blockedUntil = Date.now() + BLOCK_PAUSE_MS;
        // Only a video that truly has no captions is remembered; blocks and outages are retried next time.
        if ((error as { kind?: string }).kind === "none") {
          const stub: Transcript = { videoId, fetchedAt: new Date().toISOString(), text: "", segments: [], error: (error as Error).message };
          mkdirSync(directory, { recursive: true });
          atomicWrite(fileFor(videoId), stub);
          memory.set(videoId, stub);
          return undefined;
        }
        throw error;
      } finally { inflight.delete(videoId); }
    })();
    inflight.set(videoId, task);
    return task;
  }
  function count() {
    try { return readdirSync(directory).filter(name => /^[A-Za-z0-9_-]{11}\.json$/.test(name)).length; } catch { return 0; }
  }
  return { get, count, directory };
}
