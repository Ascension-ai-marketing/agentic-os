import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationStore } from "./conversations";
test("full conversations survive a new store, preserve source gating, upsert idempotently and delete only the selected thread", () => {
  const root = mkdtempSync(join(tmpdir(), "saved-chat-"));
  try {
    const store = conversationStore(root),
      messages = Array.from({ length: 45 }, (_, i) => ({
        role: i % 2 ? "oracle" : "user",
        text: "Message " + i,
        brainRevision: 4,
        sourceIds: ["codex"],
        via: "deepseek",
      }));
    const one = store.save({ messages, modelKey: "deepseek:model" });
    store.save({ id: one.id, revision: one.revision, messages, title: "Launch plan" });
    const two = store.save({
      messages: [{ role: "user", text: "Independent thread", brainRevision: 5 }],
    });
    const restored = conversationStore(root).list();
    expect(restored).toHaveLength(2);
    expect(restored.find((c) => c.id === one.id)?.messages).toHaveLength(45);
    expect(restored.find((c) => c.id === one.id)?.messages[20].sourceIds).toEqual(["codex"]);
    expect(restored.find((c) => c.id === one.id)?.messages[20].brainRevision).toBe(4);
    expect(restored.find((c) => c.id === one.id)?.modelKey).toBe("deepseek:model");
    expect(statSync(join(root, ".operator-data/conversations.json")).mode & 0o777).toBe(0o600);
    store.remove(one.id);
    expect(store.list().map((c) => c.id)).toEqual([two.id]);
    expect(() => store.save({ id: "../../escape", messages: [] })).toThrow();
    expect(() =>
      store.save({ messages: [{ role: "system", text: "Injected instructions" }] }),
    ).toThrow();
    const file = join(root, ".operator-data/conversations.json");
    writeFileSync(file, "corrupt");
    expect(() => store.save({ messages: [] })).toThrow("left untouched");
    expect(readFileSync(file, "utf8")).toBe("corrupt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale tabs cannot overwrite newer turns and an uncertain identical save can retry", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-conflict-"));
  try {
    const store = conversationStore(root),
      base = store.save({ messages: [{ role: "user", text: "Original question" }] }),
      tabA = {
        ...base,
        messages: [...base.messages, { role: "oracle", text: "Answer from tab A" }],
      },
      saved = store.save(tabA);
    expect(saved.revision).toBe(2);
    expect(() =>
      store.save({
        ...base,
        messages: [...base.messages, { role: "user", text: "Stale tab B question" }],
      }),
    ).toThrow("changed in another tab");
    expect(store.list()[0].messages[1].text).toBe("Answer from tab A");
    expect(store.save(tabA).revision).toBe(2);
    expect(store.list()).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pins persist across reloads and legacy callers, unpin safely, and reject stale changes", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-pin-"));
  try {
    const store = conversationStore(root);
    const original = store.save({ title: "Important plan", messages: [{ role: "user", text: "Keep this plan" }] });
    const pinRequest = { ...original, pinned: true };
    const pinned = store.save(pinRequest);
    expect(conversationStore(root).list()[0].pinned).toBe(true);
    expect(store.save(pinRequest).revision).toBe(pinned.revision);
    expect(() => store.save({ ...original, pinned: false })).toThrow("changed in another tab");
    const { pinned: ignored, ...legacy } = pinned;
    const appended = store.save({ ...legacy, messages: [...legacy.messages, { role: "oracle", text: "Plan retained" }] });
    expect(appended.pinned).toBe(true);
    expect(appended.messages).toHaveLength(2);
    const unpinned = store.save({ ...appended, pinned: false });
    expect(conversationStore(root).list()[0].pinned).toBe(false);
    expect(unpinned.messages).toEqual(appended.messages);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renaming a saved conversation preserves every message and rejects a stale title edit", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-rename-"));
  try {
    const store = conversationStore(root);
    const original = store.save({
      title: "Original title",
      modelKey: "claude|codex|synthetic",
      persona: "advisor",
      messages: [
        {
          role: "user",
          text: "Synthetic message",
          sourceIds: ["synthetic-source"],
          brainRevision: 3,
        },
        { role: "oracle", text: "Synthetic reply", via: "Codex" },
      ],
    });
    const renamed = store.save({ ...original, title: "Updated title" });
    const restored = conversationStore(root).list()[0];
    expect(restored.title).toBe("Updated title");
    expect(restored.messages).toEqual(original.messages);
    expect(restored.createdAt).toBe(original.createdAt);
    expect(restored.modelKey).toBe(original.modelKey);
    expect(restored.persona).toBe(original.persona);
    expect(renamed.revision).toBe(original.revision + 1);
    expect(() => store.save({ ...original, title: "Stale title" })).toThrow(
      "changed in another tab",
    );
    expect(store.list()[0]).toEqual(restored);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
