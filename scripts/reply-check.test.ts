import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPrompt, isQuestion, parseCheck } from "./reply-check";
import { chunkTranscript, excerptsFor, keywords, transcriptStore } from "./youtube-transcripts";

test("questions and money talk get checked, plain praise does not", () => {
  expect(isQuestion("Is this completely free?")).toBe(true);
  expect(isQuestion("does it work on windows")).toBe(true);
  expect(isQuestion("I assume I need the paid plan for this")).toBe(true);
  expect(isQuestion("Love this video man")).toBe(false);
  expect(isQuestion("")).toBe(false);
});

test("the check prompt carries the excerpts and the parser accepts only clear verdicts", () => {
  const prompt = checkPrompt({ comment: "Is it free?", draft: "yes totally free", videoTitle: "Build JARVIS", excerpts: ["you need the twenty dollar plan for this"] });
  expect(prompt.user).toContain("- you need the twenty dollar plan for this");
  expect(prompt.user).toContain("DRAFT REPLY: yes totally free");
  expect(parseCheck('{"verdict":"contradicted","evidence":"you need the twenty dollar plan","reply":"it needs the $20 plan bro — worth it"}')).toEqual({ verdict: "contradicted", evidence: "you need the twenty dollar plan", reply: "it needs the $20 plan bro , worth it" });
  expect(parseCheck('{"verdict":"supported","evidence":"","reply":"ignored"}')).toEqual({ verdict: "supported" });
  expect(() => parseCheck('{"verdict":"maybe"}')).toThrow();
});

test("excerpts pick the transcript windows that share words with the question", () => {
  const filler = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const text = `${filler} the whole thing is completely free you do not pay anything ${filler} later on you install the plugin`;
  expect(keywords("Is this completely free?")).toEqual(["completely", "free"]);
  expect(chunkTranscript(text).length).toBeGreaterThan(3);
  const picked = excerptsFor({ text }, "Is this completely free?", 2);
  expect(picked.length).toBeGreaterThan(0);
  expect(picked.join(" ")).toContain("completely free");
  expect(excerptsFor({ text: "" }, "anything")).toEqual([]);
});

test("transcripts are fetched once, saved with the repo, and a video without captions is remembered", async () => {
  const root = mkdtempSync(join(tmpdir(), "transcripts-"));
  let fetches = 0;
  const store = transcriptStore(root, {
    gapMs: 0,
    fetch: async (videoId) => {
      fetches++;
      if (videoId === "nocaption12") { const error = new Error("This video has no transcript.") as Error & { kind?: string }; error.kind = "none"; throw error; }
      return { videoId, fetchedAt: "2026-09-19T00:00:00Z", text: "hello there this is the video", segments: [{ start: 0, text: "hello there this is the video" }] };
    },
  });
  const first = await store.get("dQw4w9WgXcQ");
  expect(first?.text).toBe("hello there this is the video");
  expect(existsSync(join(root, "data", "youtube-transcripts", "dQw4w9WgXcQ.json"))).toBe(true);
  await store.get("dQw4w9WgXcQ");
  expect(fetches).toBe(1);
  expect(await store.get("nocaption12")).toBeUndefined();
  expect(JSON.parse(readFileSync(join(root, "data", "youtube-transcripts", "nocaption12.json"), "utf8")).error).toBe("This video has no transcript.");
  expect(await store.get("not a video")).toBeUndefined();
  expect(store.count()).toBe(2);
});
