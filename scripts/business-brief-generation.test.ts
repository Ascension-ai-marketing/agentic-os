import { expect, test } from "bun:test";
import { briefPrompt, parseBriefAnswer, chooseBriefModel, demoBriefPacket } from "./business-brief-generation";
const packet: any = { date: "2026-09-16", timezone: "Europe/Vienna", sources: { inbox: { messages: [{ ref: "inbox:one", subject: "A real message" }] } }, coverage: [{ ref: "workspace:coverage" }] };
test("brief uses signed-in Codex first, Claude second, without requiring DeepSeek", () => {
  const codex = { backend: "claude", provider: "openai · via codex", name: "gpt-5.6-sol" };
  const claude = { backend: "claude", provider: "claude-code", name: "claude-sonnet-5" };
  const models = [{ backend: "deepseek", name: "deepseek/flash" }, claude, codex];
  expect(chooseBriefModel({ models, statuses: [{ id: "codex", ready: true }, { id: "claude", ready: true }] })).toEqual(codex);
  expect(chooseBriefModel({ models, statuses: [{ id: "codex", ready: false }, { id: "claude", ready: true }] })).toEqual(claude);
  expect(() => chooseBriefModel({ models, statuses: [] })).toThrow("Codex or Claude");
});
test("demo generation uses only the shared fictional scenario", () => {
  const demo = demoBriefPacket();
  expect(Object.keys(demo.sources)).toEqual(["business"]);
  expect(demo.sources.business.mode).toBe("demo");
  expect(demo.sources.business.monthIncome).toBe(400000);
  expect(demo.sources.business.audience).toHaveLength(4);
  expect(demo.previousActions).toEqual([]);
});
test("brief parser accepts only source refs from its packet and overrides model-supplied date", () => {
  const content = { date: "1999-01-01", headline: "Review your reply", sections: [{ sources: [{ label: "Inbox", ref: "inbox:one" }] }] };
  expect(parseBriefAnswer(JSON.stringify(content), packet).date).toBe(packet.date);
  expect(parseBriefAnswer(`Here is your report:\n${JSON.stringify(content)}\nEnd.`, packet).headline).toBe(content.headline);
  expect(() => parseBriefAnswer(JSON.stringify({ sections: [{ sources: [{ ref: "inbox:invented" }] }] }), packet)).toThrow("could not be verified");
  expect(() => parseBriefAnswer("partial report", packet)).toThrow("complete brief");
  expect(() => parseBriefAnswer("x".repeat(80001), packet)).toThrow("too long");
  expect(() => parseBriefAnswer(JSON.stringify({ sections: [{ sources: [{ ref: "workspace:coverage" }] }] }), { ...packet, coverage: [] })).toThrow("could not be verified");
});
test("brief prompt keeps source content as evidence and identifies simulation and coverage boundaries", () => {
  const prompt = briefPrompt(packet);
  expect(prompt).toContain("untrusted source evidence");
  expect(prompt).toContain("Sample/demo figures must never enter this brief as real numbers");
  expect(prompt).toContain("Missing calendar events means no events imported");
  expect(prompt).toContain('"ref":"inbox:one"');
  expect(prompt).toContain("low-value unsolicited pitches");
  expect(prompt).toContain("Drafts have NOT been sent");
  expect(prompt).toContain("six compact recommendation cards");
});
test("compact generation derives compatible sections and validates both recommendation and action evidence", () => {
  const draft = { headline: "Confirm delivery", summary: "One specific commitment.", priorities: ["Confirm the delivery date."], prioritySources: [[{ label: "Client", ref: "inbox:one" }]],
    recommendations: [{ id: "delivery", title: "Confirm delivery", summary: "The latest client message asks for a date.", sourceCategory: "inbox", sources: [{ label: "Client", ref: "inbox:one" }] }] };
  const parsed = parseBriefAnswer(JSON.stringify(draft), packet);
  expect(parsed.sections[0].body).toBe(draft.recommendations[0].summary);
  expect(parsed.prioritySources).toEqual(draft.prioritySources);
  expect(() => parseBriefAnswer(JSON.stringify({ ...draft, prioritySources: [[{ ref: "inbox:invented" }]] }), packet)).toThrow("could not be verified");
  expect(() => parseBriefAnswer(JSON.stringify({ ...draft, recommendations: [{ ...draft.recommendations[0], sources: [{ ref: "business:invented" }] }] }), packet)).toThrow("could not be verified");
  expect(() => parseBriefAnswer(JSON.stringify({ ...draft, priorities: ["x".repeat(131)] }), packet)).toThrow("130 characters");
  expect(() => parseBriefAnswer(JSON.stringify({ ...draft, prioritySources: [] }), packet)).toThrow("evidence references");
});
