import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptable, parseLint, slopCleanse, splitCleanse } from "./slop-cleanse";

test("the linter output and the cleanse reply are read the way the tools print them", () => {
  expect(parseLint("35 words of visible copy\n\n  AI vocabulary:\n    · unlock  (1)\n    · journey  (2)\n\n  score 3/5  needs a cleanse\n")).toEqual({ score: 3, tells: ["unlock", "journey"] });
  expect(parseLint("10 words of visible copy\n\n\n  score 5/5  CLEAN\n")).toEqual({ score: 5, tells: [] });
  expect(parseLint("garbage")).toEqual({ score: 5, tells: [] });
  expect(splitCleanse("Heyy Sam, welcome in.\n\n<<<SLOPMONSTER-NOTES>>>\n- cut 'unlock'")).toEqual({ copy: "Heyy Sam, welcome in.", notes: "- cut 'unlock'" });
  expect(splitCleanse("Just the copy")).toEqual({ copy: "Just the copy", notes: "" });
});

test("a cleanse is kept only when it says the same thing in about the same space", () => {
  expect(acceptable("Welcome Luca, what are you building first?", "Welcome Luca. What are you building first?")).toBe(true);
  expect(acceptable("short", "this is now a very much longer piece of text that says far more than before, twice over")).toBe(false);
  expect(acceptable("see https://bit.ly/abc for the pack", "see the pack")).toBe(false);
  expect(acceptable("fine", "fine — with a dash")).toBe(false);
  expect(acceptable("fine", "fine\n<<<SLOPMONSTER-NOTES>>>")).toBe(false);
});

test("polish lints, cleanses with the rival model, re-lints, and keeps the original when the cleanse is worse", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-"));
  const home = mkdtempSync(join(tmpdir(), "slop-home-"));
  mkdirSync(join(home, ".config"), { recursive: true });
  writeFileSync(join(home, ".config", "agentic-os.env"), "OPENROUTER_API_KEY=k\n");
  const scores: Record<string, number> = { "Let's unlock your journey, Sam.": 3, "Let's get you going, Sam.": 5, "Already clean.": 5, "Now worse, unlock delve tapestry.": 1 };
  let models: string[] = [];
  const request: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    const text: string = body.messages[1].content;
    const reply = text.includes("Already clean.") ? "Now worse, unlock delve tapestry.\n<<<SLOPMONSTER-NOTES>>>\n- oops" : "Let's get you going, Sam.\n<<<SLOPMONSTER-NOTES>>>\n- cut unlock and journey";
    return Response.json({ choices: [{ message: { content: reply } }] });
  };
  const slop = slopCleanse(root, { homeDir: home, request, model: "openai/gpt-5.4-mini", lint: async text => ({ score: scores[text] ?? 5, tells: scores[text] && scores[text] < 5 ? ["unlock"] : [] }) });
  const out = await slop.polish([{ id: "a", text: "Let's unlock your journey, Sam." }, { id: "b", text: "Already clean." }], "test");
  expect(out.get("a")).toMatchObject({ text: "Let's get you going, Sam.", report: { before: 3, after: 5, changed: true, tells: ["unlock"] } });
  expect(out.get("b")).toMatchObject({ text: "Already clean.", report: { before: 5, after: 5, changed: false } });
  expect(models.every(m => m === "openai/gpt-5.4-mini")).toBe(true);
});
