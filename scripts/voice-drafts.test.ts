import { expect, test } from "bun:test";
import { FALLBACK_GUIDE, pickExamples, voicePrompt } from "./voice-drafts";

test("examples are spread across short, medium and long replies", () => {
  const replies = [
    { content: "Thanks man!" },
    { content: "Great question, the setup video covers it step by step." },
    { content: "Happy to help. Start with the first lesson, then send me what you built and I will take a look this week." },
    { content: "x".repeat(260) },
  ];
  const picked = pickExamples(replies, 3);
  expect(picked.length).toBeGreaterThan(0);
  expect(picked.every(p => replies.some(r => r.content === p))).toBe(true);
});

test("the voice prompt carries every reply and the fallback guide never uses an em dash", () => {
  const { system, user } = voicePrompt(["Howdy brother", "Let me check and come back to you"], []);
  expect(system.length).toBeGreaterThan(0);
  expect(user).toContain("- Howdy brother");
  expect(user).toContain("- Let me check and come back to you");
  expect(FALLBACK_GUIDE).not.toContain("—");
});
