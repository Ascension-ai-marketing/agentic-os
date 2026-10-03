import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractChatAttachment, validateChatAttachments } from "./chat-attachments";
import { attachmentContext, CHAT_ATTACHMENT_TEXT } from "../src/lib/chat-attachments";
import { conversationStore } from "./conversations";
const input = (filename: string, text: string) => ({
  filename,
  base64: Buffer.from(text).toString("base64"),
});
test("text attachments extract locally, sanitize filenames and preserve text after a conversation reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "attachment-test-"));
  try {
    const file = await extractChatAttachment(
      root,
      input("../../launch.md", "# Plan\nLaunch Friday"),
    );
    expect(file.name).toBe("launch.md");
    expect(file.text).toContain("Launch Friday");
    expect(file.origin).toBe("files");
    const store = conversationStore(root),
      snapshot = { messages: [{ role: "user", text: "Review my plan", attachments: [file] }] };
    const saved = store.save(snapshot);
    expect(conversationStore(root).list()[0].messages[0].attachments).toEqual([file]);
    expect(store.save({ ...snapshot, id: saved.id }).revision).toBe(saved.revision);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("unsupported, malformed, binary and empty attachments fail before model or persistence work", async () => {
  for (const body of [
    input("a.exe", "binary"),
    input("a.txt", ""),
    input("a.txt", "hello\0world"),
    input("a.pdf", "not PDF"),
    input("a.png", "not image"),
    { filename: "a.txt", base64: "%%%" },
  ])
    await expect(extractChatAttachment("/not-used", body)).rejects.toThrow();
});
test("large readable files expose their truncation, saved metadata rejects oversize or wrong source types", async () => {
  const file = await extractChatAttachment(
    "/not-used",
    input("a.txt", "a".repeat(CHAT_ATTACHMENT_TEXT + 10)),
  );
  expect(file.text).toHaveLength(CHAT_ATTACHMENT_TEXT);
  expect(file.truncated).toBe(true);
  expect(() => validateChatAttachments([{ ...file, origin: "email" }])).toThrow();
  expect(() =>
    validateChatAttachments([{ ...file, text: "x".repeat(CHAT_ATTACHMENT_TEXT + 1) }]),
  ).toThrow();
  expect(() => validateChatAttachments(Array(7).fill(file))).toThrow();
});
test("attachment evidence respects source switches and total prompt budget", async () => {
  const file = await extractChatAttachment("/not-used", input("a.txt", "private document"));
  expect(attachmentContext([file], () => false)).toBe("");
  expect(attachmentContext([file], (origin) => origin === "files")).toContain("private document");
  const image = { ...file, kind: "image" as const, origin: "images" as const };
  expect(attachmentContext([image], () => true)).toContain("no visual analysis");
  const long = { ...file, text: "x".repeat(CHAT_ATTACHMENT_TEXT) };
  expect(
    attachmentContext(Array(6).fill(long), () => true).match(/x/g)?.length,
  ).toBeLessThanOrEqual(50010);
});

test("failed PDF extraction removes its temporary originals", async () => {
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("agentic-chat-")));
  await expect(
    extractChatAttachment("/not-used", input("broken.pdf", "%PDF-invalid")),
  ).rejects.toThrow("could not be read locally");
  expect(
    readdirSync(tmpdir()).filter((name) => name.startsWith("agentic-chat-") && !before.has(name)),
  ).toEqual([]);
});
