import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lessonRuleId, mergeBooks, parseBook, parseRefined, parseRule, rulePrompt, rulesBlock, voiceRules, emptyBook, REFINE_EVERY } from "./voice-rules";
import type { VoiceLesson } from "./voice-lessons";

const lesson = (over: Partial<VoiceLesson> = {}): VoiceLesson => ({ at: "2026-09-20T10:00:00Z", source: "youtube", who: "Sam", theirMessage: "is the course free?", generated: "Hey Sam! Great question. The course is $87 a month. Let me know if you have any other questions!", final: "heyy Sam, it's $87 a month bro", ...over });

function setup() {
  const root = mkdtempSync(join(tmpdir(), "rules-"));
  const home = mkdtempSync(join(tmpdir(), "rules-home-"));
  mkdirSync(join(home, ".config"), { recursive: true });
  writeFileSync(join(home, ".config", "agentic-os.env"), "OPENROUTER_API_KEY=test-key\n");
  return { root, home };
}

test("an edited draft becomes one rule with its evidence, written once, and every queue reads it", async () => {
  const { root, home } = setup();
  const calls: string[] = [];
  const request: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(String(body.messages[0].content).slice(0, 10));
    expect(body.model).toBe("anthropic/claude-haiku-4.5");
    expect(String(body.messages[1].content)).toContain("They sent instead");
    return Response.json({ choices: [{ message: { content: '{"rule":"Open with heyy and the first name, answer in one line, no closing offer to help.","scope":"all"}' } }] });
  };
  const rules = voiceRules(root, { homeDir: home, request, now: () => Date.parse("2026-09-20T10:00:00Z") });
  const made = await rules.learn(lesson());
  expect(made?.rule).toContain("heyy");
  expect(made?.scope).toBe("all");
  expect(made?.id).toBe(lessonRuleId(lesson()));
  // The same edit again (or from the other machine) costs nothing and adds nothing.
  await rules.learn(lesson());
  expect(calls).toHaveLength(1);
  expect(rules.count()).toBe(1);
  const md = readFileSync(join(root, "data", "voice", "rules.md"), "utf8");
  expect(md).toContain("# Rules learned from Jack's edits");
  expect(md).toContain("draft said:");
  expect(md).toContain("Jack sent:");
  expect(rules.block("youtube")).toContain("1. Open with heyy");
  expect(rules.block("youtube")).toContain("OWNER'S OWN EDITS");
});

test("a rule scoped to one place keeps that scope, and an edit that teaches nothing is remembered as such", async () => {
  const { root, home } = setup();
  let reply = '{"rule":"In comment replies, end with a question about what they are building.","scope":"youtube"}';
  const request: typeof fetch = async () => Response.json({ choices: [{ message: { content: reply } }] });
  const rules = voiceRules(root, { homeDir: home, request });
  await rules.learn(lesson());
  expect(rules.read().rules[0].scope).toBe("youtube");
  expect(rules.block("youtube")).toContain("end with a question");
  reply = '{"rule":"","scope":"all"}';
  const tiny = lesson({ generated: "Thanks Sam!", final: "Thanks Sam" });
  expect(await rules.learn(tiny)).toBeUndefined();
  expect(rules.read().retired).toContain(lessonRuleId(tiny));
  expect(await rules.catchUp([lesson(), tiny])).toBe(0);
});

test("catch-up writes rules for lessons that have none, and refinement merges the book every few edits", async () => {
  const { root, home } = setup();
  const models: string[] = [];
  const request: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    if (String(body.messages[0].content).startsWith("Voice rule book")) {
      const ids = [...String(body.messages[1].content).matchAll(/\[([0-9a-f]{16})\]/g)].map(m => m[1]);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ rules: [{ rule: "Keep it to one line and drop the closing offer.", scope: "all", from: ids }, { rule: "Use their first name after heyy.", scope: "youtube", from: [] }] }) } }] });
    }
    return Response.json({ choices: [{ message: { content: '{"rule":"Cut the closing offer to help.","scope":"all"}' } }] });
  };
  const rules = voiceRules(root, { homeDir: home, request, now: () => Date.parse("2026-09-20T12:00:00Z") });
  const lessons = Array.from({ length: REFINE_EVERY }, (_, i) => lesson({ generated: `draft ${i} with a closing offer`, final: `sent ${i}` }));
  expect(await rules.catchUp(lessons)).toBe(REFINE_EVERY);
  expect(rules.count()).toBe(REFINE_EVERY);
  expect(await rules.refine(lessons)).toBe(true);
  const book = rules.read();
  expect(book.rules.map(r => r.rule)).toEqual(["Keep it to one line and drop the closing offer.", "Use their first name after heyy."]);
  expect(book.rules[0].refinedFrom).toHaveLength(REFINE_EVERY);
  expect(book.retired).toHaveLength(REFINE_EVERY);
  expect(book.lessonsRefined).toBe(REFINE_EVERY);
  expect(models.filter(m => m === "anthropic/claude-sonnet-5")).toHaveLength(1);
  // Not again until five more edits.
  expect(await rules.refine(lessons)).toBe(false);
  expect(existsSync(join(root, "data", "voice", "rules.md"))).toBe(true);
});

test("two machines' books merge by union, and what either side retired stays gone", () => {
  const a = parseBook(JSON.stringify({ version: 1, updatedAt: "2026-09-20T10:00:00Z", rules: [{ id: "a1", scope: "all", rule: "A", evidence: {}, at: "2026-09-20T10:00:00Z" }, { id: "old", scope: "all", rule: "Old", evidence: {}, at: "2026-09-19T10:00:00Z" }], retired: [], lessonsRefined: 3 }));
  const b = parseBook(JSON.stringify({ version: 1, updatedAt: "2026-09-20T11:00:00Z", rules: [{ id: "b1", scope: "youtube", rule: "B", evidence: {}, at: "2026-09-20T11:00:00Z" }], retired: ["old"], lessonsRefined: 5 }));
  const merged = mergeBooks(a, b);
  expect(merged.rules.map(r => r.id)).toEqual(["a1", "b1"]);
  expect(merged.retired).toEqual(["old"]);
  expect(merged.updatedAt).toBe("2026-09-20T11:00:00Z");
  expect(merged.lessonsRefined).toBe(5);
  expect(parseBook("not json")).toEqual(emptyBook());
  expect(rulesBlock(emptyBook(), "youtube")).toBe("");
  // A rule saved for a place this edition no longer drafts for is dropped on read.
  expect(parseBook(JSON.stringify({ version: 1, updatedAt: "", rules: [{ id: "gone", scope: "forum", rule: "Old", evidence: {}, at: "" }], retired: [], lessonsRefined: 0 })).rules).toEqual([]);
});

test("model output is parsed strictly: bad JSON, empty rules and unknown ids are dropped", () => {
  expect(parseRule("no json here", "youtube")).toBeUndefined();
  expect(parseRule('Sure! {"rule":"Say hi first — always.","scope":"weird"}', "youtube")).toEqual({ rule: "Say hi first, always.", scope: "youtube" });
  expect(parseRefined('{"rules":[{"rule":"","scope":"all"},{"rule":"Keep it short.","scope":"nope","from":["known","unknown"]}]}', new Set(["known"]))).toEqual([{ rule: "Keep it short.", scope: "all", from: ["known"] }]);
  expect(parseRefined('{"rules":[]}', new Set())).toBeUndefined();
  const prompt = rulePrompt(lesson({ source: "youtube" }));
  expect(prompt.user).toContain("YouTube comments");
  expect(prompt.system.startsWith("Voice rule")).toBe(true);
});
