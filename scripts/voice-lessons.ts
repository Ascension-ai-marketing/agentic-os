import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Lessons are the operator's own corrections: a generated draft next to what
 * they actually sent. They are shown to the drafting model on every run and
 * folded into the voice guide every few edits, so the queue gets closer to the
 * operator's real voice each time they fix a draft.
 */
export type VoiceLesson = {
  at: string;
  source: "youtube";
  who: string;
  theirMessage: string;
  generated: string;
  final: string;
};
const MAX_LESSONS = 400;
const CLIP = 600;

function readLessonFile(file: string): VoiceLesson[] {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(value?.lessons) ? value.lessons.filter((l: any) => l && typeof l.generated === "string" && typeof l.final === "string") : [];
  } catch { return []; }
}
/** Lessons from every machine, merged: `<name>-lessons.json` plus every `<name>-lessons.<machine>.json` beside it. */
export function readLessons(file: string): VoiceLesson[] {
  const stem = basename(file).replace(/-lessons(\.[^.]+)?\.json$/, "-lessons");
  const directory = dirname(file);
  let files: string[] = [];
  try { files = readdirSync(directory).filter(name => name === `${stem}.json` || (name.startsWith(`${stem}.`) && name.endsWith(".json"))).map(name => join(directory, name)); } catch { files = existsSync(file) ? [file] : []; }
  if (!files.length && existsSync(file)) files = [file];
  return mergeLessons(files.flatMap(readLessonFile));
}
/** Same correction seen on two machines counts once; newest last. */
export function mergeLessons(lessons: VoiceLesson[]): VoiceLesson[] {
  const seen = new Set<string>();
  return lessons
    .filter(l => { const key = `${l.generated.trim()}\u0000${l.final.trim()}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-MAX_LESSONS);
}
/** A short, file-safe name for this machine, so each computer appends to its own lessons file. */
export function machineSlug() {
  return (hostname().split(".")[0] || "machine").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "machine";
}
/** Records a correction once; identical generated/final pairs are ignored. Returns the lesson count. */
export function recordLesson(file: string, lesson: Omit<VoiceLesson, "at">): number {
  const generated = lesson.generated.trim(), final = lesson.final.trim();
  const everywhere = readLessons(file);
  if (!generated || !final || generated === final) return everywhere.length;
  if (everywhere.some(l => l.generated.trim() === generated && l.final.trim() === final)) return everywhere.length;
  // Only this machine's own file is written; the other machine's file is never touched, so git never sees a conflict.
  const mine = readLessonFile(file);
  mine.push({ at: new Date().toISOString(), source: lesson.source, who: lesson.who.slice(0, 120), theirMessage: lesson.theirMessage.slice(0, CLIP), generated: generated.slice(0, CLIP), final: final.slice(0, CLIP) });
  const kept = mine.slice(-MAX_LESSONS);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  // Pretty JSON: these files live in the repo and are read by people too.
  writeFileSync(tmp, JSON.stringify({ version: 1, lessons: kept }, null, 2), { mode: 0o644 });
  renameSync(tmp, file);
  return everywhere.length + 1;
}

/** Voice files live in the repo under data/voice/ so every machine writes as the same person. */
export function voicePaths(root: string, name: "youtube") {
  const directory = join(root, "data", "voice");
  return { directory, voice: join(directory, `${name}.json`), guide: join(directory, `${name}.md`), lessons: join(directory, `${name}-lessons.${machineSlug()}.json`) };
}
type VoiceLike = { version: 1; builtAt: string; guide: string; examples: string[]; sources: Record<string, number>; model?: string; updatedAt?: string; lessonsDistilled?: number };
/** Writes the voice JSON and a readable Markdown copy of the guide next to it. */
export function writeVoice(file: string, voice: VoiceLike, title: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(voice, null, 2), { mode: 0o644 });
  renameSync(tmp, file);
  const sources = Object.entries(voice.sources).map(([k, v]) => `${v} ${k}`).join(", ");
  const md = [`# ${title}`, "", `Built ${voice.builtAt.slice(0, 10)}${voice.updatedAt ? `, last updated ${voice.updatedAt.slice(0, 10)}` : ""} from ${sources}${voice.model ? ` with ${voice.model}` : ""}.`, "This file mirrors the JSON next to it; the JSON is what the OS reads. Edit the guide in the JSON, or rebuild it from the OS.", "", "## Guide", "", voice.guide.trim(), "", `## ${voice.examples.length} real examples shown to the model`, "", ...voice.examples.map(e => `- ${e.replace(/\s+/g, " ").trim()}`), ""].join("\n");
  writeFileSync(file.replace(/\.json$/, ".md"), md, { mode: 0o644 });
}
/** Reads a voice file; a copy left in the old per-machine folder is moved into the repo once. */
export function readVoiceFile<T extends VoiceLike>(file: string, legacy: string | undefined, title: string): T | undefined {
  const parse = (path: string): T | undefined => {
    try { const value = JSON.parse(readFileSync(path, "utf8")); return value?.version === 1 && typeof value.guide === "string" && Array.isArray(value.examples) ? value : undefined; } catch { return undefined; }
  };
  const current = parse(file);
  if (current) return current;
  if (legacy && existsSync(legacy)) {
    const old = parse(legacy);
    if (old) { try { writeVoice(file, old, title); } catch { /* Read from the old place this time. */ } return old; }
  }
  return undefined;
}
/** Lessons also move into the repo once, if an older per-machine file exists. */
export function migrateLessons(file: string, legacy: string) {
  if (existsSync(file) || !existsSync(legacy)) return;
  try { const old = readLessons(legacy); if (old.length) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ version: 1, lessons: old }, null, 2), { mode: 0o644 }); } } catch { /* Start fresh in the repo. */ }
}
/** The most recent corrections as a prompt block; empty when there are none. */
export function lessonsBlock(lessons: VoiceLesson[], max = 12): string {
  const recent = lessons.slice(-max);
  if (!recent.length) return "";
  const one = (text: string) => text.replace(/\s+/g, " ").trim();
  return [
    "CORRECTIONS THE OWNER MADE (they rewrote these drafts before sending; copy what changed, in wording, length and tone):",
    ...recent.map(l => `- ${one(l.who)} wrote: "${one(l.theirMessage).slice(0, 220)}"\n  draft: "${one(l.generated)}"\n  owner sent: "${one(l.final)}"`),
  ].join("\n");
}
/** Prompt that folds corrections into an existing voice guide. */
export function distillPrompt(guide: string, lessons: VoiceLesson[]) {
  const system = "You maintain a short voice guide that describes exactly how one person writes direct messages, so a writer can imitate them.";
  const user = [
    "Here is the current voice guide, followed by corrections the person made to drafts written from it (draft versus what they actually sent).",
    "Rewrite the guide so a writer following it would have produced the sent versions. Keep everything that still holds, tighten what the corrections contradict, and end with a short section titled 'What they change' listing the concrete patterns behind the corrections. At most 380 words. Output the guide only.",
    "",
    "CURRENT GUIDE:",
    guide,
    "",
    lessonsBlock(lessons, 30),
  ].join("\n");
  return { system, user };
}
