import { beforeEach, afterEach, test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  appendFileSync,
  utimesSync,
  readFileSync,
  statSync,
  realpathSync,
  truncateSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  scanMemoryApp,
  decodeConversationRecord,
  chatGPTDocuments,
  granolaDocuments,
  memoryApps,
  type ReadyImport,
  type ImportedParts,
} from "./memory-apps";
let root: string, home: string;
const running: ReturnType<typeof memoryApps>[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "memory-app-sync-"));
  home = join(root, "home");
  mkdirSync(home);
});
afterEach(() => {
  running.forEach((s) => s.stop());
  running.length = 0;
  rmSync(root, { recursive: true, force: true });
});
function put(path: string, body: string) {
  const p = join(home, path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
}
const user = (text: string) =>
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  }) + "\n";
function make(extra: any = {}) {
  const map = new Map<string, ReadyImport>(),
    tombs = new Set<string>(),
    batches: number[] = [];
  const save = (s: ReadyImport) => {
    if (tombs.has(s.connector.itemId)) return { skipped: true };
    const old = map.get(s.connector.itemId);
    map.set(s.connector.itemId, structuredClone(s));
    return old ? (old.text === s.text ? { unchanged: true } : { updated: true }) : {};
  };
  const api = memoryApps({
    root,
    home,
    validCollection: (id) => ["business", "space-qa"].includes(id),
    importSource: save,
    importSources: (inputs) => {
      batches.push(inputs.length);
      return inputs.map(save);
    },
    ...extra,
  });
  running.push(api);
  return { api, map, tombs, batches };
}
test("metadata scan discovers registered skill roots and newest bundle without auth files or escaping links", () => {
  put(".codex/memories/MEMORY.md", "The launch plan is about a membership.");
  put(".codex/auth.json", "NEVER AUTH");
  put(".codex/sessions/2026/session.jsonl", user("Discuss our launch."));
  put(".codex/skills/custom/SKILL.md", "Instructions for a custom skill.");
  put(".agents/skills/shared/SKILL.md", "Instructions for a shared skill.");
  const registered = join(home, "claude-brain/skills");
  put("claude-brain/skills/local/SKILL.md", "Local registered skill instructions.");
  mkdirSync(join(home, ".claude"), { recursive: true });
  symlinkSync(registered, join(home, ".claude/skills"));
  symlinkSync(join(home, ".agents/skills/shared"), join(registered, "shared"));
  put("outside/SKILL.md", "OUTSIDE must not be imported.");
  symlinkSync(join(home, "outside"), join(registered, "escape"));
  const old = put(
    ".codex/plugins/cache/store/plugin/1.0/skills/a/SKILL.md",
    "Old cached instructions.",
  );
  const latest = put(
    ".codex/plugins/cache/store/plugin/2.0/skills/a/SKILL.md",
    "Latest cached instructions.",
  );
  utimesSync(dirname(dirname(dirname(old))), new Date(0), new Date(0));
  const c = scanMemoryApp("codex", home),
    cl = scanMemoryApp("claude", home);
  expect(c.counts).toEqual({ memories: 1, conversations: 1, skills: 3 });
  expect(c.files.some((f) => f.absolute === realpathSync(latest))).toBe(true);
  expect(c.files.some((f) => f.absolute === realpathSync(old))).toBe(false);
  expect(cl.counts.skills).toBe(2);
  expect(cl.files.some((f) => f.path.includes("outside"))).toBe(false);
  expect(JSON.stringify(c)).not.toContain("NEVER AUTH");
});
test("only visible user/assistant text is decoded, never tool results, thinking or embedded images", () => {
  expect(
    decodeConversationRecord("codex", {
      type: "response_item",
      payload: { type: "function_call_output", output: "TOOL SECRET" },
    }),
  ).toBeNull();
  expect(
    decodeConversationRecord("codex", {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        channel: "analysis",
        content: [{ type: "output_text", text: "PRIVATE REASONING" }],
      },
    }),
  ).toBeNull();
  expect(
    decodeConversationRecord("claude", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "NO" },
          { type: "tool_use", input: "NO" },
          { type: "text", text: "Visible answer." },
        ],
      },
    })?.text,
  ).toBe("Visible answer.");
  expect(
    decodeConversationRecord("codex", {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_image", image_url: "data:image/png;base64,NO" },
          { type: "input_text", text: "Visible prompt." },
        ],
      },
    })?.text,
  ).toBe("Visible prompt.");
});
test("all selected local files stream in bounded batched parts, then incrementally update without duplicates", async () => {
  for (let i = 0; i < 12; i++)
    put(
      `.codex/sessions/2026/${i}.jsonl`,
      user("Session " + i + " " + "visible ".repeat(7000)) +
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", output: "TOOL_ONLY_SECRET" },
        }) +
        "\n",
    );
  put(".codex/memories/MEMORY.md", "Long term user preferences are stored here.");
  put(".codex/skills/example/SKILL.md", "Use concise summaries for reports.");
  const { api, map, batches } = make();
  api.configure("codex", { enabled: true, autoSync: true, collection: "space-qa" });
  api.start("codex");
  let status = await api.wait("codex");
  expect(status.status).toBe("idle");
  expect(status.progress.processed).toBe(14);
  expect(map.size).toBe(14);
  expect(batches.some((n) => n === 8)).toBe(true);
  expect(
    [...map.values()].every((s) => s.text.length <= 180000 && s.collection === "space-qa"),
  ).toBe(true);
  expect(JSON.stringify([...map.values()])).not.toContain("TOOL_ONLY_SECRET");
  api.start("codex");
  status = await api.wait("codex");
  expect(status.progress.added).toBe(0);
  expect(status.progress.unchanged).toBe(14);
  appendFileSync(
    join(home, ".codex/sessions/2026/0.jsonl"),
    user("LATEST_MARKER This new conversation turn must be included."),
  );
  api.start("codex");
  status = await api.wait("codex");
  expect(status.progress.updated).toBe(1);
  expect(map.size).toBe(14);
  expect([...map.values()].some((s) => s.text.includes("LATEST_MARKER"))).toBe(true);
  expect(statSync(join(root, ".operator-data/memory-apps.json")).mode & 0o777).toBe(0o600);
});
test("large conversation text keeps every part and oversized records report a partial import", async () => {
  const normal =
    user("A".repeat(160000)) +
    user("B".repeat(160000)) +
    user("FINAL_TAIL_MARKER needs to be remembered.");
  put(".codex/sessions/normal.jsonl", normal);
  put(
    ".codex/sessions/oversized.jsonl",
    user("X".repeat(17 * 1024 * 1024)) + user("Readable content following the oversized record."),
  );
  const { api, map } = make();
  api.configure("codex", { enabled: true });
  api.start("codex");
  const s = await api.wait("codex");
  expect([...map.values()].some((x) => x.text.includes("FINAL_TAIL_MARKER"))).toBe(true);
  expect([...map.values()].every((x) => x.text.length <= 180000)).toBe(true);
  // Everything readable was imported, so the pass ends idle with a warning, not an error.
  expect(s.status).toBe("idle");
  expect(s.error).toBeUndefined();
  expect(s.lastSync).toBeDefined();
  expect(s.progress.skipped).toBeGreaterThan(0);
  expect(s.warning).toContain("16 MB");
  const app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.status).toBe("idle");
  expect(app.warning).toContain("16 MB");
  expect(app.diagnostics.omittedRecords).toBe(1);
  expect(app.diagnostics.issues[0].code).toBe("record_limit");
  expect(app.diagnostics.issues[0].message).toContain("without classifying");
});
test("large mixed image records keep readable text while tool and image-only records are filtered", async () => {
  const image = {
    type: "image",
    source: { type: "base64", data: "PRIVATE_ATTACHMENT_SENTINEL".repeat(70000) },
  };
  const row = (content: any[]) =>
    JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
  put(
    ".claude/projects/demo/mixed.jsonl",
    row([
      { type: "tool_result", content: [image, { type: "text", text: "PRIVATE_TOOL_SENTINEL" }] },
    ]) +
      row([image]) +
      row([
        { type: "text", text: "Readable launch decision from an image-bearing message." },
        image,
      ]),
  );
  const { api, map } = make();
  api.configure("claude", { enabled: true });
  api.start("claude");
  const result = await api.wait("claude");
  expect(result.status).toBe("idle");
  expect(result.progress.skipped).toBe(0);
  expect([...map.values()].map((s) => s.text).join("\n")).toContain("Readable launch decision");
  expect([...map.values()].map((s) => s.text).join("\n")).not.toContain("PRIVATE_");
  const app = (await api.list()).apps.find((a) => a.id === "claude")!;
  expect(app.diagnostics).toMatchObject({
    importedMessages: 1,
    filteredRecords: 2,
    omittedRecords: 0,
    detailsComplete: true,
    recheckFiles: 0,
  });
  expect(JSON.stringify(app)).not.toContain("PRIVATE_");
  expect(JSON.stringify(app)).not.toContain("Readable launch decision");
});
test("legacy record-limit caches upgrade only on manual sync and then remain incremental", async () => {
  const record = user("Recovered textual message. " + "x".repeat(1100000));
  put(".codex/sessions/legacy.jsonl", record);
  const file = scanMemoryApp("codex", home).files[0];
  const dir = join(root, ".operator-data");
  mkdirSync(dir);
  writeFileSync(
    join(dir, "memory-apps.json"),
    JSON.stringify({
      codex: {
        enabled: true,
        autoSync: true,
        partialCheckpoints: {
          [file.id]: {
            fingerprint: file.fingerprint,
            skipped: 1,
            reason:
              "legacy.jsonl: 0 malformed and 1 records over the 1 MB per-record limit were skipped.",
          },
        },
      },
    }),
  );
  const { api, map, batches } = make();
  let app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.diagnostics.recheckFiles).toBe(1);
  expect(app.diagnostics.issues[0].code).toBe("legacy_record_limit");
  expect(app.diagnostics.detailsComplete).toBe(false);
  let tick: (() => void) | undefined;
  const original = globalThis.setInterval;
  try {
    globalThis.setInterval = ((fn: () => void) => {
      tick = fn;
      return original(() => {}, 1000000);
    }) as typeof setInterval;
    api.startTimer();
  } finally {
    globalThis.setInterval = original;
  }
  tick!();
  await new Promise((done) => setTimeout(done, 10));
  await api.wait("codex");
  expect(map.size).toBe(0);
  expect(batches).toHaveLength(0);
  expect((await api.list()).apps.find((a) => a.id === "codex")!.diagnostics.recheckFiles).toBe(1);
  api.start("codex");
  expect((await api.wait("codex")).status).toBe("idle");
  expect(map.size).toBeGreaterThan(1);
  app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.diagnostics).toMatchObject({
    recheckFiles: 0,
    omittedRecords: 0,
    importedMessages: 1,
    detailsComplete: true,
  });
  const count = batches.length;
  api.start("codex");
  await api.wait("codex");
  expect(batches.length).toBe(count);
});
test("short messages and final tiny text fragments are retained", async () => {
  put(".codex/sessions/tiny.jsonl", user("Yes"));
  put(".codex/memories/tail.md", "A".repeat(180000) + "FIN");
  const { api, map } = make();
  api.configure("codex", { enabled: true });
  api.start("codex");
  expect((await api.wait("codex")).status).toBe("idle");
  expect([...map.values()].some((s) => s.text.endsWith("FIN"))).toBe(true);
  expect([...map.values()].some((s) => s.text.includes("Yes"))).toBe(true);
});
test("a file changing after scan is deferred without losing saved content and retried next sync", async () => {
  for (let i = 0; i < 9; i++)
    put(`.codex/memories/${i}.md`, `Original saved content for document ${i}.`);
  // Newest first: the oldest file is processed last, after the first batch flush.
  const files = scanMemoryApp("codex", home).files,
    last = files.find((file) => file.title === "0")!;
  const saved = new Map<string, ReadyImport>();
  let changeDuringBatch = false;
  const { api } = make({
    importSources: (inputs: ReadyImport[]) => {
      const results = inputs.map((s) => {
        const exists = saved.has(s.connector.itemId);
        saved.set(s.connector.itemId, s);
        return exists ? { updated: true } : {};
      });
      if (changeDuringBatch) {
        changeDuringBatch = false;
        writeFileSync(last.absolute, "Newest content written while the importer is running.");
      }
      return results;
    },
  });
  api.configure("codex", { enabled: true });
  api.start("codex");
  await api.wait("codex");
  const original = saved.get(last.id)!.text;
  files.forEach((file) => {
    const i = Number(file.title);
    writeFileSync(file.absolute, `An intermediate edited document ${i}, before the next scan.`);
    utimesSync(file.absolute, new Date(1_700_000_000_000 + i * 60_000), new Date(1_700_000_000_000 + i * 60_000));
  });
  changeDuringBatch = true;
  api.start("codex");
  const deferred = await api.wait("codex");
  expect(deferred.status).toBe("idle");
  expect(deferred.error).toBeUndefined();
  expect(deferred.progress).toMatchObject({ deferred: 1, skipped: 0, failed: 0 });
  expect(saved.get(last.id)!.text).toBe(original);
  const app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.notice).toContain("next sync");
  expect(app.diagnostics.deferredFiles).toBe(1);
  api.start("codex");
  const retried = await api.wait("codex");
  expect(retried.progress.deferred).toBe(0);
  expect(retried.status).toBe("idle");
  expect(saved.get(last.id)!.text).toBe("Newest content written while the importer is running.");
});
test("known legacy deferred-only status is informational without rewriting state or hiding other errors", async () => {
  const dir = join(root, ".operator-data");
  mkdirSync(dir);
  const file = join(dir, "memory-apps.json");
  const error =
    "~/.codex/sessions/active.jsonl: changed during the scan; sync again to include its latest content.";
  const value = {
    codex: {
      status: "error",
      error,
      progress: {
        processed: 1,
        total: 1,
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 1,
        failed: 0,
        excluded: 0,
      },
    },
  };
  writeFileSync(file, JSON.stringify(value));
  const original = readFileSync(file, "utf8"),
    { api } = make();
  let app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.status).toBe("idle");
  expect(app.progress.skipped).toBe(0);
  expect(app.diagnostics.deferredFiles).toBe(1);
  expect(app.error).toBeUndefined();
  expect(readFileSync(file, "utf8")).toBe(original);
  value.codex.error = "~/.codex/sessions/broken.jsonl: 1 malformed record. " + error;
  value.codex.progress.skipped = 2;
  writeFileSync(file, JSON.stringify(value));
  app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.status).toBe("error");
  expect(app.error).toContain("malformed");
  expect(app.progress.skipped).toBe(2);
});
test("pausing one large session stops after its current batch and resumes without losing parts", async () => {
  put(
    ".codex/sessions/large.jsonl",
    Array.from({ length: 15 }, (_, i) => user(String(i).padEnd(300000, "x"))).join(""),
  );
  const stored = new Map<string, ReadyImport>(),
    reconciled: ImportedParts[] = [];
  let pause = true,
    subject: ReturnType<typeof make>;
  subject = make({
    importSources: (batch: ReadyImport[]) => {
      const results = batch.map((s) => {
        const exists = stored.has(s.connector.itemId);
        stored.set(s.connector.itemId, s);
        return exists ? { unchanged: true } : {};
      });
      if (pause) {
        pause = false;
        subject.api.configure("codex", { enabled: false });
      }
      return results;
    },
    reconcileSources: (items: ImportedParts[]) => reconciled.push(...items),
  });
  subject.api.configure("codex", { enabled: true });
  subject.api.start("codex");
  const paused = await subject.api.wait("codex");
  expect(stored.size).toBe(8);
  expect(paused.status).toBe("error");
  expect(paused.error).toContain("paused");
  expect(paused.checkpoints).toEqual({});
  expect(reconciled).toHaveLength(0);
  subject.api.configure("codex", { enabled: true });
  subject.api.start("codex");
  const resumed = await subject.api.wait("codex");
  expect(resumed.status).toBe("idle");
  expect(stored.size).toBe(26);
  expect(resumed.progress.unchanged).toBe(8);
  expect(resumed.progress.added).toBe(18);
  expect(reconciled[0].parts).toBe(26);
});
test("partial records never reconcile old parts; successful exports reconcile exact text fragments", async () => {
  const reconciled: ImportedParts[] = [];
  put(".codex/sessions/partial.jsonl", user("A visible message.") + "broken JSON\n");
  const { api, batches } = make({
    reconcileSources: (items: ImportedParts[]) => reconciled.push(...items),
  });
  api.configure("codex", { enabled: true });
  api.start("codex");
  const partial = await api.wait("codex");
  expect(partial.status).toBe("idle");
  expect(partial.warning).toContain("1 malformed");
  expect(partial.error).toBeUndefined();
  expect(reconciled).toHaveLength(0);
  const originalBatches = batches.length;
  api.start("codex");
  const cached = await api.wait("codex");
  expect(cached.status).toBe("idle");
  expect(cached.warning).toContain("1 malformed");
  expect(cached.progress.skipped).toBe(1);
  expect(batches.length).toBe(originalBatches);
  expect(Object.keys(cached.partialCheckpoints)).toHaveLength(1);
  put(
    ".codex/sessions/partial.jsonl",
    user("A repaired visible message.") + user("A new message after repair."),
  );
  api.start("codex");
  const repaired = await api.wait("codex");
  expect(repaired.status).toBe("idle");
  expect(repaired.warning).toBeUndefined();
  expect(repaired.partialCheckpoints).toEqual({});
  expect(batches.length).toBeGreaterThan(originalBatches);
  const payload = (text: string) => ({
    filename: "conversations.json",
    base64: Buffer.from(
      JSON.stringify([
        {
          id: "export-1",
          title: "Export",
          mapping: { a: { message: { author: { role: "user" }, content: { parts: [text] } } } },
        },
      ]),
    ).toString("base64"),
    collection: "business",
  });
  await api.importExport("chatgpt", payload("Z".repeat(200000)));
  await api.wait("chatgpt");
  expect(reconciled.at(-1)).toMatchObject({
    provider: "chatgpt",
    itemId: "export-1",
    parts: 2,
    keepParts: [0, 1],
  });
  await api.importExport("chatgpt", payload("Yes"));
  await api.wait("chatgpt");
  expect(reconciled.at(-1)).toMatchObject({ itemId: "export-1", parts: 1, keepParts: [0] });
});
test("restart resumes committed file checkpoints and never re-adds trashed connector records", async () => {
  for (let i = 0; i < 12; i++)
    put(
      `.claude/projects/project/${i}.jsonl`,
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Remember project decision " + i + "." },
      }) + "\n",
    );
  const store = new Map<string, ReadyImport>();
  let first: any;
  first = make({
    importSources: (inputs: ReadyImport[]) => {
      inputs.forEach((s) => store.set(s.connector.itemId, s));
      first.api.stop();
      return inputs.map(() => ({}));
    },
  });
  first.api.configure("claude", { enabled: true });
  first.api.start("claude");
  const stopped = await first.api.wait("claude");
  expect(stopped.progress.processed).toBeLessThan(12);
  expect(store.size).toBe(8);
  const second = make();
  second.api.start("claude");
  const resumed = await second.api.wait("claude");
  expect(resumed.progress.processed).toBe(12);
  expect(resumed.progress.unchanged).toBe(8);
  expect(second.map.size).toBe(4);
  const one = [...second.map.keys()][0];
  second.tombs.add(one);
  second.map.delete(one);
  const f = scanMemoryApp("claude", home).files.find((f) => f.id === one)!;
  appendFileSync(
    f.absolute,
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "Updated answer remains excluded if trashed." },
    }) + "\n",
  );
  second.api.start("claude");
  const last = await second.api.wait("claude");
  expect(last.progress.skipped).toBe(1);
  expect(second.map.has(one)).toBe(false);
});
test("saved mail is available context, never a fabricated provider sync, and explicit import uses the chosen space", async () => {
  let providerCalls = 0;
  const { api, map } = make({
    accountStatus: async () => ({
      accounts: [{ id: "google", connected: false }],
      snapshots: { gmail: 30 },
    }),
    syncAccount: async () => {
      providerCalls++;
      return { messages: 30, events: 0 };
    },
    mailDocuments: () => [
      {
        id: "mail-1",
        title: "Customer question",
        text: "A saved email snapshot with useful customer context.",
      },
    ],
  });
  const listed = (await api.list()).apps.find((a) => a.id === "gmail")!;
  expect(listed.available).toBe(true);
  expect(listed.canSync).toBe(true);
  expect(listed.accountConnected).toBe(false);
  expect(listed.localSnapshots).toBe(30);
  api.configure("gmail", { enabled: true, collection: "space-qa" });
  api.start("gmail");
  const failed = await api.wait("gmail");
  expect(providerCalls).toBe(0);
  expect(failed.status).toBe("idle");
  expect(failed.lastSync).toBeUndefined();
  expect(failed.progress.updated).toBe(0);
  await api.importExport("gmail", { collection: "space-qa" });
  const imported = await api.wait("gmail");
  expect(imported.lastSync).toBeUndefined();
  expect(imported.lastImport).toBeDefined();
  expect([...map.values()][0]).toMatchObject({ origin: "email", collection: "space-qa" });
  await api.importExport("gmail", { collection: "space-qa" });
  expect((await api.wait("gmail")).progress.unchanged).toBe(1);
  expect(map.size).toBe(1);
});
test("actual connected mail sync imports returned mail into memory and records real provider freshness", async () => {
  let calls = 0;
  const { api, map } = make({
    accountStatus: async () => ({ accounts: [{ id: "outlook", connected: true }] }),
    syncAccount: async () => {
      calls++;
      return { messages: 1, events: 2 };
    },
    mailDocuments: () => [
      { id: "outlook:1", title: "Review", text: "A provider-synced message available for memory." },
    ],
  });
  api.configure("outlook", { enabled: true, collection: "space-qa" });
  api.start("outlook");
  const s = await api.wait("outlook");
  expect(calls).toBe(1);
  expect(s.lastSync).toBeDefined();
  expect(s.progress.added).toBe(1);
  expect([...map.values()][0].connector.provider).toBe("outlook");
});
test("ChatGPT exports retain visible conversation text and imports are idempotent; Granola protects encrypted cache", async () => {
  const exported = [
    {
      id: "gpt-1",
      title: "Business plan",
      current_node: "c",
      mapping: {
        a: {
          parent: null,
          message: { author: { role: "user" }, content: { parts: ["Launch planning question"] } },
        },
        b: {
          parent: "a",
          message: { author: { role: "tool" }, content: { parts: ["TOOL SECRET"] } },
        },
        c: {
          parent: "b",
          message: {
            author: { role: "assistant" },
            content: { parts: ["Here is the visible launch plan."] },
          },
        },
      },
    },
  ];
  expect(chatGPTDocuments(exported)[0].text).not.toContain("TOOL SECRET");
  const { api, map } = make();
  const body = {
    filename: "conversations.json",
    base64: Buffer.from(JSON.stringify(exported)).toString("base64"),
    collection: "space-qa",
  };
  await api.importExport("chatgpt", body);
  let s = await api.wait("chatgpt");
  expect(s.lastImport).toBeDefined();
  expect(s.lastSync).toBeUndefined();
  expect(map.size).toBe(1);
  await api.importExport("chatgpt", body);
  s = await api.wait("chatgpt");
  expect(s.progress.unchanged).toBe(1);
  put("Library/Application Support/Granola/cache-v6.json.enc", "ENCRYPTED DO NOT TRY TO READ");
  const scan = scanMemoryApp("granola", home);
  expect(scan.files).toHaveLength(0);
  expect(scan.warnings[0]).toContain("encrypted");
  expect(
    granolaDocuments({
      state: {
        documents: {
          meeting: {
            title: "Weekly meeting",
            notes_plain: "We agreed on the marketing launch plan.",
            token: "NEVER TOKEN",
          },
        },
      },
    })[0].text,
  ).toBe("We agreed on the marketing launch plan.");
});

test("metadata discovery reports only counts and filename examples, and detects a known ChatGPT export", async () => {
  put("Downloads/ChatGPT/conversations.json", JSON.stringify([{ id: "one", title: "Chat", mapping: { a: { message: { author: { role: "user" }, content: { parts: ["Private text must not appear in discovery"] } } } } }]));
  put(".codex/memories/local.md", "Private memory contents must not appear in discovery");
  const { api, map } = make();
  const apps = (await api.list()).apps;
  const chatgpt = apps.find(a => a.id === "chatgpt")!;
  expect(chatgpt).toMatchObject({ available: true, canSync: true, mode: "local", discovery: { fileCount: 1 } });
  expect(chatgpt.discovery.examples).toEqual([{ name: "conversations.json", scope: "conversations", bytes: chatgpt.discovery.totalBytes }]);
  expect(JSON.stringify(apps)).not.toMatch(/Private text|Private memory/);
  api.configure("chatgpt", { enabled: true }); api.start("chatgpt");
  expect((await api.wait("chatgpt")).status).toBe("idle"); expect(map.size).toBe(1);
});

test("bounded local sync resumes remaining files from durable checkpoints", async () => {
  for (let n = 0; n < 45; n++) put(`.codex/memories/note-${String(n).padStart(2, "0")}.md`, `A useful synthetic note with index ${n}.`);
  const { api, map } = make(); api.configure("codex", { enabled: true });
  api.start("codex"); const first = await api.wait("codex");
  expect(first.progress).toMatchObject({ processed: 40, total: 45, remaining: 5, hasMore: true });
  expect(first.lastSync).toBeUndefined(); expect(map.size).toBe(40);
  api.start("codex"); const next = await api.wait("codex");
  expect(next.progress).toMatchObject({ total: 45, remaining: 0, hasMore: false, unchanged: 40 });
  expect(next.lastSync).toBeDefined(); expect(map.size).toBe(45);
});

test("a bounded pass imports the newest files first and older files resume on the next pass", async () => {
  const at = (n: number) => new Date(1_700_000_000_000 + n * 60_000);
  const note = (n: number) => `.codex/memories/note-${String(n).padStart(2, "0")}.md`;
  for (let n = 0; n < 45; n++) {
    const file = put(note(n), `A useful synthetic note with index ${n}.`);
    utimesSync(file, at(n), at(n));
  }
  const { api, map } = make();
  api.configure("codex", { enabled: true });
  api.start("codex");
  const first = await api.wait("codex");
  expect(first.progress).toMatchObject({ processed: 40, total: 45, remaining: 5, hasMore: true });
  expect(first.error).toContain("Newest files were imported first");
  const titles = () => [...map.values()].map((value) => value.title);
  expect(titles()[0]).toBe("Codex · note-44");
  expect(titles()[39]).toBe("Codex · note-05");
  expect(titles()).not.toContain("Codex · note-04");
  expect([...map.values()][0].connector.activityAt).toBe(at(44).toISOString());

  // A session that appears between passes is newer than everything else and lands first.
  const fresh = put(note(99), "A brand new synthetic session written this morning.");
  utimesSync(fresh, at(99), at(99));
  api.start("codex");
  const second = await api.wait("codex");
  expect(second.progress).toMatchObject({ total: 46, processed: 46, remaining: 0, hasMore: false, unchanged: 40, added: 6 });
  expect(second.lastSync).toBeDefined();
  expect(titles()[40]).toBe("Codex · note-99");
  expect(titles().slice(41)).toEqual(["Codex · note-04", "Codex · note-03", "Codex · note-02", "Codex · note-01", "Codex · note-00"]);

  // Completed files are never re-imported; only a changed file is refreshed.
  const changed = put(note(10), "A useful synthetic note with index 10, revised.");
  utimesSync(changed, at(120), at(120));
  api.start("codex");
  const third = await api.wait("codex");
  expect(third.progress).toMatchObject({ total: 46, unchanged: 45, updated: 1, added: 0, remaining: 0 });
  expect(map.get([...map.entries()].find(([, value]) => value.title === "Codex · note-10")![0])!.text).toContain("revised");
});

test("equal modification times fall back to path order and the pointer survives restarts", async () => {
  const when = new Date(1_700_000_000_000);
  for (let n = 0; n < 45; n++) utimesSync(put(`.codex/memories/note-${String(n).padStart(2, "0")}.md`, `A useful synthetic note with index ${n}.`), when, when);
  const create = () => make().api;
  let api = create();
  api.configure("codex", { enabled: true });
  api.start("codex");
  const first = await api.wait("codex");
  expect(first.progress).toMatchObject({ processed: 40, remaining: 5 });
  expect(first.resumeFileId).toBeDefined();
  api.stop();
  api = create();
  api.start("codex");
  const second = await api.wait("codex");
  expect(second.progress).toMatchObject({ processed: 45, remaining: 0, unchanged: 40, added: 5 });
  expect(second.resumeFileId).toBeUndefined();
});

test("Sync all respects app and global source switches, serializes jobs, and imports only enabled saved snippets", async () => {
  put(".codex/memories/note.md", "An enabled synthetic source for the queue.");
  let providerCalls = 0, infoCalls = 0;
  const { api, map } = make({
    accountStatus: async () => ({ accounts: [], snapshots: { gmail: 1, outlook: 1 } }),
    syncAccount: async () => { providerCalls++; return { messages: 1, events: 0 }; },
    mailDocuments: (provider: string) => [{ id: provider + "-saved", title: "Saved snippet", text: "A saved working-context snippet only." }],
    sourceEnabled: (origin: string) => origin !== "business",
    syncInfo: () => infoCalls++,
  });
  api.configure("codex", { enabled: true }); api.configure("gmail", { enabled: true });
  const summary = await api.syncAll();
  expect(summary.queued).toEqual(["codex", "gmail"]);
  expect(summary.skipped).toContainEqual({ id: "outlook", reason: "disabled" });
  expect(summary.skipped).toContainEqual({ id: "info", reason: "disabled" });
  await api.wait("gmail");
  expect(providerCalls).toBe(0); expect(infoCalls).toBe(0); expect(map.size).toBe(2);
  const gmail = (await api.list()).apps.find(a => a.id === "gmail")!;
  expect(gmail.lastSync).toBeUndefined(); expect(gmail.lastImport).toBeDefined();
  expect([...map.values()].some(v => v.connector.itemId.startsWith("outlook"))).toBe(false);
});

test("large Claude transcripts stream exclusively and resume remaining files without exposing tools", async () => {
  const toolRow = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "PRIVATE_TOOL_" + "x".repeat(1024 * 1024) }] } }) + "\n";
  for (const name of ["a", "b"]) {
    const file = put(`.claude/projects/project/${name}.jsonl`, "");
    for (let n = 0; n < 65; n++) appendFileSync(file, toolRow);
    appendFileSync(file, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `Readable final decision ${name}.` }] } }) + "\n");
  }
  const { api, map } = make();
  api.configure("claude", { enabled: true });
  api.start("claude");
  const first = await api.wait("claude");
  expect(first.status).toBe("idle");
  expect(first.progress.failed).toBe(0);
  expect(first.progress.processed).toBe(1);
  expect(first.progress.remaining).toBe(1);
  expect(first.progress.hasMore).toBe(true);
  expect(map.size).toBe(1);
  api.start("claude");
  const second = await api.wait("claude");
  expect(second.status).toBe("idle");
  expect(second.progress.hasMore).toBe(false);
  expect(second.progress.unchanged).toBe(1);
  expect(map.size).toBe(2);
  expect(JSON.stringify([...map.values()])).not.toContain("PRIVATE_TOOL");
  expect([...map.values()].every(value => value.text.includes("Readable final decision"))).toBe(true);
});

test("resuming across restarts gives large transcripts a turn while an earlier small file keeps changing", async () => {
  const visible = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: text } }) + "\n";
  const activeFile = put(".claude/projects/project/a-active.jsonl", visible("Current working decision, revision one."));
  const toolRow = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "EXCLUDED_TOOL_" + "x".repeat(1024 * 1024) }] } }) + "\n";
  for (const [index, name] of ["b", "c"].entries()) {
    const file = put(`.claude/projects/project/${name}-large.jsonl`, "");
    for (let n = 0; n < 65; n++) appendFileSync(file, toolRow);
    appendFileSync(file, visible(`Previously waiting decision ${name}.`));
    utimesSync(file, new Date(Date.now() - (index + 1) * 60_000), new Date(Date.now() - (index + 1) * 60_000));
  }
  // Newest first: the active transcript, then b, then c get their bounded passes.
  utimesSync(activeFile, new Date(), new Date());
  const imported = new Map<string, ReadyImport>();
  const save = (input: ReadyImport) => {
    const old = imported.get(input.connector.itemId);
    imported.set(input.connector.itemId, input);
    return old ? { updated: true } : {};
  };
  const create = () => make({ importSource: save, importSources: (values: ReadyImport[]) => values.map(save) }).api;
  let api = create();
  api.configure("claude", { enabled: true });
  api.start("claude");
  const first = await api.wait("claude");
  expect(first.progress).toMatchObject({ processed: 1, total: 3, remaining: 2, hasMore: true });
  const [originalCheckpoint] = Object.entries(first.checkpoints);
  expect(imported.size).toBe(1);

  for (const [index, name] of ["b", "c"].entries()) {
    appendFileSync(activeFile, visible(`New work arriving during bounded pass ${index + 2}.`));
    api.stop();
    api = create();
    api.start("claude");
    const next = await api.wait("claude");
    expect([...imported.values()].some(item => item.text.includes(`Previously waiting decision ${name}.`))).toBe(true);
    expect(imported.size).toBe(index + 2);
    expect(next.progress.failed).toBe(0);
    expect(next.progress.hasMore).toBe(true);
    expect(next.lastSync).toBeUndefined();
    expect(next.checkpoints[originalCheckpoint[0]]).toBe(originalCheckpoint[1]);
  }

  appendFileSync(activeFile, visible("Most recent decision after both large files got their turn."));
  api.stop();
  api = create();
  api.start("claude");
  const complete = await api.wait("claude");
  expect(complete.progress).toMatchObject({ remaining: 0, hasMore: false, failed: 0 });
  expect(complete.lastSync).toBeDefined();
  expect(imported.size).toBe(3);
  expect([...imported.values()].some(item => item.text.includes("Most recent decision"))).toBe(true);
  expect(JSON.stringify([...imported.values()])).not.toContain("EXCLUDED_TOOL");
});

test("a removed resume target does not discard completed checkpoints or block remaining files", async () => {
  for (let n = 0; n < 45; n++) {
    const file = put(`.codex/memories/note-${String(n).padStart(2, "0")}.md`, `A useful synthetic note with index ${n}.`);
    utimesSync(file, new Date(1_700_000_000_000 + n * 60_000), new Date(1_700_000_000_000 + n * 60_000));
  }
  const { api, map } = make();
  api.configure("codex", { enabled: true });
  api.start("codex");
  const first = await api.wait("codex");
  expect(first.progress.remaining).toBe(5);
  // Newest first: the five oldest notes were deferred, so note-04 is the resume target.
  rmSync(join(home, ".codex/memories/note-04.md"));
  api.start("codex");
  const complete = await api.wait("codex");
  expect(complete.progress).toMatchObject({ total: 44, remaining: 0, hasMore: false, failed: 0, unchanged: 40 });
  for (const [id, fingerprint] of Object.entries(first.checkpoints)) expect(complete.checkpoints[id]).toBe(fingerprint);
  expect(map.size).toBe(44);
});

test("the streamed transcript limit remains bounded and metadata refresh bypasses cache", async () => {
  const file = put(".claude/projects/project/large.jsonl", "");
  truncateSync(file, 256 * 1024 * 1024 + 1);
  const { api } = make();
  expect((await api.list()).apps.find(app => app.id === "claude")!.counts.conversations).toBe(1);
  put(".claude/projects/project/new.jsonl", JSON.stringify({type:"user",message:{role:"user",content:"A newly saved user message."}}));
  expect((await api.list(true)).apps.find(app => app.id === "claude")!.counts.conversations).toBe(2);
  api.configure("claude", { enabled: true });
  api.start("claude");
  const status = await api.wait("claude");
  expect(status.progress.failed).toBe(1);
  expect(status.error).toContain("256 MiB");
  expect(status.progress.added).toBe(1);
});

test("Obsidian discovers registered linked vaults, excludes nested escapes and settings, and imports idempotently", async () => {
  const vault = join(home,"Vault"), linked = join(home,"Linked vault");
  put("Vault/Launch.md", "A private plan for the next launch."); put("Vault/.obsidian/settings.md", "Never import settings."); put("Vault/.trash/deleted.md", "Never import trash.");
  put("Outside/private.md", "Never follow an unregistered link."); symlinkSync(join(home,"Outside"),join(vault,"Escape")); symlinkSync(vault,linked);
  put("Library/Application Support/obsidian/obsidian.json",JSON.stringify({vaults:{a:{path:linked},b:{path:vault}}}));
  const found=scanMemoryApp("obsidian",home); expect(found.files).toHaveLength(1); expect(found.counts.memories).toBe(1); expect(found.warnings).toEqual([]);
  const {api,map}=make(); const listed=(await api.list()).apps.find(a=>a.id==="obsidian")!;
  expect(listed).toMatchObject({available:true,canSync:true,discovery:{fileCount:1}}); expect(JSON.stringify(listed)).not.toContain("private plan");
  api.configure("obsidian",{enabled:true}); api.start("obsidian"); expect((await api.wait("obsidian")).status).toBe("idle");
  expect(map.size).toBe(1); expect([...map.values()][0]).toMatchObject({title:"Obsidian · Launch",origin:"obsidian"});
  api.start("obsidian"); expect((await api.wait("obsidian")).progress.unchanged).toBe(1); expect(map.size).toBe(1);
});

test("Granola existing connection syncs notes without an export or local API key", async () => {
  const {api,map}=make({granolaConnection:async()=>"codex",granolaNotes:async()=>({documents:[{id:"meeting-one",title:"Planning",text:"The next launch will happen on Friday."}],hasMore:false})});
  expect((await api.list()).apps.find(a=>a.id==="granola")).toMatchObject({available:true,canSync:true,mode:"api",connectionMethod:"codex"});
  api.configure("granola",{enabled:true}); api.start("granola"); expect((await api.wait("granola")).status).toBe("idle"); expect(map.size).toBe(1);
  api.start("granola"); expect((await api.wait("granola")).progress.unchanged).toBe(1); expect(map.size).toBe(1);
});

// Codex Desktop (CLI 0.154+) rows: every visible turn is also an item_completed event,
// and some replies (clarifying questions) exist only there.
const codexRow = (row: any) => JSON.stringify(row) + "\n";
const desktopUser = (text: string) => codexRow({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text }] } } });
const desktopAgent = (text: string) => codexRow({ type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", phase: "commentary", content: [{ type: "Text", text }] } } });
const assistant = (text: string) => codexRow({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
const command = (output: string) => codexRow({ type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", command: "ls", aggregated_output: output } } });

test("Codex Desktop completed items decode as visible turns; commands and reasoning do not", () => {
  expect(decodeConversationRecord("codex", JSON.parse(desktopUser("Find my sheet.")))).toEqual({ role: "user", text: "Find my sheet." });
  expect(decodeConversationRecord("codex", JSON.parse(desktopAgent("Was it a spreadsheet?")))).toEqual({ role: "assistant", text: "Was it a spreadsheet?" });
  expect(decodeConversationRecord("codex", JSON.parse(command("TOOL_OUTPUT_SECRET")))).toBeNull();
  expect(decodeConversationRecord("codex", { type: "event_msg", payload: { type: "item_completed", item: { type: "Reasoning", summary_text: "HIDDEN" } } })).toBeNull();
  expect(decodeConversationRecord("codex", { type: "event_msg", payload: { type: "item_completed" } })).toBeNull();
});

test("a 3 MB same-day Codex Desktop session lands in the first pass, once per turn, and is found by date and app", async () => {
  const day = new Date(2026, 8, 18, 12, 31, 8);
  const ended = new Date(2026, 8, 18, 12, 52, 54);
  const file = put(
    ".codex/sessions/2026/09/18/rollout-2026-09-18T12-31-08-synthetic.jsonl",
    codexRow({ type: "session_meta", payload: { id: "synthetic", cwd: "/Users/example/Documents/Codex", originator: "Codex Desktop" } }) +
      codexRow({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<app-context>DEVELOPER_CONTEXT</app-context>" }] } }) +
      user("Please find the tracking sheet you designed yesterday.") +
      desktopUser("Please find the tracking sheet you designed yesterday.") +
      desktopAgent("Looking through your recent files now.") +
      assistant("Looking through your recent files now.") +
      command("COMMAND_OUTPUT_" + "x".repeat(700_000)) +
      command("COMMAND_OUTPUT_" + "y".repeat(700_000)) +
      command("COMMAND_OUTPUT_" + "z".repeat(700_000)) +
      command("COMMAND_OUTPUT_" + "w".repeat(700_000)) +
      desktopAgent("Was it a spreadsheet, or a web page with video thumbnails?") +
      codexRow({ type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted" } }),
  );
  utimesSync(file, ended, ended);
  expect(statSync(file).size).toBeGreaterThan(2_800_000);
  // An older, smaller session must not push today's large one out of the first pass.
  const older = put(".codex/sessions/2026/09/17/rollout-2026-09-17T09-00-00-old.jsonl", user("Yesterday morning I asked about the brief."));
  utimesSync(older, new Date(2026, 8, 17, 9, 30), new Date(2026, 8, 17, 9, 30));
  const { api, map } = make();
  api.configure("codex", { enabled: true });
  api.start("codex");
  const status = await api.wait("codex");
  expect(status.status).toBe("idle");
  expect(status.progress).toMatchObject({ processed: 2, added: 2, failed: 0, skipped: 0, remaining: 0 });
  const saved = [...map.values()].find((s) => s.title === "Codex · rollout-2026-09-18T12-31-08-synthetic")!;
  expect(saved).toBeDefined();
  expect(saved.connector.activityAt).toBe(ended.toISOString());
  // The temporary home sits behind a macOS symlink, so only the tail of the ~/ path is stable.
  expect(saved.connector.path).toEndWith("/.codex/sessions/2026/09/18/rollout-2026-09-18T12-31-08-synthetic.jsonl");
  expect(saved.text.split("find the tracking sheet").length - 1).toBe(1);
  expect(saved.text.split("Looking through your recent files now").length - 1).toBe(1);
  expect(saved.text).toContain("Was it a spreadsheet, or a web page with video thumbnails?");
  expect(saved.text).not.toContain("COMMAND_OUTPUT");
  expect(saved.text).not.toContain("DEVELOPER_CONTEXT");
  expect(saved.text.length).toBeLessThan(600);
  const app = (await api.list()).apps.find((a) => a.id === "codex")!;
  expect(app.diagnostics).toMatchObject({ importedMessages: 4, detailsComplete: true, recheckFiles: 0 });
  // The saved record answers a dated, app-named question through the shared search.
  const { searchMemory } = await import("./operator-plugin");
  const { chatTimeWindow } = await import("../src/lib/chat-retrieval-routing");
  const sources = [...map.values()].map((s, n) => ({
    id: "s" + n, title: s.title, text: s.text, kind: "document" as const, origin: s.origin, collection: s.collection, createdAt: s.connector.syncedAt, updatedAt: s.connector.syncedAt,
    status: "ready" as const, pinned: false, words: 4, hash: "h" + n, connector: { provider: s.connector.provider, itemId: s.connector.itemId, syncedAt: s.connector.syncedAt, path: s.connector.path, activityAt: s.connector.activityAt },
  }));
  const question = "what did I say to Codex this morning?";
  const found = searchMemory(sources, question, undefined, chatTimeWindow(question, new Date(2026, 8, 18, 13, 45)));
  expect(found.results[0]).toMatchObject({ title: "Codex · rollout-2026-09-18T12-31-08-synthetic", inWindow: true, appMatch: true });
  expect(searchMemory(sources, "rollout-2026-09-18T12-31", undefined, null).results[0].title).toBe("Codex · rollout-2026-09-18T12-31-08-synthetic");
  expect(day.getTime()).toBeLessThan(ended.getTime());
});

test("the OS's own check and runtime transcripts are skipped at import and their folders are never scanned", async () => {
  const claudeRow = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";
  put(".claude/projects/-Users-example/probe.jsonl", claudeRow("Reply with ONLY a 3-5 word title.\n\nUSER: This is a local Operator OS integration test. Reply with exactly OPERATOR_READY. Do not use tools."));
  put(".claude/projects/-Users-example/real.jsonl", claudeRow("We moved the onboarding course in the classroom."));
  put(".claude/projects/-Users-example-code-os--operator-data-agent-tasks-example01-claude/task.jsonl", claudeRow("AGENT_TASK_TRANSCRIPT delegated by the operator."));
  put(".claude/projects/-private-var-folders-T-jarvis-claude-check-EXAMPLE/check.jsonl", claudeRow("JARVIS_CHECK_TRANSCRIPT hello."));
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T12-51-34-runtime.jsonl", user("You are Agentic, the concise thinking partner inside Agentic OS. Help the user navigate, understand their context, draft and prepare. RUNTIME_PROMPT"));
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T12-49-59-brief.jsonl", user("Write a useful, calm, readable daily business briefing for the workspace owner using ONLY the evidence packet below. BRIEF_PROMPT"));
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T12-31-08-real.jsonl", user("Please find the tracking sheet."));
  const claudeScan = scanMemoryApp("claude", home);
  expect(claudeScan.files.map((f) => f.title).sort()).toEqual(["probe", "real"]);
  const { api, map } = make();
  api.configure("claude", { enabled: true });
  api.configure("codex", { enabled: true });
  api.start("claude");
  const claude = await api.wait("claude");
  api.start("codex");
  const codex = await api.wait("codex");
  expect(claude.status).toBe("idle");
  expect(codex.status).toBe("idle");
  expect(claude.progress).toMatchObject({ processed: 2, added: 1, excluded: 1, failed: 0 });
  expect(codex.progress).toMatchObject({ processed: 3, added: 1, excluded: 2, failed: 0 });
  const text = JSON.stringify([...map.values()]);
  for (const marker of ["OPERATOR_READY", "AGENT_TASK_TRANSCRIPT", "JARVIS_CHECK_TRANSCRIPT", "RUNTIME_PROMPT", "BRIEF_PROMPT"]) expect(text).not.toContain(marker);
  expect(text).toContain("onboarding course");
  expect(text).toContain("tracking sheet");
  // Excluded files are checkpointed: the next pass does not read them again.
  api.start("codex");
  expect((await api.wait("codex")).progress).toMatchObject({ processed: 3, unchanged: 3, added: 0, excluded: 0 });
});

test("a manual sync re-reads complete transcripts saved by an older reader; autosync leaves them", async () => {
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T12-31-08-upgrade.jsonl", user("Find the tracking sheet.") + desktopAgent("Was it a spreadsheet?"));
  const { api, map, batches } = make();
  api.configure("codex", { enabled: true, autoSync: true });
  api.start("codex");
  expect((await api.wait("codex")).progress).toMatchObject({ added: 1 });
  expect([...map.values()][0].text).toContain("Was it a spreadsheet?");
  // Pretend the record came from the previous reader, which never saw the completed item.
  const settings = join(root, ".operator-data/memory-apps.json");
  const data = JSON.parse(readFileSync(settings, "utf8"));
  for (const stats of Object.values(data.codex.recordStats) as any[]) stats.version = 2;
  writeFileSync(settings, JSON.stringify(data));
  expect((await api.list()).apps.find((a) => a.id === "codex")!.diagnostics.recheckFiles).toBe(1);
  const before = batches.length;
  await api.syncAll(true);
  await api.wait("codex");
  expect(batches.length).toBe(before);
  api.start("codex");
  const manual = await api.wait("codex");
  expect(batches.length).toBe(before + 1);
  expect(manual.progress).toMatchObject({ processed: 1, unchanged: 1, added: 0, failed: 0 });
  expect((await api.list()).apps.find((a) => a.id === "codex")!.diagnostics.recheckFiles).toBe(0);
  api.start("codex");
  await api.wait("codex");
  expect(batches.length).toBe(before + 1);
});

test("Claude project transcripts keep the user's and assistant's words, never harness-injected rows", () => {
  const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: "user", message: { role: "user", content }, timestamp: "2026-09-18T10:53:00.306Z", ...extra });
  expect(decodeConversationRecord("claude", user("Make the New chat button easier to find."))).toEqual({ role: "user", text: "Make the New chat button easier to find." });
  expect(decodeConversationRecord("claude", user([{ type: "image", source: { type: "base64", data: "PRIVATE" } }, { type: "text", text: "What is in this screenshot?" }]))).toEqual({ role: "user", text: "What is in this screenshot?" });
  expect(decodeConversationRecord("claude", user("<system-reminder>\nPROJECT_INSTRUCTIONS\n</system-reminder>\nHow about Claude?"))).toEqual({ role: "user", text: "How about Claude?" });
  expect(decodeConversationRecord("claude", user("<command-name>/clear</command-name>\n<command-message>clear</command-message>"))).toBeNull();
  expect(decodeConversationRecord("claude", user("<local-command-stdout>SECRET_OUTPUT</local-command-stdout>"))).toBeNull();
  expect(decodeConversationRecord("claude", user("<local-command-caveat>Caveat: generated while running local commands</local-command-caveat>"))).toBeNull();
  expect(decodeConversationRecord("claude", user("<task-notification>agent finished</task-notification>"))).toBeNull();
  expect(decodeConversationRecord("claude", user([{ type: "text", text: "SKILL_BODY injected by the harness" }], { isMeta: true }))).toBeNull();
  expect(decodeConversationRecord("claude", user([{ type: "tool_result", tool_use_id: "x", content: "TOOL_OUTPUT" }]))).toBeNull();
  expect(decodeConversationRecord("claude", { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "HIDDEN" }, { type: "tool_use", name: "Bash", input: {} }] } })).toBeNull();
  expect(decodeConversationRecord("claude", { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "The header button is hidden on desktop." }] } })).toEqual({ role: "assistant", text: "The header button is hidden on desktop." });
  for (const type of ["attachment", "queue-operation", "last-prompt", "custom-title", "file-history-snapshot", "system", "ai-title"])
    expect(decodeConversationRecord("claude", { type, timestamp: "2026-09-18T10:53:00.306Z" })).toBeNull();
});

test("a pass that only skips oversized records in one file still stamps a completed sync with a warning", async () => {
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T09-00-00-clean.jsonl", user("A clean session about the sponsorship deck."));
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T10-00-00-big.jsonl", user("X".repeat(17 * 1024 * 1024)) + user("Readable text after the oversized record."));
  const { api, map } = make();
  api.configure("codex", { enabled: true });
  api.start("codex");
  const status = await api.wait("codex");
  expect(status.status).toBe("idle");
  expect(status.error).toBeUndefined();
  expect(status.warning).toContain("records over the 16 MB per-record limit were skipped");
  expect(status.lastSync).toBeDefined();
  expect(status.progress).toMatchObject({ processed: 2, added: 2, failed: 0, skipped: 1, hasMore: false });
  expect([...map.values()].map((s) => s.text).join("\n")).toContain("Readable text after the oversized record.");
  // A file that cannot be read at all is still a real error.
  put(".codex/sessions/2026/09/18/rollout-2026-09-18T11-00-00-huge.jsonl", "");
  truncateSync(join(home, ".codex/sessions/2026/09/18/rollout-2026-09-18T11-00-00-huge.jsonl"), 257 * 1024 * 1024);
  api.start("codex");
  const failed = await api.wait("codex");
  expect(failed.status).toBe("error");
  expect(failed.error).toContain("exceeds the 256 MiB file limit");
  expect(failed.warning).toContain("16 MB");
});

// Windows-aware scanning. Path helpers take the separator as a parameter; the scan
// takes platform and env, so the Windows branches are proven on a synthetic home.
import { assistantHomes, pathWithin, skillIdentityPath } from "./memory-apps";
import { isOperatorSelfPath } from "../src/lib/memory-self-filter";
import { chmodSync } from "node:fs";

test("path helpers handle backslashes and drive letters: containment, and skill identity without the cached version folder", () => {
  expect(pathWithin("C:\\Users\\example\\.codex\\sessions\\a.jsonl", "C:\\Users\\example\\.codex", "\\")).toBe(true);
  expect(pathWithin("C:\\Users\\example\\.codex", "C:\\Users\\example\\.codex", "\\")).toBe(true);
  expect(pathWithin("C:\\Users\\example\\.codex-other\\a.md", "C:\\Users\\example\\.codex", "\\")).toBe(false);
  expect(pathWithin("D:\\Users\\example\\.codex\\a.md", "C:\\Users\\example\\.codex", "\\")).toBe(false);
  expect(pathWithin("/Users/example/.codex/a.md", "/Users/example/.codex", "/")).toBe(true);
  expect(pathWithin("/Users/example/.codex-other/a.md", "/Users/example/.codex", "/")).toBe(false);
  expect(skillIdentityPath("C:\\Users\\example\\.codex\\plugins\\cache\\store\\plugin\\2.0\\skills\\a\\SKILL.md")).toBe("C:\\Users\\example\\.codex\\plugins\\cache\\store\\plugin\\skills\\a\\SKILL.md");
  expect(skillIdentityPath("/Users/example/.claude/plugins/cache/store/plugin/1.0/skills/a/SKILL.md")).toBe("/Users/example/.claude/plugins/cache/store/plugin/skills/a/SKILL.md");
  expect(skillIdentityPath("/Users/example/.claude/skills/a/SKILL.md")).toBe("/Users/example/.claude/skills/a/SKILL.md");
  expect(assistantHomes("C:\\Users\\example", {})).toEqual({ codex: join("C:\\Users\\example", ".codex"), claude: join("C:\\Users\\example", ".claude") });
  expect(assistantHomes("/Users/example", { CODEX_HOME: " /Volumes/work/codex ", CLAUDE_CONFIG_DIR: "" })).toEqual({ codex: "/Volumes/work/codex", claude: "/Users/example/.claude" });
});

test("the OS's own Claude project folders are recognised in macOS, Windows and raw path forms only", () => {
  for (const own of [
    "-Users-example-code-claude-os--operator-data-agent-tasks-example01-claude",
    "C--Users-example-code-claude-os--operator-data-agent-tasks-example01-claude",
    "C:\\Users\\example\\.claude\\projects\\C--Users-example-code-claude-os--operator-data-agent-tasks-example01-claude\\task.jsonl",
    "~/.claude/projects/-Users-x-code-os--operator-data-agent-tasks-example01-claude/run.jsonl",
    "C:\\Users\\example\\code\\claude-os\\.operator-data\\agent-tasks\\example01\\claude\\session.jsonl",
    "/Users/example/code/claude-os/.operator-data/agent-tasks/example01/claude",
    "-private-var-folders-T-jarvis-claude-check-EXAMPLE",
  ]) expect([own, isOperatorSelfPath(own)]).toEqual([own, true]);
  for (const theirs of [
    "-Users-example-code-claude-os",
    "C--Users-example-code-claude-os",
    "C--Users-example-code-claude-os--operator-data-agent-tasks",
    "C--Users-example-notes-operator-data-agent-tasks-summary-claude-notes",
    "C:\\Users\\example\\code\\claude-os\\.operator-data\\memory\\claude.md",
    "",
  ]) expect([theirs, isOperatorSelfPath(theirs)]).toEqual([theirs, false]);
  expect(isOperatorSelfPath(null)).toBe(false);
});

test("scan honours CODEX_HOME, CLAUDE_CONFIG_DIR, %APPDATA% and OneDrive from the given env, shows / paths, and isolates a synthetic home from process.env", () => {
  put("codex-home/sessions/2026/one.jsonl", user("Codex in a custom home."));
  put("codex-home/memories/MEMORY.md", "Custom home memory.");
  put("claude-home/projects/-Users-me/real.jsonl", JSON.stringify({ type: "user", message: { role: "user", content: "hello" } }) + "\n");
  put("claude-home/projects/C--Users-me-code-os--operator-data-agent-tasks-1234-claude/task.jsonl", JSON.stringify({ type: "user", message: { role: "user", content: "AGENT_TASK" } }) + "\n");
  put("claude-home/CLAUDE.md", "Claude instructions.");
  put("OneDrive/Documents/ChatGPT/conversations.json", "[]");
  put("Vault/.obsidian/app.json", "{}");
  put("Vault/note.md", "A note.");
  put("Roaming/obsidian/obsidian.json", JSON.stringify({ vaults: { a: { path: join(home, "Vault") } } }));
  const env = { CODEX_HOME: join(home, "codex-home"), CLAUDE_CONFIG_DIR: join(home, "claude-home"), OneDrive: join(home, "OneDrive"), APPDATA: join(home, "Roaming") };
  const codex = scanMemoryApp("codex", home, { env });
  expect(codex.counts).toEqual({ memories: 1, conversations: 1, skills: 0 });
  expect(codex.files.map((f) => f.path).sort()).toEqual(["~/codex-home/memories/MEMORY.md", "~/codex-home/sessions/2026/one.jsonl"]);
  expect(codex.files.every((f) => !f.path.includes("\\"))).toBe(true);
  const claude = scanMemoryApp("claude", home, { env });
  expect(claude.files.map((f) => f.title).sort()).toEqual(["CLAUDE", "real"]);
  expect(JSON.stringify(claude)).not.toContain("AGENT_TASK");
  expect(scanMemoryApp("chatgpt", home, { env }).files.map((f) => f.path)).toEqual(["~/OneDrive/Documents/ChatGPT/conversations.json"]);
  expect(scanMemoryApp("obsidian", home, { env }).locations).toEqual(["~/Vault"]);
  // No env given and not the real home: the default dot-folders only, nothing from process.env.
  expect(scanMemoryApp("codex", home).counts).toEqual({ memories: 0, conversations: 0, skills: 0 });
  expect(scanMemoryApp("claude", home).files).toEqual([]);
  expect(scanMemoryApp("chatgpt", home).files).toEqual([]);
  expect(scanMemoryApp("obsidian", home).locations).toEqual([]);
});

test("a folder the system refuses to read is reported in the platform's own words", () => {
  if (process.getuid?.() === 0) return; // root ignores mode bits; nothing to prove here.
  const sessions = join(home, ".codex", "sessions");
  mkdirSync(sessions, { recursive: true });
  chmodSync(sessions, 0o000);
  try {
    const windows = scanMemoryApp("codex", home, { platform: "win32", env: {} });
    expect(windows.blocked).toBe("the folder sessions");
    expect(windows.warnings.some((w) => w.startsWith("Windows denied access to the folder sessions"))).toBe(true);
    expect(windows.warnings.some((w) => w.includes("macOS"))).toBe(false);
    const mac = scanMemoryApp("codex", home, { platform: "darwin", env: {} });
    expect(mac.warnings.some((w) => w.startsWith("macOS is blocking this app from reading the folder sessions"))).toBe(true);
    const linux = scanMemoryApp("codex", home, { platform: "linux", env: {} });
    expect(linux.warnings.some((w) => w.startsWith("This system denied access to the folder sessions"))).toBe(true);
  } finally {
    chmodSync(sessions, 0o700);
  }
});
