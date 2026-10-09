import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BRAIN_SOURCES } from "../src/lib/brain-sources";
import {
  operatorPlugin,
  fetchPublic,
  articleText,
  privateAddress,
  filterWorkspaceMemory,
  searchMemory,
  searchSources,
} from "./operator-plugin";
import { chatTimeWindow } from "../src/lib/chat-retrieval-routing";
import type { MemorySource } from "../src/lib/operator";

// The suite must not depend on the Codex app installed on this machine: every connected-read probe fails closed and fast.
process.env.AGENTIC_OS_NO_CODEX = "1";
let server: Server, base: string, root: string;
let closePlugin = () => {};
const token = "operator-integration-test";
async function start() {
  const plugin = operatorPlugin({ root, token, memoryHome: join(root, "fake-home") });
  closePlugin = () => (plugin.closeBundle as any)?.();
  let middleware: any;
  (plugin.configureServer as any)({
    middlewares: { use: (_path: string, fn: any) => (middleware = fn) },
  });
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}
async function stop() {
  closePlugin();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function request(path: string, body?: any) {
  const r = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
          body: JSON.stringify(body),
        },
  );
  return { status: r.status, data: (await r.json()) as any };
}
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "operator-test-"));
  await start();
});
afterAll(async () => {
  await stop();
  rmSync(root, { recursive: true, force: true });
});
describe("local workspace durability and source integrity", () => {
  test("isolated preview ports accept their own origin and reject a sibling origin", async () => {
    const own = await fetch(base + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token, Origin: base },
      body: '{"mission":false}',
    });
    expect(own.status).toBe(200);
    const sibling = await fetch(base + "/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Claude-OS-Token": token,
        Origin: "http://localhost:8081",
      },
      body: '{"mission":true}',
    });
    expect(sibling.status).toBe(403);
    expect((await request("/state")).data.settings.mission).toBe(false);
  });
  test("mutations require a session token and reject cross-site requests", async () => {
    const before = await request("/state");
    const noToken = await fetch(base + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"mission":true}',
    });
    expect(noToken.status).toBe(403);
    const crossSite = await fetch(base + "/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Claude-OS-Token": token,
        Origin: "https://example.com",
      },
      body: '{"mission":true}',
    });
    expect(crossSite.status).toBe(403);
    expect((await request("/state")).data).toEqual(before.data);
  });
  test("a captured note is searchable, survives restart, and deduplicates", async () => {
    const body = {
      title: "Launch decision",
      text: "The launch offer uses a monthly membership and a weekly coaching call.",
      collection: "business",
    };
    const added = await request("/memory", body);
    expect(added.status).toBe(201);
    expect((await request("/search?q=coaching")).data.results[0].title).toBe(body.title);
    const again = await request("/memory", body);
    expect(again.data.duplicate).toBe(true);
    expect(again.data.source.id).toBe(added.data.source.id);
    await stop();
    await start();
    expect((await request("/search?q=coaching")).data.results[0].id).toBe(added.data.source.id);
  });
  test("trashing excludes a source from recall and restore brings it back", async () => {
    const src = (await request("/state")).data.sources[0];
    await request(`/memory/${src.id}`, { action: "trash" });
    expect((await request("/search?q=coaching")).data.results).toHaveLength(0);
    await request(`/memory/${src.id}`, { action: "restore" });
    expect((await request("/search?q=coaching")).data.results).toHaveLength(1);
    await request(`/memory/${src.id}`, {
      text: "The revised launch decision is now a quarterly cohort instead.",
    });
    expect((await request("/search?q=coaching")).data.results).toHaveLength(0);
    expect((await request("/search?q=quarterly")).data.results).toHaveLength(1);
  });
  test("invalid notes do not leave records; URL copies stay deduplicated after indexing", async () => {
    const before = (await request("/state")).data.sources.length;
    expect((await request("/memory", { text: "short" })).status).toBe(400);
    expect((await request("/state")).data.sources.length).toBe(before);
    const article = {
      url: "https://example.com/article",
      title: "Decisions",
      text: "This is supplied source content long enough to index locally.",
    };
    const original = await request("/memory", article);
    const copy = await request("/memory", article);
    expect(copy.data.duplicate).toBe(true);
    expect(copy.data.source.id).toBe(original.data.source.id);
  });
  test("text uploads extract content and classify unsupported files honestly", async () => {
    const result = await request("/memory", {
      filename: "meeting.md",
      base64: Buffer.from("# Meeting notes\nThe team agreed to publish on Thursday.").toString(
        "base64",
      ),
    });
    const state = (await request("/state")).data;
    const src = state.sources.find((s: any) => s.id === result.data.source.id);
    expect(src.status).toBe("ready");
    expect(src.text).toContain("Thursday");
    const unsupported = await request("/memory", {
      filename: "archive.zip",
      base64: Buffer.from("not a supported file").toString("base64"),
    });
    const failed = (await request("/state")).data.sources.find(
      (s: any) => s.id === unsupported.data.source.id,
    );
    expect(failed.status).toBe("error");
    expect((await request("/search?q=archive")).data.results).toHaveLength(0);
  });
  test("HTML import strips scripts and preserves readable article text", () => {
    const article = articleText(
      "<html><head><title>Useful context</title></head><body><nav>Noise</nav><article><h1>Useful context</h1><p>This is an article with enough readable text to discuss our publishing decisions.</p><script>secretScript()</script><p>We will release the next video on Thursday.</p></article></body></html>",
      "https://example.com",
    );
    expect(article.text).toContain("Thursday");
    expect(article.text).not.toContain("secretScript");
    expect(article.text).not.toContain("Noise");
  });
  test("public link import blocks private addresses before contacting them", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.1.2",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "::ffff:127.0.0.1",
    ])
      expect(privateAddress(ip)).toBe(true);
    await expect(fetchPublic("http://127.0.0.1")).rejects.toThrow("Private");
    await expect(fetchPublic("file:///etc/passwd")).rejects.toThrow("public");
    await expect(fetchPublic("https://example.com:8443")).rejects.toThrow("public");
  });
  test("drafts and triage persist without sending anything", async () => {
    await request("/inbox", {
      from: "Test sender",
      subject: "Review proposal",
      body: "Please review the proposal before Friday.",
    });
    const msg = (await request("/state")).data.inbox[0];
    await request("/inbox", {
      id: msg.id,
      draft: "Thanks, I will review this.",
      category: "sponsors",
      status: "done",
    });
    const saved = (await request("/state")).data.inbox[0];
    expect(saved.draft).toContain("review");
    expect(saved.status).toBe("done");
    expect(saved.category).toBe("sponsors");
    expect(saved.source).toBe("capture");
  });
  test("ICS import respects timezone, deduplicates events and expands recurring series", async () => {
    const ics =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-one\r\nDTSTART;TZID=Europe/Vienna:20260916T100000\r\nDTEND;TZID=Europe/Vienna:20260916T110000\r\nSUMMARY:Planning\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:test-recurring\r\nDTSTART:20260917T080000Z\r\nDTEND:20260917T090000Z\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nSUMMARY:Recurring review\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const first = await request("/calendar/import", { ics });
    expect(first.data.added).toBe(5);
    expect(first.data.recurring).toBe(1);
    expect((await request("/calendar/import", { ics })).data.added).toBe(0);
    const event = (await request("/state")).data.events[0];
    expect(event.start).toBe("2026-09-16T08:00:00.000Z");
    await request("/calendar", {
      id: event.id,
      notes: "Agreed next steps.",
      actions: [{ id: "a1", text: "Send a proposal", done: true }],
    });
    expect((await request("/state")).data.events[0].actions[0].done).toBe(true);
  });
  test("ICS recurrence honors DST, moved exceptions and exclusions, and updates the same occurrence", async () => {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:dst-series",
      "DTSTART;TZID=Europe/Vienna:20261019T100000",
      "DTEND;TZID=Europe/Vienna:20261019T110000",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "EXDATE;TZID=Europe/Vienna:20261102T100000",
      "SUMMARY:Weekly review",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:dst-series",
      "RECURRENCE-ID;TZID=Europe/Vienna:20261026T100000",
      "DTSTART;TZID=Europe/Vienna:20261027T120000",
      "DTEND;TZID=Europe/Vienna:20261027T130000",
      "SUMMARY:Moved review",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:all-day-series",
      "DTSTART;VALUE=DATE:20261023",
      "DTEND;VALUE=DATE:20261024",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:Day away",
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    const body = {
      ics: lines.join("\r\n"),
      timeMin: "2026-10-01T00:00:00Z",
      timeMax: "2026-12-01T00:00:00Z",
    };
    const first = await request("/calendar/import", body);
    expect(first.status).toBe(200);
    expect(first.data.added).toBe(5);
    const events = (await request("/state")).data.events.filter((event: any) =>
      event.sourceUid?.startsWith("dst-series::"),
    );
    expect(events.map((event: any) => event.start).sort()).toEqual([
      "2026-10-19T08:00:00.000Z",
      "2026-10-27T11:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
    ]);
    const moved = events.find((event: any) => event.title === "Moved review");
    expect(moved.sourceUid).toBe("dst-series::2026-10-26T09:00:00.000Z");
    await request("/calendar", { id: moved.id, notes: "Saved notes", actions: [] });
    const changed = await request("/calendar/import", {
      ...body,
      ics: body.ics
        .replace("20261027T120000", "20261028T120000")
        .replace("20261027T130000", "20261028T130000")
        .replace(
          "EXDATE;TZID=Europe/Vienna:20261102T100000",
          "EXDATE;TZID=Europe/Vienna:20261102T100000,20261109T100000",
        ),
    });
    expect(changed.status).toBe(200);
    expect(changed.data.added).toBe(0);
    const saved = (await request("/state")).data.events;
    expect(saved.find((event: any) => event.id === moved.id)).toMatchObject({
      start: "2026-10-28T11:00:00.000Z",
      notes: "Saved notes",
    });
    expect(saved.filter((event: any) => event.sourceUid?.startsWith("dst-series::"))).toHaveLength(
      2,
    );
    expect(
      saved
        .filter((event: any) => event.sourceUid?.startsWith("all-day-series::"))
        .map((event: any) => event.start)
        .sort(),
    ).toEqual(["2026-10-23T00:00:00", "2026-10-24T00:00:00"]);
  });
  test("goals persist, validate limits, and leave existing records intact", async () => {
    const before = (await request("/state")).data;
    const goals = {
      longTerm: "Build a durable business",
      quarter: "Launch the course",
      week: "Record three lessons",
      metrics: [
        {
          id: "videos",
          label: "Videos published",
          kind: "leading",
          value: 2,
          target: 3,
          unit: "videos",
        },
      ],
    };
    expect((await request("/goals", goals)).status).toBe(200);
    await stop();
    await start();
    expect((await request("/state")).data.goals).toEqual(goals);
    const afterSources = (await request("/state")).data.sources;
    expect(
      afterSources.filter((s: any) => before.sources.some((old: any) => old.id === s.id)),
    ).toEqual(before.sources);
    expect(
      afterSources.find((s: any) => s.connector?.provider === "business-setup")?.text,
    ).toContain(goals.quarter);
    expect(
      (await request("/goals", { ...goals, metrics: Array(6).fill(goals.metrics[0]) })).status,
    ).toBe(400);
    expect(
      (await request("/goals", { ...goals, metrics: [{ ...goals.metrics[0], target: 0 }] })).status,
    ).toBe(400);
    expect((await request("/state")).data.goals).toEqual(goals);
  });
  test("hidden legacy notes disappear from graphs and recall without changing their source", async () => {
    const dir = join(root, "src/data");
    mkdirSync(dir, { recursive: true });
    const snapshot = {
      isExample: false,
      generatedAt: "2026-09-16",
      memory: {
        nodes: [
          { id: "private", name: "Private refund" },
          { id: "keep", name: "Team notes" },
        ],
        links: [{ source: "private", target: "keep" }],
        knowledge: {
          graphs: [
            {
              vault: "Test",
              notes: [
                { id: "private", title: "Private refund", excerpt: "A private source detail." },
                { id: "team", title: "Team notes", excerpt: "Team launch planning." },
              ],
              links: [{ s: "private", t: "team" }],
            },
          ],
        },
      },
    };
    const raw = JSON.stringify(snapshot),
      file = join(dir, "live-data.json");
    writeFileSync(file, raw);
    expect((await request("/search?q=refund")).data.results).toHaveLength(1);
    await request("/memory/hide-existing", { title: "Private refund" });
    expect((await request("/search?q=refund")).data.results).toHaveLength(0);
    const filtered = JSON.parse(filterWorkspaceMemory(raw, root));
    expect(filtered.memory.nodes).toHaveLength(1);
    expect(filtered.memory.links).toHaveLength(0);
    expect(filtered.memory.knowledge.graphs[0].notes).toHaveLength(1);
    expect(readFileSync(file, "utf8")).toBe(raw);
  });
  test("brain source preferences persist and exclude recall without deleting memories", async () => {
    const added = await request("/memory", {
      title: "Brain source check",
      text: "Zephyr launch uses a private onboarding checklist for this integration check.",
      origin: "codex",
      collection: "projects",
    });
    expect(added.data.source.origin).toBe("codex");
    expect(
      (await request("/search?q=Zephyr")).data.results.some(
        (r: any) => r.id === added.data.source.id,
      ),
    ).toBe(true);
    const before = (await request("/state")).data;
    expect((await request("/brain/sources", { id: "codex", enabled: false })).status).toBe(200);
    expect(
      (await request("/search?q=Zephyr")).data.results.some(
        (r: any) => r.id === added.data.source.id,
      ),
    ).toBe(false);
    expect(
      (await request("/state")).data.sources.some(
        (r: any) => r.id === added.data.source.id && !r.deletedAt,
      ),
    ).toBe(true);
    await stop();
    await start();
    expect((await request("/state")).data.brainSources.codex).toBe(false);
    expect((await request("/state")).data.brainRevision).toBe((before.brainRevision || 0) + 1);
    await request("/brain/sources", { id: "email", enabled: false });
    await request("/brain/sources", { id: "meetings", enabled: false });
    await request("/brain/sources", { id: "business", enabled: false });
    const context = (await request("/brain/context")).data;
    expect(context.inbox).toHaveLength(0);
    expect(context.events).toHaveLength(0);
    expect(context.goals.week).toBe("");
    expect(context.sources.some((r: any) => r.origin === "codex")).toBe(false);
    expect((await request("/brain/sources", { id: "unknown", enabled: false })).status).toBe(400);
    for (const id of ["codex", "email", "meetings", "business"])
      await request("/brain/sources", { id, enabled: true });
    expect(
      (await request("/search?q=Zephyr")).data.results.some(
        (r: any) => r.id === added.data.source.id,
      ),
    ).toBe(true);
  });
  test("invalid event and corrupted storage never silently reset data", async () => {
    expect(
      (
        await request("/calendar", {
          title: "Invalid",
          start: "2026-09-16T10:00:00Z",
          end: "2026-09-16T09:00:00Z",
        })
      ).status,
    ).toBe(400);
    const file = join(root, ".operator-data/workspace.json"),
      original = readFileSync(file, "utf8");
    writeFileSync(file, "broken json");
    expect((await request("/state")).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe("broken json");
    writeFileSync(file, original);
  });
});

test("inbox view and local read preferences persist without changing account credentials", async () => {
  await request("/settings", {
    inboxAutoRead: false,
    inboxShowAccounts: true,
    inboxAccounts: { gmail: false },
  });
  const settings = (await request("/state")).data.settings;
  expect(settings.inboxAutoRead).toBe(false);
  expect(settings.inboxAccounts).toMatchObject({
    gmail: false,
    outlook: true,
    capture: true,
    slack: true,
  });
  await request("/inbox", {
    subject: "Read state test",
    body: "Open this message to check its local read flag.",
  });
  const message = (await request("/state")).data.inbox.find(
    (x: any) => x.subject === "Read state test",
  );
  expect(message.read).toBe(false);
  await request("/inbox", { id: message.id, read: true });
  expect(
    (await request("/state")).data.inbox.find((x: any) => x.id === message.id).readOverride,
  ).toBe(true);
  await request("/inbox", { id: message.id, read: false });
  expect((await request("/state")).data.inbox.find((x: any) => x.id === message.id).read).toBe(
    false,
  );
  await request("/inbox", { id: message.id, starred: true });
  expect((await request("/state")).data.inbox.find((x: any) => x.id === message.id).starred).toBe(
    true,
  );
  await request("/inbox", { id: message.id, starred: false });
  expect((await request("/state")).data.inbox.find((x: any) => x.id === message.id).starred).toBe(
    false,
  );
  await request("/inbox", {
    id: message.id,
    draft: "Saved reply",
    draftTo: "recipient@example.com",
    draftCc: "copy@example.com",
    draftBcc: "private@example.com",
  });
  expect((await request("/state")).data.inbox.find((x: any) => x.id === message.id)).toMatchObject({
    draft: "Saved reply",
    draftTo: "recipient@example.com",
    draftCc: "copy@example.com",
    draftBcc: "private@example.com",
  });
});

test("saved messages from a source this workspace does not read are ignored", async () => {
  await request("/settings", { inboxAccounts: { gmail: false } });
  const file = join(root, ".operator-data", "workspace.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const old = { id: "old-forum-message", source: "forum", from: "Forum", subject: "Old thread", body: "Old", receivedAt: "2026-01-01T00:00:00Z", category: "fyi", status: "open" };
  writeFileSync(file, JSON.stringify({ ...saved, inbox: [...saved.inbox, old], inboxImports: [...(saved.inboxImports || []), { provider: "forum", account: "old", importedAt: "2026-01-01T00:00:00Z", count: 1, via: "file" }], settings: { ...saved.settings, inboxAccounts: { ...saved.settings.inboxAccounts, forum: true } } }));
  try {
    const state = (await request("/state")).data;
    expect(state.inbox.some((item: any) => item.id === old.id)).toBe(false);
    expect((state.inboxImports || []).some((item: any) => item.provider === "forum")).toBe(false);
    expect(state.settings.inboxAccounts.forum).toBeUndefined();
    expect(state.settings.inboxAccounts.gmail).toBe(false);
    // Hidden, never deleted: an ordinary save keeps the old records on disk.
    await request("/settings", { inboxAccounts: { gmail: true } });
    const after = JSON.parse(readFileSync(file, "utf8"));
    expect(after.inbox.some((item: any) => item.id === old.id)).toBe(true);
    expect(after.inboxImports.some((item: any) => item.provider === "forum")).toBe(true);
    expect(after.settings.inboxAccounts.forum).toBe(true);
    expect(after.settings.inboxAccounts.gmail).toBe(true);
  } finally {
    writeFileSync(file, JSON.stringify(saved));
  }
});
test("local agent import updates a stable source and respects source exclusion", async () => {
  const dir = join(root, "fake-home/.codex/memories");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "project.md");
  writeFileSync(file, "The launch project uses a copper visual identity.");
  const listed = await request("/memory/local?provider=codex");
  expect(listed.data.files).toHaveLength(1);
  expect(listed.data.files[0].absolute).toBeUndefined();
  const added = await request("/memory/import-local", {
    provider: "codex",
    ids: [listed.data.files[0].id],
    collection: "projects",
  });
  expect(added.data.added).toBe(1);
  expect(
    (await request("/memory/import-local", { provider: "codex", ids: [listed.data.files[0].id] }))
      .data.unchanged,
  ).toBe(1);
  writeFileSync(file, "The launch project now uses an emerald visual identity.");
  const updated = await request("/memory/import-local", {
    provider: "codex",
    ids: [listed.data.files[0].id],
  });
  expect(updated.data.updated).toBe(1);
  expect(updated.data.sources[0].id).toBe(added.data.sources[0].id);
  expect(updated.data.sources[0].collection).toBe("projects");
  await request("/brain/sources", { id: "codex", enabled: false });
  expect(
    (await request("/brain/context")).data.sources.some(
      (s: any) => s.id === added.data.sources[0].id,
    ),
  ).toBe(false);
  expect(
    (await request("/state")).data.sources.some((s: any) => s.id === added.data.sources[0].id),
  ).toBe(true);
  const notion = await request("/memory/notion-config", {
    token: "ntn_fixture_for_configuration_only",
  });
  expect(notion.data).toEqual({ configured: true });
  const connectors = await request("/memory/connectors");
  expect(connectors.data.notion).toEqual({ configured: true });
  expect(JSON.stringify(connectors.data)).not.toContain("ntn_fixture");
});
test("conversation API saves full thread and deletes the selected thread", async () => {
  const saved = await request("/conversations", {
    messages: [
      { role: "user", text: "Remember the launch date.", brainRevision: 7, sourceIds: ["codex"] },
    ],
    persona: "assistant",
  });
  expect(saved.status).toBe(200);
  const restored = (await request("/conversations")).data.conversations[0];
  expect(restored.messages[0].brainRevision).toBe(7);
  expect(restored.messages[0].sourceIds).toEqual(["codex"]);
  await request(`/conversations/${restored.id}`, { action: "delete" });
  expect((await request("/conversations")).data.conversations).toHaveLength(0);
});
test("connected inbox snapshots persist and obey the shared email context switch", async () => {
  const body = {
    provider: "gmail",
    account: "snapshot@example.com",
    via: "codex",
    messages: [
      {
        id: "remote-message",
        from: "Sender",
        subject: "Snapshot proposal",
        body: "Please review our new business proposal.",
        receivedAt: "2026-09-16T12:00:00Z",
        read: false,
      },
    ],
  };
  const imported = await request("/inbox/import", body);
  expect(imported.status).toBe(200);
  expect(imported.data.added).toBe(1);
  expect((await request("/inbox/import", body)).data.updated).toBe(1);
  await stop();
  await start();
  expect((await request("/state")).data.inboxImports[0].count).toBe(1);
  await request("/brain/sources", { id: "email", enabled: false });
  const context = (await request("/brain/context")).data;
  expect(context.inbox).toEqual([]);
  expect(context.inboxImports).toEqual([]);
  await request("/brain/sources", { id: "email", enabled: true });
});

async function waitApp(id: string) {
  for (let n = 0; n < 300; n++) {
    const app = (await request("/memory/apps")).data.apps.find((a: any) => a.id === id);
    if (!app.queued && !["scanning", "syncing"].includes(app.status)) return app;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Memory app test timed out");
}
test("custom spaces persist, list excerpts stay bounded, and human search reads full excluded sources", async () => {
  const created = await request("/memory/spaces", {
    name: "Research library",
    color: "#18ab77",
    icon: "books",
  });
  expect(created.status).toBe(201);
  const space = created.data.space;
  expect((await request("/memory/spaces", { name: "research LIBRARY" })).status).toBe(400);
  expect((await request("/memory/apps/codex", { collection: "missing-space" })).status).toBe(400);
  const content = "A long visible source about launches. ".repeat(100) + " distantmarker791";
  const added = await request("/memory", {
    title: "Extended Codex source",
    text: content,
    collection: space.id,
    origin: "codex",
  });
  const sourceId = added.data.source.id;
  const state = (await request("/state")).data;
  const preview = state.sources.find((s: any) => s.id === sourceId);
  expect(preview.text.length).toBe(2000);
  expect(preview.textTruncated).toBe(true);
  expect(state.memorySpaces.find((s: any) => s.id === space.id).color).toBe("#18ab77");
  expect((await request(`/memory/${sourceId}`)).data.source.text).toBe(content);
  await request("/brain/sources", { id: "codex", enabled: false });
  expect((await request("/search?q=distantmarker791")).data.results).toEqual([]);
  expect(
    (await request(`/memory/search?q=distantmarker791&collection=${space.id}`)).data.ids,
  ).toContain(sourceId);
  expect((await request(`/memory/${sourceId}`, { collection: "invented-space" })).status).toBe(400);
  await request(`/memory/${sourceId}`, { action: "trash" });
  expect((await request("/memory/search?q=distantmarker791")).data.ids).toEqual([]);
  expect((await request("/memory/search?q=distantmarker791&trash=1")).data.ids).toContain(sourceId);
  await stop();
  await start();
  expect((await request("/state")).data.memorySpaces.some((s: any) => s.id === space.id)).toBe(
    true,
  );
});
test("app imports retire stale parts, restore regrowth, preserve short text and respect user trash", async () => {
  const file = join(root, "fake-home/.codex/memories/reconcile.md");
  const long = "A".repeat(180000) + "obsoletepartmarker ".repeat(1000);
  writeFileSync(file, long);
  await request("/memory/apps/codex", {
    enabled: true,
    scopes: { conversations: false, skills: false },
  });
  // An enabled importer must still respect the global source switch.
  await request("/brain/sources", { id: "codex", enabled: false });
  expect((await request("/memory/apps/codex/sync", {})).status).toBe(202);
  expect((await waitApp("codex")).error).toContain("Enable this app and its memory source");
  expect((await request("/state")).data.sources.filter((s: any) => s.connector?.path?.endsWith("reconcile.md"))).toHaveLength(0);
  await request("/brain/sources", { id: "codex", enabled: true });
  const sync = async () => {
    expect((await request("/memory/apps/codex/sync", {})).status).toBe(202);
    expect((await waitApp("codex")).status).toBe("idle");
    return (await request("/state")).data.sources.filter((s: any) =>
      s.connector?.path?.endsWith("reconcile.md"),
    );
  };
  let records = await sync();
  expect(records.filter((s: any) => !s.deletedAt)).toHaveLength(2);
  writeFileSync(file, "Retired.");
  records = await sync();
  expect(records.filter((s: any) => !s.deletedAt)).toHaveLength(1);
  expect(records.find((s: any) => !s.deletedAt).text).toContain("Retired.");
  expect(records.find((s: any) => s.deletedAt).connector.supersededAt).toBeDefined();
  expect((await request("/memory/search?q=obsoletepartmarker")).data.ids).toEqual([]);
  writeFileSync(file, long);
  records = await sync();
  expect(records.filter((s: any) => !s.deletedAt)).toHaveLength(2);
  const tail = records.find((s: any) => s.connector.itemId.endsWith(":part:1"));
  await request(`/memory/${tail.id}`, { action: "trash" });
  writeFileSync(file, long + "Updated tail.");
  records = await sync();
  expect(records.find((s: any) => s.id === tail.id).deletedAt).toBeDefined();
  expect(records.find((s: any) => s.id === tail.id).connector.supersededAt).toBeUndefined();
  writeFileSync(file, "\n\n");
  records = await sync();
  expect(records.filter((s: any) => !s.deletedAt)).toHaveLength(0);
  writeFileSync(file, "A restored source with useful text.");
  records = await sync();
  expect(records.filter((s: any) => !s.deletedAt)).toHaveLength(1);
  writeFileSync(file, "");
  records = await sync();
  expect(records.filter((s: any) => !s.deletedAt)).toHaveLength(0);
});
test("saved mail imports into a space without claiming a connected account or provider freshness", async () => {
  const gmail = (await request("/memory/apps")).data.apps.find((a: any) => a.id === "gmail");
  expect(gmail.available).toBe(true);
  expect(gmail.accountConnected).toBe(false);
  expect(gmail.canSync).toBe(true);
  await request("/memory/apps/gmail", { enabled: true });
  await request("/memory/apps/gmail/sync", {});
  const disconnected = await waitApp("gmail");
  expect(disconnected.status).toBe("idle");
  expect(disconnected.accountConnected).toBe(false);
  expect(disconnected.lastImport).toBeDefined();
  expect(disconnected.lastSync).toBeUndefined();
  expect((await request("/memory/apps/gmail/import", { collection: "projects" })).status).toBe(202);
  const imported = await waitApp("gmail");
  expect(imported.lastImport).toBeDefined();
  expect(imported.lastSync).toBeUndefined();
  expect(imported.collection).toBe("projects");
  const source = (await request("/state")).data.sources.find(
    (s: any) => s.connector?.provider === "gmail",
  );
  expect(source.origin).toBe("email");
  expect(source.collection).toBe("projects");
  // Routine sync preserves a manually chosen space; explicit import can move it.
  await request(`/memory/${source.id}`, { collection: "business" });
  await request("/memory/apps/gmail/sync", {});
  await waitApp("gmail");
  expect((await request(`/memory/${source.id}`)).data.source.collection).toBe("business");
  await request("/memory/apps/gmail/import", { collection: "projects" });
  await waitApp("gmail");
  expect((await request(`/memory/${source.id}`)).data.source.collection).toBe("projects");
});

test("batch source toggles validate atomically, write once, and only revise effective changes", async () => {
  const ids = BRAIN_SOURCES.map((s) => s.id),
    file = join(root, ".operator-data/workspace.json"),
    preferences = join(root, ".operator-data/brain-preferences.json");
  const before = (await request("/state")).data;
  const original = readFileSync(file, "utf8"), originalModified = statSync(file).mtimeMs;
  const off = await request("/brain/sources", { ids, enabled: false });
  expect(off.status).toBe(200);
  expect(off.data).toMatchObject({
    ok: true,
    changed: true,
    brainRevision: (before.brainRevision || 0) + 1,
  });
  const disabled = (await request("/state")).data;
  expect(ids.every((id) => disabled.brainSources[id] === false)).toBe(true);
  expect(off.data.brainSources).toEqual(disabled.brainSources);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(statSync(file).mtimeMs).toBe(originalModified);
  expect(statSync(preferences).mode & 0o777).toBe(0o600);
  expect(statSync(preferences).size).toBeLessThan(4096);
  const saved = readFileSync(file, "utf8");
  const savedPreferences = readFileSync(preferences, "utf8");
  const repeat = await request("/brain/sources", { ids, enabled: false });
  expect(repeat.data.changed).toBe(false);
  expect(repeat.data.brainRevision).toBe(off.data.brainRevision);
  expect(readFileSync(file, "utf8")).toBe(saved);
  expect(readFileSync(preferences, "utf8")).toBe(savedPreferences);
  for (const body of [
    { ids: ["codex", "unknown"], enabled: true },
    { ids: ["codex", "codex"], enabled: true },
    { ids: [], enabled: true },
    { ids: "codex", enabled: true },
    { ids: ["codex", 5], enabled: true },
    { ids: ["codex"], enabled: "true" },
    { id: "claude", ids: ["codex"], enabled: true },
  ]) {
    expect((await request("/brain/sources", body)).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe(saved);
    expect(readFileSync(preferences, "utf8")).toBe(savedPreferences);
  }
  const on = await request("/brain/sources", { ids, enabled: true });
  expect(on.data.brainRevision).toBe(off.data.brainRevision + 1);
  const enabled = (await request("/state")).data;
  expect(ids.every((id) => enabled.brainSources[id] === true)).toBe(true);
  const individual = await request("/brain/sources", { id: "codex", enabled: true });
  expect(individual.data.changed).toBe(false);
  expect(individual.data.brainRevision).toBe(on.data.brainRevision);
  expect(
    (await request("/brain/sources", { id: "codex", enabled: false })).data.brainRevision,
  ).toBe(on.data.brainRevision + 1);
});

test("small source preferences survive restart and subsequent workspace writes", async () => {
  const before = (await request("/brain/sources")).data;
  expect(before.brainSources.codex).toBe(false);
  await stop();
  await start();
  expect((await request("/brain/sources")).data).toEqual(before);
  expect((await request("/state")).data.brainRevision).toBe(before.brainRevision);
  await request("/settings", { news: false });
  const saved = JSON.parse(readFileSync(join(root, ".operator-data/workspace.json"), "utf8"));
  expect(saved.brainSources.codex).toBe(false);
  expect(saved.brainRevision).toBe(before.brainRevision);
  expect((await request("/brain/sources")).data).toEqual(before);
});

test("graph context is a small business-only projection and respects source preferences", async () => {
  await request("/business", { profile: { businessName: "Graph fixture business", preferredName: "PRIVATE-GRAPH-NAME", personalPriorities: "PRIVATE-GRAPH-PRIORITY" } });
  await request("/business/finances", { accounts: [{ name: "Graph cash balance", balance: 12, currency: "USD" }], recordedAt: "2026-09-16" });
  await request("/brain/sources", { id: "business", enabled: true });
  const graph = (await request("/brain/context?view=graph")).data;
  expect(Object.keys(graph)).toEqual(["business"]);
  expect(Object.keys(graph.business).sort()).toEqual(["audience", "finances", "profile", "progress"]);
  expect(graph.business.profile.businessName).toBe("Graph fixture business");
  expect(graph.business.finances.accounts[0].balance).toBe(12);
  expect(JSON.stringify(graph)).not.toContain("PRIVATE-GRAPH-");
  const context = (await request("/brain/context")).data;
  expect(context.sources).toBeDefined();
  expect(context.personalProfile.preferredName).toBe("PRIVATE-GRAPH-NAME");
  await request("/brain/sources", { id: "business", enabled: false });
  expect((await request("/brain/context?view=graph")).data).toEqual({ business: null });
  expect((await request("/brain/context")).data.business).toBeNull();
});

test("corrupt source preferences fail closed without overwriting persisted state", async () => {
  const file = join(root, ".operator-data/brain-preferences.json");
  const valid = readFileSync(file, "utf8");
  writeFileSync(file, "invalid-json");
  try {
    for (const path of ["/brain/sources", "/brain/context?view=graph", "/state"])
      expect((await request(path)).status).toBe(400);
    expect((await request("/brain/sources", { id: "codex", enabled: true })).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe("invalid-json");
  } finally { writeFileSync(file, valid); }
});

test("inbox questions use the authenticated read-only route and return loaded excerpts", async () => {
  await request("/inbox", { subject: "Questionroute fixture", body: "The questionroute budget is EUR 200.", from: "Local fixture" });
  const before = readFileSync(join(root, ".operator-data", "workspace.json"), "utf8");
  const result = await request("/inbox/ask", { question: "questionroute budget", summarize: false });
  expect(result.status).toBe(200);
  expect(result.data.mode).toBe("search");
  expect(result.data.results.some((item: any) => item.excerpt.includes("EUR 200"))).toBe(true);
  expect(readFileSync(join(root, ".operator-data", "workspace.json"), "utf8")).toBe(before);
  expect((await request("/inbox/ask", { question: "" })).status).toBe(400);
  const denied = await fetch(base + "/inbox/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "questionroute budget" }) });
  expect(denied.status).toBe(403);
});


test("profile endpoint saves optional UTC setup, reuses its memory source, and gates all personal context", async () => {
  const first = await request("/profile", { name: "", role: "", about: "", responsePreferences: "", timeZone: "UTC", currency: "USD", onboardingStep: 1 });
  expect(first.status).toBe(200);
  expect(first.data.onboardingStep).toBe(1);
  const personalSources = () => request("/state").then(r => r.data.sources.filter((s: any) => s.connector?.provider === "workspace-profile"));
  const sources = await personalSources();
  expect(sources).toHaveLength(1);
  expect(sources[0].text).toContain("Timezone: UTC");
  expect(sources[0].origin).toBe("personal");
  const avatar = "data:image/png;base64,iVBORw0KGgo=";
  const saved = await request("/profile", { name: "Personal Profile Fixture", about: "PRIVATE-PROFILE-CONTEXT", avatar, complete: true, onboardingStep: 2 });
  expect(saved.status).toBe(200);
  expect(saved.data.onboardingCompletedAt).toBeTruthy();
  expect((await personalSources())[0].id).toBe(sources[0].id);
  expect((await personalSources())[0].text).not.toContain("base64");
  await request("/brain/sources", { id: "personal", enabled: true });
  const context = (await request("/brain/context")).data;
  expect(context.personalProfile.name).toBe("Personal Profile Fixture");
  expect(context.personalProfile.preferredName).toBe("Personal Profile Fixture");
  expect(context.personalProfile.about).toBe("PRIVATE-PROFILE-CONTEXT");
  expect(context.personalProfile.avatar).toBeUndefined();
  expect(context.personalProfile.onboardingCompletedAt).toBeUndefined();
  await request("/brain/sources", { id: "personal", enabled: false });
  const gated = (await request("/brain/context")).data;
  expect(gated.personalProfile).toBeNull();
  expect(JSON.stringify(gated)).not.toContain("PRIVATE-PROFILE-CONTEXT");
  expect((await request("/search?q=PRIVATE-PROFILE-CONTEXT")).data.results).toHaveLength(0);
  expect((await request("/profile")).data.about).toBe("PRIVATE-PROFILE-CONTEXT");
  await request("/brain/sources", { id: "personal", enabled: true });
  await stop(); await start();
  expect((await request("/profile")).data).toEqual(saved.data);
  expect((statSync(join(root, ".operator-data/profile.json")).mode & 0o777)).toBe(0o600);
  await request("/profile", { name: "" });
  expect((await request("/brain/context")).data.personalProfile.preferredName).toBe("");
});

test("profile endpoints reject unauthorized changes and corrupt storage without replacing valid data", async () => {
  const file = join(root, ".operator-data/profile.json");
  const valid = readFileSync(file, "utf8");
  const denied = await fetch(base + "/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Unauthorized" }) });
  expect(denied.status).toBe(403);
  const crossSite = await fetch(base + "/profile", { headers: { Origin: "https://example.com" } });
  expect(crossSite.status).toBe(403);
  for (const body of [null, [], { timeZone: "Fake/Zone" }, { avatar: "https://example.com/profile.png" }, { onboardingStep: 99 }]) {
    expect((await request("/profile", body)).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe(valid);
  }
  writeFileSync(file, JSON.stringify({ ...JSON.parse(valid), credential: "NEVER-PUBLISH-THIS" }));
  expect(JSON.stringify((await request("/profile")).data)).not.toContain("NEVER-PUBLISH-THIS");
  expect(JSON.stringify((await request("/brain/context")).data)).not.toContain("NEVER-PUBLISH-THIS");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(valid), onboardingStep: 99 }));
  try {
    expect((await request("/profile")).status).toBe(400);
    expect((await request("/profile", { name: "Do not overwrite" })).status).toBe(400);
    expect(JSON.parse(readFileSync(file, "utf8")).onboardingStep).toBe(99);
  } finally { writeFileSync(file, valid); }
  const workspaceFile = join(root, ".operator-data/workspace.json");
  const workspace = readFileSync(workspaceFile, "utf8");
  writeFileSync(workspaceFile, "invalid-json");
  try {
    expect((await request("/profile", { name: "Do not half-save" })).status).toBe(400);
    expect(readFileSync(file, "utf8")).toBe(valid);
  } finally { writeFileSync(workspaceFile, workspace); }
});

test("a brief refresh only accepts an assistant from the catalog and never starts generating for a refused key", async () => {
  expect((await request("/business/brief/status")).data).toMatchObject({ generating: false, model: null });
  const malformed = await request("/business/brief/refresh", { timezone: "Europe/Vienna", model: "nope" });
  expect(malformed.status).toBeGreaterThanOrEqual(400);
  expect(malformed.data.error).toContain("Choose an assistant");
  const unknown = await request("/business/brief/refresh", { timezone: "Europe/Vienna", model: "claude|claude-code|not-a-real-model" });
  expect(unknown.status).toBeGreaterThanOrEqual(400);
  expect(unknown.data.error).toContain("not available");
  expect((await request("/business/brief/status")).data).toMatchObject({ generating: false, model: null });
  expect(existsSync(join(root, ".operator-data", "business-brief-settings.json"))).toBe(false);
});

test("demo numbers switch off on their own once live business records exist", async () => {
  const demoRoot = mkdtempSync(join(tmpdir(), "operator-demo-"));
  const plugin = operatorPlugin({ root: demoRoot, token, memoryHome: join(demoRoot, "fake-home") });
  let middleware: any;
  (plugin.configureServer as any)({ middlewares: { use: (_path: string, fn: any) => (middleware = fn) } });
  const local = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(local.address() as any).port}`;
  const call = async (path: string, body?: any) => {
    const r = await fetch(origin + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token }, body: JSON.stringify(body) });
    return (await r.json()) as any;
  };
  try {
    expect(await call("/business/demo", { enabled: true })).toEqual({ enabled: true, requested: true, liveData: false });
    expect((await call("/business/brief/status")).demo).toBe(true);
    await call("/business/finances", { accounts: [{ name: "Fixture checking", balance: 10, currency: "USD" }], recordedAt: "2026-09-17", sourceLabel: "Fixture bank" });
    expect(await call("/business/demo")).toEqual({ enabled: false, requested: false, liveData: true });
    expect(await call("/business/brief/status")).toEqual({ generating: false, demo: false, model: null });
    // A stale flag written later can no longer bring demo numbers back while live data exists.
    expect(await call("/business/demo", { enabled: true })).toEqual({ enabled: false, requested: true, liveData: true });
    expect((await call("/business")).finances.accounts[0].name).toBe("Fixture checking");
  } finally {
    (plugin.closeBundle as any)?.();
    await new Promise<void>((resolve) => local.close(() => resolve()));
    rmSync(demoRoot, { recursive: true, force: true });
  }
});

test("a dated question ranks memory records from that window first, even without keyword overlap", () => {
  const record = (id: string, title: string, text: string, activityAt?: string, path?: string): MemorySource => ({
    id, title, text, kind: "document", origin: "codex", collection: "business", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T12:00:00.000Z", status: "ready", pinned: false, words: 3, hash: id,
    connector: { provider: "codex", itemId: id, syncedAt: "2026-09-18T12:00:00.000Z", path, activityAt },
  });
  const now = new Date(2026, 8, 18, 10, 30);
  const sources = [
    record("old", "Codex · rollout-2026-09-16T08-00-00-old", "User:\nCodex conversation about the morning routine and Codex again.", new Date(2026, 8, 16, 9).toISOString()),
    record("fresh", "Codex · rollout-2026-09-18T09-12-33-new", "User:\nPlanning the retention video edit.", new Date(2026, 8, 18, 11, 40).toISOString()),
    record("undated", "Pricing notes", "Assistant:\nA Codex pricing table.", undefined),
  ];
  const window = chatTimeWindow("what was the conversation I had with Codex this morning?", now);
  const ranked = searchSources(sources, "what was the conversation I had with Codex this morning?", undefined, window);
  expect(ranked.map((r) => r.id)).toEqual(["fresh", "old", "undated"]);
  expect(ranked.map((r) => r.inWindow)).toEqual([true, false, false]);
  const plain = searchSources(sources, "codex conversation", undefined, null);
  expect(plain.map((r) => r.id)).toEqual(["old", "fresh", "undated"]);
  expect(plain.every((r) => r.inWindow === false)).toBe(true);
});

// Synthetic memory records shaped like app imports. Times are built locally.
const memoryRecord = (
  id: string,
  title: string,
  text: string,
  options: { origin?: string; provider?: string; activityAt?: string; path?: string } = {},
): MemorySource => ({
  id, title, text, kind: "document", origin: options.origin ?? "codex", collection: "business",
  createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T12:00:00.000Z", status: "ready", pinned: false, words: 3, hash: id,
  connector: { provider: options.provider ?? options.origin ?? "codex", itemId: id, syncedAt: "2026-09-18T12:00:00.000Z", path: options.path, activityAt: options.activityAt },
});

test("an exact session name outranks records that merely repeat its digits", () => {
  const noise = Array.from({ length: 6 }, (_, n) => `[${n}] Codex · rollout-2026-09-1${n}T12-0${n}-00-old (source x) rollout 2026 09 18 12 31`).join("\n");
  const sources = [
    memoryRecord("runtime", "Codex · rollout-2026-09-18T12-51-34-runtime", `User:\nRETRIEVED SOURCES:\n${noise}`),
    memoryRecord("real", "Codex · rollout-2026-09-18T12-31-08-real", "User:\nHey, find my tracking sheet.\n\nAssistant:\nLooking now."),
  ];
  const found = searchMemory(sources, "rollout-2026-09-18T12-31", undefined, null);
  expect(found.results.map((r) => r.id)).toEqual(["real", "runtime"]);
  expect(found.focus).toEqual([]);
  expect(found.closest).toBeUndefined();
});

test("a question that names an app returns that app's records and drops the others", () => {
  const now = new Date(2026, 8, 18, 13, 45);
  const window = chatTimeWindow("what did I say to Codex this morning?", now);
  const sources = [
    memoryRecord("claude-title", "Claude · aaaa0001", "User:\nReply with ONLY a 3-5 word title that summarises this conversation about codex and what I say each morning.", { origin: "claude", activityAt: new Date(2026, 8, 18, 11, 16).toISOString(), path: "~/.claude/projects/-Users-x/aaaa0001.jsonl" }),
    memoryRecord("claude-work", "Claude · aaaa0002", "User:\nlet's start with the launch checklist", { origin: "claude", activityAt: new Date(2026, 8, 18, 12, 30).toISOString(), path: "~/.claude/projects/-Users-x/aaaa0002.jsonl" }),
    memoryRecord("codex-real", "Codex · rollout-2026-09-18T12-31-08-real", "User:\nPlease find the tracking sheet you designed yesterday.\n\nAssistant:\nWas it a spreadsheet or a web page?", { activityAt: new Date(2026, 8, 18, 12, 52).toISOString(), path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T12-31-08-real.jsonl" }),
    memoryRecord("codex-skill", "Codex · agent-reach", "---\nname: agent-reach\ndescription: research anything on the internet.", { origin: "skills", provider: "codex", activityAt: new Date(2026, 8, 10, 11).toISOString() }),
  ];
  const found = searchMemory(sources, "what did I say to Codex this morning?", undefined, window);
  expect(found.focus).toEqual([{ id: "codex", name: "Codex" }]);
  expect(found.results.map((r) => r.id)).toEqual(["codex-real", "codex-skill"]);
  expect(found.results[0]).toMatchObject({ inWindow: true, appMatch: true, sameDay: true });
  expect(found.closest).toBeUndefined();
  // Without any Codex record, other apps' records still come back (in-window, then by keyword score), flagged as not from that app.
  const fallback = searchMemory(sources.slice(0, 2), "what did i say to codex this morning?", undefined, window);
  expect(fallback.results.map((r) => r.id)).toEqual(["claude-title", "claude-work"]);
  expect(fallback.results.every((r) => r.appMatch === false)).toBe(true);
});

test("the OS's own check and runtime transcripts never surface in search", () => {
  const sources = [
    memoryRecord("probe", "Claude · aaaa0003", "User:\nReply with ONLY a 3-5 word title.\n\nUSER: This is a local Operator OS integration test. Reply with exactly OPERATOR_READY.", { origin: "claude", path: "~/.claude/projects/-Users-x/aaaa0003.jsonl" }),
    memoryRecord("task", "Claude · agent-run", "User:\nSummarise the integration plan for the sponsor.", { origin: "claude", path: "~/.claude/projects/-Users-x-code-os--operator-data-agent-tasks-example01-claude/run.jsonl" }),
    memoryRecord("check", "Claude · probe-folder", "User:\nSay hello for the integration plan.", { origin: "claude", path: "~/.claude/projects/-private-var-folders-T-jarvis-claude-check-EXAMPLE/probe.jsonl" }),
    memoryRecord("runtime", "Codex · rollout-2026-09-18T12-51-34-runtime", "User:\nYou are Agentic, the concise thinking partner inside Agentic OS. Help the user navigate the integration plan.", { path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T12-51-34-runtime.jsonl" }),
    memoryRecord("brief", "Codex · rollout-2026-09-18T12-49-59-brief", "User:\nWrite a useful, calm, readable daily business briefing for the workspace owner using ONLY the evidence packet below. Integration plan.", { path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T12-49-59-brief.jsonl" }),
    memoryRecord("real", "Claude · aaaa0004", "User:\nWe moved the onboarding course; check the integration plan.", { origin: "claude", path: "~/.claude/projects/-Users-x/aaaa0004.jsonl" }),
  ];
  expect(searchSources(sources, "integration plan", undefined, null).map((r) => r.id)).toEqual(["real"]);
});

test("an empty window falls back to the nearest same-day record and names it", () => {
  const now = new Date(2026, 8, 18, 15, 0);
  const window = chatTimeWindow("what did I ask Codex this morning?", now);
  const sources = [
    memoryRecord("later", "Codex · rollout-2026-09-18T14-10-00-later", "User:\nSecond afternoon session.", { activityAt: new Date(2026, 8, 18, 14, 20).toISOString(), path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T14-10-00-later.jsonl" }),
    memoryRecord("near", "Codex · rollout-2026-09-18T13-30-14-near", "User:\nFirst afternoon session.", { activityAt: new Date(2026, 8, 18, 13, 31).toISOString(), path: "~/.codex/sessions/2026/09/18/rollout-2026-09-18T13-30-14-near.jsonl" }),
    memoryRecord("yesterday", "Codex · rollout-2026-09-17T09-00-00-old", "User:\nYesterday morning I asked Codex about the morning brief and Codex again.", { activityAt: new Date(2026, 8, 17, 9, 30).toISOString(), path: "~/.codex/sessions/2026/09/17/rollout-2026-09-17T09-00-00-old.jsonl" }),
  ];
  const found = searchMemory(sources, "what did I ask Codex this morning?", undefined, window);
  expect(found.results.map((r) => r.id)).toEqual(["near", "later", "yesterday"]);
  expect(found.results.map((r) => r.inWindow)).toEqual([false, false, false]);
  expect(found.results.map((r) => r.sameDay)).toEqual([true, true, false]);
  expect(found.closest).toEqual({ id: "near", title: "Codex · rollout-2026-09-18T13-30-14-near", label: "13:30 Codex session" });
});

test("a question about an app itself ranks its last 7 days first; undated records sit below dated ones of equal score", () => {
  const now = new Date(2026, 8, 18, 15, 0).getTime();
  const sources = [
    memoryRecord("ads", "Claude · ads-and-trials", "User:\nAds and free trials over roughly the past three months.", { origin: "claude", activityAt: new Date(2026, 5, 20, 10).toISOString() }),
    memoryRecord("undated", "Claude · undated-notes", "User:\nDashboard issues.", { origin: "claude" }),
    memoryRecord("today", "Claude · aaaa0005", "User:\nMake the New chat button easier to find.", { origin: "claude", activityAt: new Date(2026, 8, 18, 12, 40).toISOString() }),
    memoryRecord("lastweek", "Claude · aaaa0002", "User:\nHermes design pass on the portal.", { origin: "claude", activityAt: new Date(2026, 8, 13, 9).toISOString() }),
    memoryRecord("codex", "Codex · rollout-2026-09-18T12-31-08-real", "User:\nClaude was mentioned here too.", { activityAt: new Date(2026, 8, 18, 12, 52).toISOString() }),
  ];
  const found = searchMemory(sources, "How about Claude?", undefined, null, { now });
  expect(found.focus).toEqual([{ id: "claude", name: "Claude" }]);
  expect(found.results.map((r) => r.id)).toEqual(["today", "lastweek", "ads", "undated"]);
  expect(found.results.map((r) => r.recent)).toEqual([true, true, false, false]);
  expect(found.results[0]).toMatchObject({ app: "claude", activityAt: new Date(2026, 8, 18, 12, 40).toISOString() });
  expect(found.results[3].activityAt).toBeUndefined();
  expect(found.appRecords).toEqual({ claude: 4, codex: 1 });
  // A topic word turns it into a keyword search: the matching record wins whatever its age.
  expect(searchMemory(sources, "the Claude session about Hermes design", undefined, null, { now }).results[0].id).toBe("lastweek");
  // The focus a follow-up inherited overrides what its words name.
  expect(searchMemory(sources, "and the same?", undefined, null, { focus: [{ id: "codex", name: "Codex" }], now }).results.map((r) => r.id)).toEqual(["codex"]);
});

test("the OS's own Claude-backed runtime, auto-title and dream side calls never surface in search", () => {
  const sources = [
    memoryRecord("legacy-runtime", "Claude · 1a2b", "User:\nYou are Operator, the concise assistant inside Agentic OS. Help the user with the dashboard issues.", { origin: "claude" }),
    memoryRecord("auto-title", "Claude · 3c4d", "User:\nReply with ONLY a 3-5 word title (no quotes, no punctuation at the end) that summarizes this conversation.\n\nUSER: You are Operator, the concise assistant inside…", { origin: "claude" }),
    memoryRecord("dream", "Claude · 5e6f", "User:\nIMPORTANT: You are being run non-interactively with no file tools. Dashboard issues.", { origin: "claude" }),
    memoryRecord("real", "Claude · 7g8h", "User:\nThe dashboard issues are fixed; ship it.", { origin: "claude" }),
  ];
  expect(searchSources(sources, "dashboard issues", undefined, null).map((r) => r.id)).toEqual(["real"]);
  expect(searchMemory(sources, "dashboard issues", undefined, null).appRecords).toEqual({ claude: 1 });
});

test("a Claude transcript imports the user's words only, refreshes its activity stamp on an unchanged re-read, and a follow-up's inherited window reaches /search", async () => {
  const dir = join(root, "fake-home/.claude/projects/-Users-example");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "aaaa0005.jsonl");
  const row = (type: "user" | "assistant", text: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type, message: { role: type, content: type === "user" ? text : [{ type: "text", text }] }, ...extra }) + "\n";
  writeFileSync(
    file,
    row("user", "Hey, make the New chat button easier to find.") +
      row("user", "<command-name>/clear</command-name>") +
      row("user", "SKILL_BODY injected by the harness.", { isMeta: true }) +
      row("assistant", "The header button is hidden on desktop; I will show it."),
  );
  const first = new Date(new Date().setHours(12, 40, 0, 0));
  utimesSync(file, first, first);
  await request("/memory/apps/claude", { enabled: true, scopes: { memories: false, skills: false } });
  expect((await request("/memory/apps/claude/sync", {})).status).toBe(202);
  expect((await waitApp("claude")).status).toBe("idle");
  const saved = (await request("/state")).data.sources.find((s: any) => s.connector?.path?.endsWith("aaaa0005.jsonl"));
  expect(saved.connector.activityAt).toBe(first.toISOString());
  expect(saved.text).toContain("New chat button");
  expect(saved.text).toContain("hidden on desktop");
  expect(saved.text).not.toContain("command-name");
  expect(saved.text).not.toContain("SKILL_BODY");
  // Identical text with a newer modification time counts as unchanged, yet the stamp moves with it.
  const later = new Date(new Date().setHours(14, 5, 0, 0));
  utimesSync(file, later, later);
  expect((await request("/memory/apps/claude/sync", {})).status).toBe(202);
  const status = await waitApp("claude");
  expect(status.status).toBe("idle");
  expect(status.progress.unchanged).toBe(1);
  const restamped = (await request("/state")).data.sources.find((s: any) => s.id === saved.id);
  expect(restamped.connector.activityAt).toBe(later.toISOString());
  // The follow-up passes the window and app it inherited; hits carry their app and stamp, and every app's record count comes back.
  const window = chatTimeWindow("this afternoon", new Date(new Date().setHours(15, 0, 0, 0)))!;
  const search = await request(`/search?q=${encodeURIComponent("How about Claude?")}&from=${window.start}&to=${window.end}&label=${encodeURIComponent(window.label)}&apps=claude`);
  expect(search.data.window).toEqual(window);
  expect(search.data.focus).toEqual([{ id: "claude", name: "Claude" }]);
  expect(search.data.appRecords.claude).toBeGreaterThanOrEqual(1);
  expect(search.data.results[0]).toMatchObject({ id: saved.id, app: "claude", inWindow: true, activityAt: later.toISOString() });
  // Without the inherited window the same words still find it as the app's recent record.
  const plain = await request(`/search?q=${encodeURIComponent("How about Claude?")}`);
  expect(plain.data.window).toBeNull();
  expect(plain.data.results.some((r: any) => r.id === saved.id && r.recent === true)).toBe(true);
});

test("MCP status starts signed out and rejects unknown providers", async () => {
  expect((await request("/mcp/status")).data).toEqual({ notion: { connected: false, requiresSignIn: true }, mercury: { connected: false, requiresSignIn: true } });
  const rejected = await request("/mcp/connect", { provider: "gmail" });
  expect(rejected.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(rejected.data)).toMatch(/Notion or Mercury/);
  expect((await request("/business/native-connections")).data.mercury).toMatchObject({ available: false, requiresSignIn: true });
});
