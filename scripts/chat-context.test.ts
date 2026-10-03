import { expect, test } from "bun:test";
import { chatContextEligible } from "../src/lib/chat-context";
import { validateChatPrompt } from "./chat-request";

test("disabled, deleted, stale and interrupted evidence cannot re-enter a turn or Memory", () => {
  const workspace = {
    brainRevision: 4,
    brainSources: { files: true },
    sources: [{ id: "doc", origin: "files" }],
  };
  const turn = { brainRevision: 4, sourceIds: ["doc"] };
  expect(chatContextEligible(turn, workspace)).toBe(true);
  expect(chatContextEligible({ ...turn, brainRevision: 3 }, workspace)).toBe(false);
  expect(chatContextEligible({ ...turn, via: "needs attention" }, workspace)).toBe(false);
  expect(chatContextEligible(turn, { ...workspace, brainSources: { files: false } })).toBe(false);
  expect(
    chatContextEligible(turn, {
      ...workspace,
      sources: [{ ...workspace.sources[0], deletedAt: "now" }],
    }),
  ).toBe(false);
  expect(chatContextEligible({ ...turn, sourceIds: ["removed"] }, workspace)).toBe(false);
  const attached = {
    brainRevision: 4,
    attachments: [
      {
        id: "file",
        name: "a.txt",
        text: "saved excerpt",
        bytes: 13,
        kind: "document" as const,
        origin: "files" as const,
        truncated: false,
      },
    ],
  };
  expect(chatContextEligible(attached, workspace)).toBe(true);
  expect(chatContextEligible(attached, { ...workspace, brainSources: { files: false } })).toBe(
    false,
  );
});

test("CLI prompt validation accepts bounded context and rejects invalid or oversized Unicode input", () => {
  expect(validateChatPrompt("context ".repeat(12000)).length).toBeGreaterThan(12000);
  for (const invalid of [null, 123, {}, " ", "👩‍💻".repeat(10000)])
    expect(() => validateChatPrompt(invalid)).toThrow();
});
