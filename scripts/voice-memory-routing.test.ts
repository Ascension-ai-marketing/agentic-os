import { expect, test } from "bun:test";
import { permitsRecentVoiceTool, recentMemoryQuery } from "../src/lib/voice-recent";
test("capability questions cannot trigger private recent-mail or creation panels", () => {
  for (const prompt of [
    "All right, what can you do?",
    "Can you help me?",
    "Tell me about yourself",
    "What did I just save?",
  ]) {
    expect(permitsRecentVoiceTool("emails", prompt)).toBe(false);
    expect(permitsRecentVoiceTool("creations", prompt)).toBe(false);
  }
  expect(permitsRecentVoiceTool("emails", "What was my latest email?")).toBe(true);
  expect(permitsRecentVoiceTool("creations", "Show the last image I created")).toBe(true);
});
test("recent memory recall is explicit and does not turn ordinary questions into recent searches", () => {
  for (const prompt of [
    "What did I just save?",
    "Tell me about my latest memory",
    "What I just added",
  ])
    expect(recentMemoryQuery(prompt)).toBe(true);
  expect(recentMemoryQuery("What was our launch plan?")).toBe(false);
});
