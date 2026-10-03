#!/usr/bin/env bun
/**
 * sync-voice.ts
 *
 * End-of-day sync for what the OS learned: commits data/voice/ (guides, examples,
 * this machine's lessons) and data/youtube-transcripts/, pulls the other machine's
 * learning from the private repo, resolves the two kinds of file the OS writes,
 * and pushes. Code changes are never committed here; only these data folders.
 *
 *   bun run scripts/sync-voice.ts            # sync now
 *   bun run scripts/sync-voice.ts --dry-run  # show what would happen
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { mergeLessons, writeVoice, type VoiceLesson } from "./voice-lessons";
import { mergeBooks, parseBook, writeBook } from "./voice-rules";

const REPO = resolve(import.meta.dir, "..");
const REMOTE = process.env.AGENTIC_VOICE_REMOTE || "private";
const BRANCH = process.env.AGENTIC_VOICE_BRANCH || "main";
const PATHS = ["data/voice", "data/youtube-transcripts"];
const DRY = process.argv.includes("--dry-run");

function git(args: string[], allowFail = false) {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
  if (result.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} failed:\n${(result.stderr || result.stdout || "").trim()}`);
  return { code: result.status ?? 1, out: (result.stdout || "").trim(), err: (result.stderr || "").trim() };
}
function log(line: string) { console.log(`[voice-sync ${new Date().toISOString().slice(0, 19)}] ${line}`); }

/** Two versions of a voice file: the newer guide wins, examples come from the same version. */
export function pickVoice(ours: string, theirs: string) {
  const parse = (text: string) => { try { return JSON.parse(text); } catch { return undefined; } };
  const a = parse(ours), b = parse(theirs);
  if (!a) return b; if (!b) return a;
  const stamp = (v: any) => String(v.updatedAt || v.builtAt || "");
  return stamp(b) > stamp(a) ? b : a;
}
/** Two versions of a lessons file: keep every correction from both. */
export function unionLessons(ours: string, theirs: string) {
  const parse = (text: string): VoiceLesson[] => { try { const v = JSON.parse(text); return Array.isArray(v?.lessons) ? v.lessons : []; } catch { return []; } };
  return { version: 1, lessons: mergeLessons([...parse(ours), ...parse(theirs)]) };
}
function conflicted(): string[] {
  return git(["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
}
function stageVersion(file: string, ref: ":2" | ":3") {
  return git(["show", `${ref}:${file}`], true).out;
}
function resolveConflicts() {
  const files = conflicted();
  const unresolved: string[] = [];
  for (const file of files) {
    if (!file.startsWith("data/voice/") && !file.startsWith("data/youtube-transcripts/")) { unresolved.push(file); continue; }
    const ours = stageVersion(file, ":2"), theirs = stageVersion(file, ":3");
    const full = join(REPO, file);
    if (/-lessons(\.[^.]+)?\.json$/.test(file)) writeFileSync(full, JSON.stringify(unionLessons(ours, theirs), null, 2));
    else if (file === "data/voice/rules.json") writeBook(full, mergeBooks(parseBook(ours), parseBook(theirs)));
    else if (file.endsWith(".json") && file.startsWith("data/voice/")) { const chosen = pickVoice(ours, theirs); if (chosen) writeVoice(full, chosen, chosen.title || file); }
    else if (file.endsWith(".md")) { /* Rebuilt from the JSON next to it below; take theirs meanwhile. */ writeFileSync(full, theirs || ours); }
    else writeFileSync(full, theirs || ours);
    git(["add", file]);
  }
  return unresolved;
}

function main() {
  if (!existsSync(join(REPO, ".git"))) throw new Error(`${REPO} is not a git checkout.`);
  const machine = hostname().split(".")[0];
  log(`repo ${REPO} · remote ${REMOTE}/${BRANCH} · machine ${machine}${DRY ? " · dry run" : ""}`);
  const changes = git(["status", "--porcelain", "--", ...PATHS]).out;
  if (changes) {
    log(`local learning to commit:\n${changes}`);
    if (!DRY) {
      git(["add", "--", ...PATHS]);
      git(["commit", "-q", "-m", `Voice: ${machine} ${new Date().toISOString().slice(0, 10)}`, "--", ...PATHS]);
    }
  } else log("nothing new learned on this machine since the last sync");
  if (DRY) return;
  git(["fetch", REMOTE, BRANCH]);
  const behind = git(["rev-list", "--count", `HEAD..${REMOTE}/${BRANCH}`]).out;
  if (behind !== "0") {
    log(`pulling ${behind} commit(s) from the other machine`);
    const pull = git(["pull", "--rebase", "--autostash", REMOTE, BRANCH], true);
    if (pull.code !== 0) {
      const unresolved = resolveConflicts();
      if (unresolved.length) {
        git(["rebase", "--abort"], true);
        throw new Error(`Conflicts outside the voice folders: ${unresolved.join(", ")}. Resolve them by hand, then run the sync again.`);
      }
      const cont = spawnSync("git", ["rebase", "--continue"], { cwd: REPO, encoding: "utf8", env: { ...process.env, GIT_EDITOR: "true" } });
      if (cont.status !== 0) { git(["rebase", "--abort"], true); throw new Error(`Could not finish merging: ${(cont.stderr || cont.stdout || "").trim()}`); }
      log("merged both machines' learning");
    }
  }
  const ahead = git(["rev-list", "--count", `${REMOTE}/${BRANCH}..HEAD`]).out;
  if (ahead !== "0") { git(["push", REMOTE, `HEAD:${BRANCH}`]); log(`pushed ${ahead} commit(s)`); } else log("already in sync");
}

if (import.meta.main) {
  try { main(); } catch (error) { log(`FAILED: ${(error as Error).message}`); process.exit(1); }
}
