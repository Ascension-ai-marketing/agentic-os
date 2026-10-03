import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineSlug, mergeLessons, readLessons, recordLesson, voicePaths, writeVoice, readVoiceFile } from "./voice-lessons";
import { pickVoice, unionLessons } from "./sync-voice";

const lesson = (generated: string, final: string, at: string) => ({ at, source: "youtube" as const, who: "Sam", theirMessage: "hi", generated, final });

test("each machine writes its own lessons file and reading merges every machine's file", () => {
  const root = mkdtempSync(join(tmpdir(), "voice-"));
  const paths = voicePaths(root, "youtube");
  expect(paths.lessons.endsWith(`youtube-lessons.${machineSlug()}.json`)).toBe(true);
  mkdirSync(paths.directory, { recursive: true });
  // The other machine's file is already in the repo.
  writeFileSync(join(paths.directory, "youtube-lessons.desktop.json"), JSON.stringify({ version: 1, lessons: [lesson("draft A", "sent A", "2026-09-18T10:00:00Z")] }));
  expect(recordLesson(paths.lessons, { source: "youtube", who: "Sam", theirMessage: "hi", generated: "draft B", final: "sent B" })).toBe(2);
  // A correction the other machine already has is not written twice.
  expect(recordLesson(paths.lessons, { source: "youtube", who: "Sam", theirMessage: "hi", generated: "draft A", final: "sent A" })).toBe(2);
  const all = readLessons(paths.lessons);
  expect(all.map(l => l.final)).toEqual(["sent A", "sent B"]);
  const mine = JSON.parse(readFileSync(paths.lessons, "utf8")).lessons;
  expect(mine).toHaveLength(1);
  expect(existsSync(join(paths.directory, "youtube-lessons.desktop.json"))).toBe(true);
});

test("merging two machines' learning keeps every correction once and lets the newer guide win", () => {
  const merged = mergeLessons([lesson("a", "b", "2026-09-19T10:00:00Z"), lesson("a", "b", "2026-09-19T11:00:00Z"), lesson("c", "d", "2026-09-18T10:00:00Z")]);
  expect(merged.map(l => l.final)).toEqual(["d", "b"]);
  const union = unionLessons(JSON.stringify({ version: 1, lessons: [lesson("a", "b", "2026-09-19T10:00:00Z")] }), JSON.stringify({ version: 1, lessons: [lesson("x", "y", "2026-09-19T12:00:00Z")] }));
  expect(union.lessons.map(l => l.final)).toEqual(["b", "y"]);
  const older = { version: 1, builtAt: "2026-09-18T00:00:00Z", guide: "old", examples: [], sources: {} };
  const newer = { ...older, guide: "new", updatedAt: "2026-09-19T12:00:00Z" };
  expect(pickVoice(JSON.stringify(older), JSON.stringify(newer)).guide).toBe("new");
  expect(pickVoice(JSON.stringify(newer), JSON.stringify(older)).guide).toBe("new");
  expect(pickVoice("not json", JSON.stringify(older)).guide).toBe("old");
});

test("a voice file gets a readable Markdown twin and an old per-machine copy moves into the repo once", () => {
  const root = mkdtempSync(join(tmpdir(), "voice-"));
  const legacy = join(root, ".operator-data", "youtube-voice.json");
  mkdirSync(join(root, ".operator-data"), { recursive: true });
  writeFileSync(legacy, JSON.stringify({ version: 1, builtAt: "2026-09-19T00:00:00Z", guide: "Warm and short.", examples: ["Heyy Sam"], sources: { replies: 1, posts: 0 } }));
  const paths = voicePaths(root, "youtube");
  const voice = readVoiceFile(paths.voice, legacy, "YouTube comment voice");
  expect(voice?.guide).toBe("Warm and short.");
  expect(existsSync(paths.voice)).toBe(true);
  const md = readFileSync(paths.guide, "utf8");
  expect(md).toContain("# YouTube comment voice");
  expect(md).toContain("Warm and short.");
  expect(md).toContain("- Heyy Sam");
  writeVoice(paths.voice, { version: 1, builtAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", guide: "Updated.", examples: [], sources: { replies: 2 } }, "YouTube comment voice");
  expect(readFileSync(paths.guide, "utf8")).toContain("last updated 2026-09-20");
});
