import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationStore } from "./conversations";
import { chatContextEligible } from "../src/lib/chat-context";
import { selectedChatHistory } from "../src/lib/chat-context-selection";
import {
  createVoiceTranscriptStore,
  VOICE_TRANSCRIPT_PREFIX,
  type VoiceTranscript,
} from "../src/lib/voice-transcript-store";

class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(i: number) {
    return [...this.values.keys()][i] || null;
  }
  getItem(key: string) {
    return this.values.get(key) || null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "voice-transcript-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const storage = new MemoryStorage(),
    api = conversationStore(root);
  const save = async (snapshot: VoiceTranscript) => ({
    conversation: api.save(snapshot) as VoiceTranscript,
  });
  function make(custom: Partial<Parameters<typeof createVoiceTranscriptStore>[0]> = {}) {
    const writer = createVoiceTranscriptStore({ storage, save, debounceMs: 60000, ...custom });
    cleanups.push(() => writer.dispose());
    return writer;
  }
  return { root, storage, api, save, make };
}
const scoped = { brainRevision: 7, contextKey: "chat1:1:101111", sourceIds: ["fixture-memory"] };
const unknown = { brainRevision: 7, contextReusable: false };

test("final voice text reloads in the existing Chat store with exact scoped provenance, no model override or foreign fields", async () => {
  const f = fixture(),
    savedIds: string[] = [];
  const writer = f.make({ onSaved: (id) => savedIds.push(id) });
  writer.append("user", "What should I focus on?", unknown, "openai");
  writer.append(
    "assistant",
    "The confirmed project is the priority.",
    { ...scoped, apiKey: "must-not-be-stored", audio: "raw-data" } as typeof scoped,
    "browser",
  );
  expect(f.api.list()).toHaveLength(0);
  expect(f.storage.length).toBe(1);
  await writer.flush();
  const [saved] = conversationStore(f.root).list();
  expect(saved.title).toBe("Jarvis · What should I focus on?");
  expect(saved.persona).toBe("assistant");
  expect(saved.modelKey).toBeUndefined();
  expect(saved.messages.map((m) => m.role)).toEqual(["user", "oracle"]);
  expect(saved.messages[1]).toMatchObject({
    ...scoped,
    contextReusable: true,
    via: "Jarvis · Browser voice",
  });
  expect(JSON.stringify(saved)).not.toContain("must-not-be-stored");
  expect(JSON.stringify(saved)).not.toContain("raw-data");
  expect(savedIds).toEqual([saved.id]);
  expect(writer.getState().status).toBe("saved");
  expect(f.storage.length).toBe(0);
  const workspace = { brainRevision: 7, sources: [{ id: "fixture-memory", origin: "files" }] };
  expect(chatContextEligible(saved.messages[1], workspace)).toBe(true);
  expect(selectedChatHistory(saved.messages[1], { enabled: true, sources: { gmail: false } })).toBe(
    true,
  );
  expect(selectedChatHistory(saved.messages[1], { enabled: true, sources: {} })).toBe(false);
  expect(chatContextEligible(saved.messages[1], { ...workspace, brainRevision: 8 })).toBe(false);
  expect(chatContextEligible(saved.messages[0], workspace)).toBe(false);
});

test("mixed realtime, local actions and missing provenance remain readable but cannot be reused as evidence", async () => {
  const f = fixture(),
    writer = f.make();
  writer.append("assistant", "A realtime answer", unknown, "openai");
  writer.append("assistant", "A locally displayed action", {}, "elevenlabs");
  writer.append("assistant", "Incomplete scoped answer", { brainRevision: 7 }, "browser");
  await writer.flush();
  const messages = conversationStore(f.root).list()[0].messages;
  expect(messages).toHaveLength(3);
  for (const message of messages) {
    expect(message.contextReusable).toBe(false);
    expect(message.contextKey).toBeUndefined();
    expect(
      chatContextEligible(message, { brainRevision: message.brainRevision, sources: [] }),
    ).toBe(false);
  }
});

test("serial writes keep all appended turns and advance only acknowledged revisions", async () => {
  const f = fixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: VoiceTranscript[] = [];
  let inFlight = 0,
    highest = 0;
  const writer = f.make({
    save: async (snapshot) => {
      writes.push(structuredClone(snapshot));
      inFlight++;
      highest = Math.max(highest, inFlight);
      if (writes.length === 1) await wait;
      const result = await f.save(snapshot);
      inFlight--;
      return result;
    },
  });
  writer.append("user", "First", unknown, "openai");
  const pending = writer.flush();
  writer.append("assistant", "Second", unknown, "openai");
  writer.append("user", "Third", unknown, "openai");
  expect(writer.flush()).toBe(pending);
  release();
  await pending;
  expect(highest).toBe(1);
  expect(writes.map((s) => s.revision)).toEqual([0, 1]);
  expect(f.api.list()[0].messages.map((m) => m.text)).toEqual(["First", "Second", "Third"]);
  expect(writer.getState().status).toBe("saved");
});

test("an acknowledged save with a lost response retries its exact snapshot before later edits", async () => {
  const f = fixture(),
    writes: VoiceTranscript[] = [];
  const writer = f.make({
    save: async (snapshot) => {
      writes.push(structuredClone(snapshot));
      const result = await f.save(snapshot);
      if (writes.length === 1) throw new Error("Response lost");
      return result;
    },
  });
  writer.append("user", "First", unknown, "openai");
  await writer.flush();
  expect(writer.getState().status).toBe("error");
  writer.append("assistant", "Second", unknown, "openai");
  await writer.flush();
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[2].revision).toBe(1);
  expect(f.api.list()).toHaveLength(1);
  expect(f.api.list()[0].messages).toHaveLength(2);
  expect(f.api.list()[0].revision).toBe(2);
});

test("failed saves survive reload, recover independently, and never resume into a loaded Chat", async () => {
  const f = fixture();
  const first = f.make({
    save: async () => {
      throw new Error("Offline");
    },
  });
  first.append("user", "Unsaved voice note", unknown, "openai");
  await first.flush();
  const backup = JSON.parse([...f.storage.values.values()][0]);
  const loaded = f.api.save({
    title: "Existing chat",
    messages: [{ role: "user", text: "Leave me intact" }],
    persona: "assistant",
  });
  const recovered = f.make();
  recovered.restore();
  await recovered.flush();
  recovered.append("user", "A fresh voice conversation", unknown, "browser");
  await recovered.flush();
  expect(f.api.list()).toHaveLength(3);
  expect(f.api.list().find((c) => c.id === backup.latest.id)?.messages[0].text).toBe(
    "Unsaved voice note",
  );
  expect(f.api.list().find((c) => c.id === loaded.id)).toEqual(loaded);
  expect(f.storage.length).toBe(0);
});

test("a conflicting edit is preserved locally and Save as new chat never overwrites the newer server chat", async () => {
  const f = fixture(),
    writer = f.make();
  writer.append("user", "Original voice", unknown, "openai");
  await writer.flush();
  const original = f.api.list()[0];
  const edited = f.api.save({
    ...original,
    messages: [...original.messages, { role: "user", text: "Other tab change" }],
  });
  writer.append("assistant", "New unsaved voice turn", unknown, "openai");
  await writer.flush();
  expect(writer.getState().status).toBe("conflict");
  expect(f.api.list()[0]).toEqual(edited);
  const preserved = JSON.parse(f.storage.getItem(VOICE_TRANSCRIPT_PREFIX + original.id)!);
  expect(preserved.latest.messages.at(-1).text).toBe("New unsaved voice turn");
  await writer.saveConflictCopy();
  expect(f.api.list()).toHaveLength(2);
  expect(f.api.list().find((c) => c.id === original.id)).toEqual(edited);
  expect(
    f.api
      .list()
      .find((c) => c.id !== original.id)
      ?.messages.at(-1)?.text,
  ).toBe("New unsaved voice turn");
  expect(f.storage.length).toBe(0);
  expect(writer.getState().status).toBe("saved");
});

test("long conversations roll into bounded separate chats without dropping any text", async () => {
  const f = fixture(),
    writer = f.make();
  for (let i = 0; i < 452; i++)
    writer.append(i % 2 ? "assistant" : "user", `Turn ${i}`, unknown, "openai");
  await writer.flush();
  const all = f.api.list();
  expect(all).toHaveLength(2);
  expect(all.map((c) => c.messages.length).sort((a, b) => a - b)).toEqual([2, 450]);
  expect(
    all
      .flatMap((c) => c.messages)
      .map((m) => m.text)
      .sort(),
  ).toEqual(Array.from({ length: 452 }, (_, i) => `Turn ${i}`).sort());
});

test("disabled browser storage is reported while durable server storage still works", async () => {
  const f = fixture();
  const writer = f.make({
    storage: {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error("Storage disabled");
      },
      removeItem: () => {},
    },
  });
  writer.append("user", "Keep this on the Mac", unknown, "openai");
  expect(writer.getState().backupAvailable).toBe(false);
  await writer.flush();
  expect(writer.getState().status).toBe("saved");
  expect(f.api.list()).toHaveLength(1);
});

test("reload during conflict-copy recovery retires the superseded backup only after the copy saves", async () => {
  const f = fixture();
  let failCopy = false;
  const writer = f.make({
    save: async (snapshot) => {
      if (failCopy && snapshot.revision === 0) throw new Error("Offline during copy");
      return f.save(snapshot);
    },
  });
  writer.append("user", "Original", unknown, "openai");
  await writer.flush();
  const original = f.api.list()[0];
  f.api.save({ ...original, title: "Changed elsewhere" });
  writer.append("assistant", "Unsaved continuation", unknown, "openai");
  await writer.flush();
  failCopy = true;
  await writer.saveConflictCopy();
  expect(f.storage.length).toBe(2);
  const recovered = f.make();
  recovered.restore();
  await recovered.flush();
  expect(f.api.list()).toHaveLength(2);
  expect(f.api.list().find((c) => c.id === original.id)?.title).toBe("Changed elsewhere");
  expect(f.storage.length).toBe(0);
  expect(recovered.getState().status).toBe("saved");
  expect(recovered.getState().pending).toBe(0);
  await recovered.saveConflictCopy();
  expect(f.api.list()).toHaveLength(2);
});
