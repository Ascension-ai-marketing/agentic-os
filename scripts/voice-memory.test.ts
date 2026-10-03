import { expect, test } from "bun:test";
import { voiceMemory } from "./voice-memory";
import type { OperatorState, MemorySource } from "../src/lib/operator";

function fixture() {
  const source = {
    id: "demo",
    title: "Launch plan",
    text: "Launch colour: violet-lantern-731.",
    origin: "manual",
    status: "ready",
    updatedAt: "2026-09-17",
    kind: "note",
    collection: "personal",
  } as MemorySource;
  const state: Pick<OperatorState, "sources" | "brainSources"> = {
    sources: [source],
    brainSources: {},
  };
  let calls = 0;
  const api = voiceMemory({
    load: () => state,
    recentMeetings: async () => {
      calls++;
      return {
        documents: [
          { id: "meeting1", title: "Launch review", text: "We selected violet for the launch." },
          { id: "meeting2", title: "Design review", text: "The new icon is blue." },
        ],
        hasMore: true,
        scope: "This week, up to 10 meetings",
      };
    },
  });
  return { source, state, api, calls: () => calls };
}

test("voice reads the fresh saved version and respects disable, trash and supersession", () => {
  const f = fixture();
  expect(f.api.read("demo").text).toContain("violet-lantern-731");
  f.source.text = "Updated launch colour: emerald.";
  expect(f.api.read("demo").text).toContain("emerald");
  f.state.brainSources.manual = false;
  expect(() => f.api.read("demo")).toThrow("switched off");
  f.state.brainSources.manual = true;
  f.source.deletedAt = "2026-09-17";
  expect(() => f.api.read("demo")).toThrow("unavailable");
  delete f.source.deletedAt;
  f.source.connector = {
    provider: "fixture",
    itemId: "1",
    syncedAt: "2026-09-17",
    supersededAt: "2026-09-17",
  };
  expect(() => f.api.read("demo")).toThrow("unavailable");
});

test("voice retrieves evidence beyond the UI preview and marks partial documents", () => {
  const f = fixture();
  f.source.text =
    "Opening filler. ".repeat(1200) +
    "LateEvidence731: launch is Thursday. " +
    "Closing filler. ".repeat(900);
  const result = f.api.read("demo", "LateEvidence731");
  expect(result.text).toContain("launch is Thursday");
  expect(result.offset).toBeGreaterThan(10000);
  expect(result.text.length).toBeLessThanOrEqual(10000);
  expect(result.truncated).toBe(true);
  f.source.status = "indexing";
  expect(f.api.read("demo").text).toBe("");
  expect(f.api.read("demo").instruction).toContain("still being indexed");
});

test("Granola recall calls the connector fresh and reports the bounded search scope", async () => {
  const f = fixture();
  const result = await f.api.meetings("violet");
  expect(f.calls()).toBe(1);
  expect(result.mode).toBe("live");
  expect(result.searched).toBe(2);
  expect(result.meetings.map((item) => item.id)).toEqual(["meeting1"]);
  expect(result.hasMore).toBe(true);
  expect(result.scope).toContain("This week");
  expect((await f.api.meetings("unmatchedneedle")).meetings).toEqual([]);
  expect(f.calls()).toBe(2);
  f.state.brainSources.meetings = false;
  await expect(f.api.meetings("violet")).rejects.toThrow("switched off");
  expect(f.calls()).toBe(2);
});

test("disabling meetings during a connector request prevents evidence returning", async () => {
  const f = fixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = voiceMemory({
    load: () => f.state,
    recentMeetings: async () => {
      await wait;
      return {
        documents: [{ id: "1", title: "Private fixture", text: "Synthetic fixture only" }],
        hasMore: false,
        scope: "fixture",
      };
    },
  });
  const pending = api.meetings("");
  f.state.brainSources.meetings = false;
  release();
  await expect(pending).rejects.toThrow("No meeting evidence was returned");
});
