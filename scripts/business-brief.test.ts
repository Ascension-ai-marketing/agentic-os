import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { briefGeneratorFor, briefModelSettings, businessBrief, checkedBriefModelKey, findBriefModel } from "./business-brief";
import { writeBrainPreferences } from "./brain-preferences";

const roots: string[] = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "business-brief-test-")); roots.push(root);
  mkdirSync(join(root, ".operator-data")); mkdirSync(join(root, "src", "data"), { recursive: true });
  const write = (name: string, data: any) => writeFileSync(join(root, name), JSON.stringify(data));
  return { root, write, service: businessBrief(root) };
}
const document = (date = "2026-09-15") => ({ date, timezone: "Europe/Vienna", headline: "Your morning brief", summary: "A source-grounded summary.", priorities: ["Review the proposal."], sections: [{ id: "business", title: "Business", body: "A measured observation.", sources: [{ label: "Saved business", ref: "business:workspace", recordedAt: "2026-09-15T05:00:00Z" }] }] });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("daily business briefs", () => {
  test("priority completion persists through reload, regeneration and archive without crossing unrelated evidence", () => {
    const { root, service } = workspace();
    const sources = [[{ label: "Contract delivery", ref: "inbox-thread:client-a-contract-1" }]];
    const first = service.save({ ...document(), priorities: ["Send the final invoice."], prioritySources: sources }).latest!;
    const key = first.priorityActions![0].id;
    expect(first.priorityActions![0].completed).toBe(false);
    const changed = service.setAction({ reportId: first.id, priorityKey: key, completed: true });
    expect(changed.report.priorityActions![0].completedAt).toBeTruthy();
    const reopened = businessBrief(root);
    expect(reopened.get(first.id)?.priorityActions![0].completed).toBe(true);
    const same = reopened.save({ ...document(), priorities: ["Send  the final invoice!"], prioritySources: sources }).latest!;
    expect(same.priorityActions![0].id).toBe(key);
    expect(same.priorityActions![0].completed).toBe(true);
    const tomorrow = reopened.save({ ...document("2026-09-16"), priorities: ["Send the final invoice."], prioritySources: sources }).latest!;
    expect(tomorrow.priorityActions![0].completed).toBe(true);
    const unrelated = reopened.save({ ...document("2026-09-17"), priorities: ["Send the final invoice."], prioritySources: [[{ label: "Different contract", ref: "inbox-thread:client-b-contract-2" }]] }).latest!;
    expect(unrelated.priorityActions![0].completed).toBe(false);
    expect(unrelated.priorityActions![0].id).not.toBe(key);
    const historical = reopened.setAction({ reportId: first.id, priorityKey: key, completed: false });
    expect(historical.report.id).toBe(first.id);
    expect(historical.report.priorityActions![0].completedAt).toBeUndefined();
    expect(historical.latest?.id).toBe(unrelated.id);
    expect(reopened.get(tomorrow.id)?.priorityActions![0].completed).toBe(false);
    const file = join(root, ".operator-data/business-brief.json"), before = readFileSync(file, "utf8");
    for (const body of [{ reportId: first.id, priorityKey: "stale", completed: true }, { reportId: "missing", priorityKey: key, completed: true }, { reportId: first.id, priorityKey: key, completed: "yes" }]) {
      expect(() => reopened.setAction(body)).toThrow(); expect(readFileSync(file, "utf8")).toBe(before);
    }
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("legacy reports gain actionable stable IDs without inheriting unrelated future tasks", () => {
    const { write, service } = workspace();
    write(".operator-data/business-brief.json", { schedule: service.read().schedule, briefs: [{ ...document(), id: "legacy", createdAt: "2026-09-15T05:00:00Z", updatedAt: "2026-09-15T05:00:00Z" }] });
    const key = service.read().latest!.priorityActions![0].id;
    expect(service.get("legacy")?.priorityActions![0].id).toBe(key);
    service.setAction({ reportId: "legacy", priorityKey: key, completed: true });
    expect(service.save(document()).latest?.priorityActions![0].completed).toBe(true);
    expect(service.save(document("2026-09-16")).latest?.priorityActions![0].completed).toBe(false);
  });

  test("previous action context follows source gates and canonical current-period goals replace stale setup fields", () => {
    const { write, service } = workspace();
    const currentWeek = { startDate: "2026-09-14", endDate: "2026-09-20", timeZone: "Europe/Vienna" };
    write(".operator-data/workspace.json", { goals: { longTerm: "Legacy long term", quarter: "STALE-QUARTER", week: "STALE-WEEK" } });
    write(".operator-data/business.json", { profile: { longTermDirection: "Build the creator business", quarterGoal: "STALE-PROFILE-QUARTER" }, progress: { goals: [
      { id: "past", title: "Last week's target", horizon: "week", status: "active", updatedAt: "2026-09-16T07:00:00Z", period: { ...currentWeek, startDate: "2026-09-07", endDate: "2026-09-13" } },
      { id: "current", title: "Deliver the paid campaign", horizon: "week", status: "active", updatedAt: "2026-09-15T07:00:00Z", period: currentWeek },
    ] } });
    const report = service.save({ ...document(), priorities: ["Deliver the paid campaign."], prioritySources: [[{ label: "Current goal", ref: "progress:current" }]] }).latest!;
    service.setAction({ reportId: report.id, priorityKey: report.priorityActions![0].id, completed: true });
    const packet = service.collect({ timezone: "Europe/Vienna", asOf: new Date("2026-09-16T10:00:00Z") });
    expect(packet.sources.business.progress.goals.map((goal: any) => goal.id)).toEqual(["current", "past"]);
    expect(packet.sources.business.progress.goals[0].periodState).toBe("current");
    expect(packet.sources.business.progress.goals[1].periodState).toBe("past");
    expect(packet.sources.business.goals.longTerm).toBe("Build the creator business");
    expect(JSON.stringify(packet)).not.toContain("STALE-");
    expect(packet.previousActions[0].completed).toBe(true);
    write(".operator-data/workspace.json", { brainSources: { business: false } });
    const disabled = service.collect({ asOf: new Date("2026-09-16T10:00:00Z") });
    expect(disabled.previousActions).toHaveLength(0);
    expect(JSON.stringify(disabled)).not.toContain("Deliver the paid campaign");
  });

  test("recommendations are compact sourced cards and invalid saves preserve completed actions", () => {
    const { root, service } = workspace();
    const recommendations = Array.from({ length: 6 }, (_, i) => ({ id: `card-${i}`, title: `Specific observation ${i}`, summary: "A short evidence-grounded recommendation.", sourceCategory: "business", sources: document().sections[0].sources }));
    const report = service.save({ ...document(), recommendations }).latest!;
    service.setAction({ reportId: report.id, priorityKey: report.priorityActions![0].id, completed: true });
    expect(businessBrief(root).get(report.id)?.recommendations).toHaveLength(6);
    const before = readFileSync(join(root, ".operator-data/business-brief.json"), "utf8");
    for (const changed of [{ summary: "x".repeat(241) }, { sourceCategory: "invented" }, { sources: [{ label: "Bad", ref: "not a ref" }] }]) {
      expect(() => service.save({ ...document(), recommendations: [{ ...recommendations[0], ...changed }] })).toThrow();
      expect(readFileSync(join(root, ".operator-data/business-brief.json"), "utf8")).toBe(before);
    }
    expect(() => service.save({ ...document(), prioritySources: [] })).toThrow("Match priority sources");
  });

  test("collector ranks the complete local corpus before truncation and retains resolved thread evidence", () => {
    const { write, service } = workspace();
    const template = { source: "gmail", account: "own@example.test", from: "client@other.test", status: "open", category: "needs-you", receivedAt: "2026-09-16T06:00:00Z" };
    write(".operator-data/workspace.json", { inboxImports: [{ provider: "gmail", account: "own@example.test" }], inbox: [
      ...Array.from({ length: 50 }, (_, i) => ({ ...template, id: `pitch${i}`, subject: "Review Inquiry", body: "We are reaching out with a $200 offer. Please confirm your interest." })),
      { ...template, id: "older-obligation", receivedAt: "2026-08-01T06:00:00Z", subject: "Contract invoice", body: "Please send the deliverable and invoice for payment." },
      { ...template, id: "foreign", account: "other@example.test", subject: "URGENT", body: "FOREIGN-PAYMENT-SECRET" },
    ] });
    const packet = service.collect({ asOf: new Date("2026-09-16T10:00:00Z") });
    expect(packet.sources.inbox.scannedMessages).toBe(51);
    expect(packet.sources.inbox.messages[0].ref).toBe("inbox:older-obligation");
    expect(packet.sources.inbox.messages[0].thread.daysSinceLatest).toBeGreaterThan(30);
    expect(packet.sources.inbox.messages).toHaveLength(20);
    expect(JSON.stringify(packet)).not.toContain("FOREIGN-PAYMENT-SECRET");
    write(".operator-data/workspace.json", { brainSources: { email: false }, inbox: [{ ...template, id: "private", body: "DISABLED-INBOX" }] });
    expect(JSON.stringify(service.collect())).not.toContain("DISABLED-INBOX");
  });
  test("brief collection honors newer source preferences without rewriting the memory archive", () => {
    const { root, write, service } = workspace();
    write(".operator-data/workspace.json", {
      brainSources: { codex: true, business: true }, brainRevision: 2,
      sources: [{ id: "codex", origin: "codex", status: "ready", text: "EXCLUDED-CODEX-CONTENT" }],
    });
    write(".operator-data/business.json", { profile: { businessName: "EXCLUDED-BUSINESS-CONTENT" }, snapshots: [] });
    const file = join(root, ".operator-data/workspace.json"), previous = readFileSync(file, "utf8");
    writeBrainPreferences(root, { brainSources: { codex: false, business: false }, brainRevision: 3 });
    const packet = service.collect();
    expect(JSON.stringify(packet)).not.toContain("EXCLUDED-");
    expect(packet.coverage.find(row => row.source === "business")?.status).toBe("disabled");
    expect(readFileSync(file, "utf8")).toBe(previous);
    writeFileSync(join(root, ".operator-data/brain-preferences.json"), "corrupt");
    expect(() => service.collect()).toThrow("source preferences");
  });

  test("starts unscheduled; persists only a confirmed automation and private archive", () => {
    const { root, service } = workspace();
    expect(service.read().latest).toBeNull();
    expect(service.read().schedule.enabled).toBe(false);
    expect(service.read().schedule.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    expect(() => service.configureSchedule({ enabled: true, timezone: "Europe/Vienna" })).toThrow("Create the scheduled automation");
    const withoutZone = service.save({ ...document(), timezone: undefined });
    expect(withoutZone.latest?.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    service.save(document());
    const enabled = service.configureSchedule({ enabled: true, hour: 7, minute: 0, timezone: "Europe/Vienna", automationId: "real-automation-id" });
    expect(enabled.schedule.automationId).toBe("real-automation-id");
    expect(businessBrief(root).read().schedule.timezone).toBe("Europe/Vienna");
    expect(enabled.latest?.headline).toBe("Your morning brief");
    expect(statSync(join(root, ".operator-data", "business-brief.json")).mode & 0o777).toBe(0o600);
    expect(() => service.configureSchedule({ enabled: true, hour: 8 })).toThrow("07:00");
    expect(() => service.configureSchedule({ enabled: true, timezone: "Mars/Olympus" })).toThrow("time zone");
    expect(service.configureSchedule({ enabled: false }).schedule.enabled).toBe(false);
  });

  test("refreshes a day while preserving earlier days; rejects malformed or oversized documents atomically", () => {
    const { root, service } = workspace();
    const first = service.save(document()).latest!;
    service.save(document("2026-09-16"));
    service.save({ ...document("2026-09-16"), headline: "Refreshed today" });
    expect(service.read().archive).toHaveLength(2);
    expect(service.get(first.id)?.headline).toBe("Your morning brief");
    expect(service.read().latest?.headline).toBe("Refreshed today");
    const file = join(root, ".operator-data", "business-brief.json"), before = readFileSync(file, "utf8");
    expect(() => service.save({ ...document(), date: "2026-02-30" })).toThrow("real calendar date");
    expect(() => service.save({ ...document(), summary: "x".repeat(3001) })).toThrow("summary");
    expect(() => service.save({ ...document(), sections: Array(9).fill(document().sections[0]) })).toThrow("eight brief sections");
    expect(() => service.save({ ...document(), priorities: Array(9).fill("priority") })).toThrow("priorities");
    expect(() => service.save({ ...document(), sections: [{ ...document().sections[0], sources: [] }] })).toThrow("source references");
    expect(() => service.save({ ...document(), sections: [{ ...document().sections[0], sources: [{ label: "bad", ref: "https://user:password@example.test" }] }] })).toThrow("without credentials");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("persists sourced highlights and rejects malformed highlights without changing the report or archive", () => {
    const { root, service } = workspace();
    const yesterday = service.save(document()).latest!;
    const highlights = [
      { id: "youtube", label: "YouTube", value: "273K", caption: "Subscribers", ref: "business:youtube-observation", recordedAt: "2026-09-16T07:00:00+02:00" },
      { id: "instagram", label: "Instagram", value: "3.5K", caption: "Followers", ref: "business:instagram-observation" },
      { id: "views", label: "Channel views", value: "10.2M", caption: "Lifetime · YouTube", ref: "business:youtube-observation", recordedAt: "2026-09-16T05:00:00Z" },
    ];
    const saved = service.save({ ...document("2026-09-16"), highlights }).latest!;
    const reopened = businessBrief(root);
    expect(reopened.read().latest?.highlights).toEqual(highlights.map(fact => ({ ...fact, ...(fact.recordedAt ? { recordedAt: "2026-09-16T05:00:00.000Z" } : {}) })));
    expect(reopened.get(saved.id)?.highlights).toHaveLength(3);
    expect(reopened.get(yesterday.id)?.highlights).toBeUndefined();
    expect(reopened.read().archive).toHaveLength(2);
    const file = join(root, ".operator-data", "business-brief.json"), before = readFileSync(file, "utf8");
    const invalid = [
      { highlights: { ...highlights[0] } },
      { highlights: [...highlights, highlights[0]] },
      { highlights: [highlights[0], { ...highlights[1], ref: "not a source reference" }] },
      { highlights: [{ ...highlights[0], ref: "https://user:password@example.test/private" }] },
      { highlights: [{ ...highlights[0], recordedAt: "not-a-date" }] },
      { highlights: [{ ...highlights[0], value: 250000 }] },
      { highlights: [{ ...highlights[0], caption: "x".repeat(161) }] },
    ];
    for (const fields of invalid) {
      expect(() => reopened.save({ ...document("2026-09-16"), headline: "Must not replace the saved report", ...fields })).toThrow();
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(reopened.read().latest?.id).toBe(saved.id);
    }
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("honors source gates, deleted memories and account scopes, with bounded credential-redacted excerpts", () => {
    const { write, service } = workspace();
    write(".operator-data/workspace.json", {
      brainSources: { claude: false, meetings: false, business: false, personal: false },
      inboxImports: [{ provider: "gmail", account: "own@example.test", importedAt: "2026-09-16T06:00:00Z", count: 35 }],
      inbox: [...Array.from({ length: 25 }, (_, i) => ({ id: `mail${i}`, account: "own@example.test", source: "gmail", receivedAt: "2026-09-16T06:00:00Z", status: "open", category: "needs-you", from: "Sender", subject: `Message ${i}`, body: "API_KEY=secret-fixture-value\n" + "x".repeat(2000) })),
        { id: "foreign", account: "other@example.test", source: "gmail", receivedAt: "2026-09-16T06:00:00Z", status: "open", body: "OTHER-ACCOUNT-SECRET" }],
      sources: [{ id: "claude", origin: "claude", status: "ready", text: "DISABLED-MEMORY", updatedAt: "2026-09-15T06:00:00Z" }, { id: "gone", origin: "manual", status: "ready", deletedAt: "2026-09-16T01:00:00Z", text: "DELETED-MEMORY" }, { id: "note", origin: "codex", status: "ready", text: "Enabled note", updatedAt: "2026-09-15T06:00:00Z" }],
      events: [{ id: "private", title: "DISABLED-MEETING", start: "2026-09-16T12:00:00Z", end: "2026-09-16T13:00:00Z" }],
    });
    write(".operator-data/business.json", { profile: { businessName: "DISABLED-BUSINESS", personalPriorities: "DISABLED-PERSONAL" }, snapshots: [] });
    write("src/data/live-data.json", { dream: { prescriptions: [{ headline: "DISABLED-DREAM" }] } });
    const packet = service.collect({ asOf: new Date("2026-09-16T10:00:00Z") });
    expect(packet.sources.inbox.messages).toHaveLength(20);
    expect(packet.sources.inbox.messages[0].textTruncated).toBe(true);
    expect(packet.sources.memory.recent).toHaveLength(1);
    expect(packet.sources.memory.recent[0].ref).toBe("memory:note");
    for (const secret of ["DISABLED-", "DELETED-MEMORY", "OTHER-ACCOUNT-SECRET", "secret-fixture-value"]) expect(JSON.stringify(packet)).not.toContain(secret);
    expect(packet.coverage.find(row => row.source === "calendar")?.status).toBe("disabled");
    expect(packet.coverage.find(row => row.source === "business")?.status).toBe("disabled");
    expect(packet.sources.dream).toBeUndefined();
  });

  test("compares distinct observation days, preserves unknown currency, and covers actual meetings and Dream", () => {
    const { write, service } = workspace();
    write(".operator-data/workspace.json", { goals: { quarter: "Grow sustainable revenue" }, sources: [{ id: "meeting", kind: "meeting", status: "ready", title: "Sales call", text: "Follow up with the proposal.", updatedAt: "2026-09-15T10:00:00Z" }], events: [{ id: "today", title: "Planning", start: "2026-09-16T12:00:00Z", end: "2026-09-16T13:00:00Z", actions: [{ text: "Prepare notes", done: false }] }] });
    write(".operator-data/business.json", { snapshots: [
      { id: "a", platform: "youtube", sourceLabel: "Own YouTube API", measurementScope: "youtube-channel-totals-v1", sourceUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", recordedAt: "2026-09-15T05:00:00Z", metrics: { followers: 100 } },
      { id: "b", platform: "youtube", sourceLabel: "Own YouTube API", measurementScope: "youtube-channel-totals-v1", sourceUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", recordedAt: "2026-09-16T05:00:00Z", metrics: { followers: 105 } },
      { id: "c", platform: "youtube", sourceLabel: "Own YouTube API", measurementScope: "youtube-channel-totals-v1", sourceUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", recordedAt: "2026-09-16T06:00:00Z", metrics: { followers: 110 } },
      { id: "d", platform: "youtube", sourceLabel: "Own YouTube API", measurementScope: "youtube-channel-totals-v1", sourceUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", recordedAt: "2026-09-16T07:00:00Z", metrics: { views: 1000 } },
      { id: "e", platform: "linkedin", recordedAt: "2026-09-15T05:00:00Z", metrics: { followers: 200 } },
      { id: "f", platform: "linkedin", recordedAt: "2026-09-16T05:00:00Z", metrics: { followers: 0 } },
    ], finances: { accounts: [{ name: "Unlabelled cash", balance: 1234, currency: null }], recordedAt: "2026-09-16T05:00:00Z" } });
    write("src/data/live-data.json", { generatedAt: "2026-09-16T05:00:00Z", subscriptions: { claude: { monthlyPrice: 200, plan: "Detected" } }, daily: [{ day: "2026-09-16", cost: 12, messages: 20 }], dream: { generatedAt: "2026-09-16T05:00:00Z", prescriptions: [{ id: "dream1", headline: "Review slow work", prescription: "Inspect the bottleneck", evidence: "Saved session observations", status: "pending", command: "DANGEROUS COMMAND MUST NOT ENTER PACKET", dollarImpact: 500 }] } });
    const packet = service.collect({ timezone: "Europe/Vienna", asOf: new Date("2026-09-16T10:00:00Z") });
    const youtube = packet.sources.business.audience.find((row: any) => row.platform === "youtube");
    expect(youtube.metrics.followers.value).toBe(110);
    expect(youtube.metrics.followers.change).toBe(10);
    expect(youtube.metrics.views.value).toBe(1000);
    expect(packet.sources.business.audience.find((row: any) => row.platform === "linkedin").metrics.followers.value).toBe(0);
    expect(packet.sources.business.audience.find((row: any) => row.platform === "linkedin").metrics.followers.change).toBeUndefined();
    expect(packet.sources.business.finances.accounts[0].currency).toBeNull();
    expect(packet.sources.calendar.events).toHaveLength(1);
    expect(packet.sources.meetings.notes[0].ref).toBe("memory:meeting");
    expect(packet.sources.dream.findings[0].dollarImpactEstimate).toBe(500);
    expect(JSON.stringify(packet)).not.toContain("DANGEROUS COMMAND");
    expect(packet.sources.aiUsage.daily[0].estimatedApiEquivalentUsd).toBe(12);
    expect(packet.sources.aiUsage.subscriptions[0].currency).toBeNull();
  });

  test("excludes example telemetry, applies local dates and fails closed on unreadable preferences", () => {
    const { root, write, service } = workspace();
    write("src/data/live-data.json", { isExample: true, dream: { prescriptions: [{ headline: "EXAMPLE" }] }, daily: [{ day: "2026-09-17", cost: 999 }] });
    const packet = service.collect({ timezone: "Europe/Vienna", asOf: new Date("2026-09-16T23:30:00Z") });
    expect(packet.date).toBe("2026-09-17");
    expect(packet.sources.aiUsage).toBeUndefined();
    expect(packet.sources.dream).toBeUndefined();
    expect(packet.coverage.some(row => row.source === "live" && row.status === "unavailable")).toBe(true);
    expect(() => service.collect({ timezone: "invalid" })).toThrow("time zone");
    writeFileSync(join(root, ".operator-data", "workspace.json"), "broken json");
    expect(() => service.collect()).toThrow("Source preferences cannot be confirmed");
  });

  test("archive capacity rejects new days without dropping any earlier brief", () => {
    const { root, write, service } = workspace();
    const template = { ...document(), id: "first", createdAt: "2023-01-01T07:00:00Z", updatedAt: "2023-01-01T07:00:00Z" };
    const briefs = Array.from({ length: 730 }, (_, index) => ({ ...template, id: `brief-${index}`, date: new Date(Date.UTC(2023, 0, 1) + index * 86400000).toISOString().slice(0, 10) }));
    write(".operator-data/business-brief.json", { briefs, schedule: service.read().schedule });
    const file = join(root, ".operator-data", "business-brief.json"), before = readFileSync(file, "utf8");
    expect(() => service.save(document())).toThrow("archive is full");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(service.read().archive).toHaveLength(730);
    expect(service.get("brief-0")?.date).toBe("2023-01-01");
  });

  test("disabled sources cannot leak through declared, mixed or unscoped Dream findings", () => {
    const { write, service } = workspace();
    write(".operator-data/workspace.json", { brainSources: { claude: false, codex: true }, sources: [] });
    write("src/data/live-data.json", { dream: { generatedAt: "2026-09-16T05:00:00Z", prescriptions: [
      { id: "legacy", headline: "LEGACY-PRIVATE", prescription: "LEGACY-DETAILS", evidence: ["CLAUDE-PRIVATE-PATH"], status: "pending" },
      { id: "mixed", sourceIds: ["claude", "codex"], headline: "MIXED-PRIVATE", status: "pending" },
      { id: "unknown", sourceIds: ["unrecognized-system"], headline: "UNKNOWN-PRIVATE", status: "pending" },
      { id: "allowed", provenance: { sourceIds: ["codex"] }, headline: "Enabled Codex observation", evidence: ["Known enabled source"], status: "pending" },
    ] } });
    const packet = service.collect({ asOf: new Date("2026-09-16T10:00:00Z") });
    expect(packet.sources.dream.findings).toHaveLength(1);
    expect(packet.sources.dream.findings[0].ref).toBe("dream:allowed");
    expect(packet.sources.dream.findings[0].sourceIds).toEqual(["codex"]);
    expect(packet.sources.dream.withheldForSourcePreferences).toBe(3);
    for (const value of ["LEGACY-PRIVATE", "LEGACY-DETAILS", "CLAUDE-PRIVATE-PATH", "MIXED-PRIVATE", "UNKNOWN-PRIVATE"]) expect(JSON.stringify(packet)).not.toContain(value);
    expect(packet.coverage.find(row => row.source === "dream")?.gap).toContain("3 saved Dream findings are withheld");
    expect(packet.coverage.find(row => row.source === "dream")?.ref).toBe("workspace:coverage");
    expect(packet.coverageRef).toBe("workspace:coverage");
    write(".operator-data/workspace.json", { brainSources: { claude: true, codex: true }, sources: [] });
    expect(service.collect({ asOf: new Date("2026-09-16T10:00:00Z") }).sources.dream.findings).toHaveLength(4);
  });

  test("withholds every legacy Dream detail when lineage is unknown and any source is disabled", () => {
    const { write, service } = workspace();
    write(".operator-data/workspace.json", { brainSources: { claude: false }, sources: [] });
    write("src/data/live-data.json", { dream: { prescriptions: [{ id: "legacy", headline: "HIDDEN-DREAM-TITLE", prescription: "HIDDEN-DREAM-BODY", evidence: "HIDDEN-DREAM-EVIDENCE" }] } });
    const packet = service.collect();
    expect(packet.sources.dream.findings).toEqual([]);
    expect(packet.coverage.find(row => row.source === "dream")?.status).toBe("disabled");
    expect(JSON.stringify(packet)).not.toContain("HIDDEN-DREAM");
  });

  test("different or unknown measurement sources never create inferred audience growth", () => {
    const { write, service } = workspace();
    write(".operator-data/business.json", { snapshots: [
      { id: "old-instagram", platform: "instagram", sourceLabel: "Instagram monthly export", recordedAt: "2026-09-15T00:00:00Z", metrics: { followers: 3495 } },
      { id: "new-instagram", platform: "instagram", sourceLabel: "Instagram profile total", recordedAt: "2026-09-16T10:00:00Z", metrics: { followers: 3000 } },
      { id: "old-followers", platform: "youtube", recordedAt: "2026-09-15T00:00:00Z", metrics: { followers: 251000 } },
      { id: "new-followers", platform: "youtube", recordedAt: "2026-09-16T10:00:00Z", metrics: { followers: 250000 } },
    ] });
    const packet = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") });
    for (const [platform, key, total] of [["instagram", "followers", 3000], ["youtube", "followers", 250000]] as const) {
      const audience = packet.sources.business.audience.find((row: any) => row.platform === platform), metric = audience.metrics[key];
      expect(metric.value).toBe(total);
      expect(metric.change).toBeUndefined();
      expect(metric.percentChange).toBeUndefined();
      expect(metric.previous).toBeUndefined();
      expect(metric.comparisonGap).toContain("different or unknown");
      expect(audience.comparisonGap).toContain("different or unknown");
      expect(audience.comparedWith).toBeUndefined();
    }
  });

  test("same label never makes unknown scopes or different channel identities comparable", () => {
    const channel = "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", other = "https://www.youtube.com/channel/UC1234567890123456789012";
    for (const [oldScope, newScope, oldUrl, newUrl] of [[undefined, undefined, channel, channel], [undefined, "youtube-channel-totals-v1", channel, channel], ["youtube-period-totals", "youtube-channel-totals-v1", channel, channel], ["youtube-channel-totals-v1", "youtube-channel-totals-v1", other, channel], ["youtube-channel-totals-v1", "youtube-channel-totals-v1", undefined, undefined]]) {
      const { write, service } = workspace();
      write(".operator-data/business.json", { snapshots: [
        { id: "old", platform: "youtube", sourceLabel: "Same YouTube label", recordedAt: "2026-09-15T05:00:00Z", measurementScope: oldScope, sourceUrl: oldUrl, metrics: { views: 67096 } },
        { id: "new", platform: "youtube", sourceLabel: "Same YouTube label", recordedAt: "2026-09-16T05:00:00Z", measurementScope: newScope, sourceUrl: newUrl, metrics: { views: 15358602 } },
      ] });
      const audience = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") }).sources.business.audience[0];
      expect(audience.metrics.views.value).toBe(15358602);
      for (const field of ["previous", "previousRecordedAt", "change", "percentChange"]) expect(audience.metrics.views[field]).toBeUndefined();
      expect(audience.comparedWith).toBeUndefined();expect(audience.metrics.views.comparisonGap).toContain("different or unknown");
      expect(JSON.stringify(audience)).not.toContain("67096");
    }
  });

  test("matching verified scope and identity compare even after a display label changes", () => {
    const { write, service } = workspace();
    const base = { platform: "youtube", measurementScope: "youtube-channel-totals-v1", sourceUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv" };
    write(".operator-data/business.json", { snapshots: [
      { ...base, id: "a", sourceLabel: "Old label", recordedAt: "2026-09-15T05:00:00Z", metrics: { views: 1000, followers: 100 } },
      { ...base, id: "b", sourceLabel: "New label", recordedAt: "2026-09-16T05:00:00Z", metrics: { followers: 110 } },
      { ...base, id: "c", measurementScope: undefined, sourceLabel: "New label", recordedAt: "2026-09-16T06:00:00Z", metrics: { views: 99 } },
    ] });
    const row = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") }).sources.business.audience[0];
    expect(row.metrics.followers.change).toBe(10);expect(row.metrics.followers.sourceIdentity).toBe("youtube:UCabcdefghijklmnopqrstuv");
    expect(row.metrics.views.value).toBe(99);expect(row.metrics.views.change).toBeUndefined();expect(row.metrics.views.previous).toBeUndefined();
  });

  test("generated audience memory cannot reintroduce an unscoped numeric baseline", () => {
    const { write, service } = workspace();
    write(".operator-data/workspace.json", { sources: [
      { id: "generated", kind: "note", origin: "business", title: "YouTube audience history", status: "ready", text: "UNVERIFIED-OLDER-67096 views then 15358602 views", updatedAt: "2026-09-16T06:00:00Z", connector: {provider:"business-dashboard",itemId:"audience-youtube"} },
      { id: "manual", kind: "note", origin: "business", title: "Business planning", status: "ready", text: "Keep the planning notes available.", updatedAt: "2026-09-16T05:00:00Z" },
    ] });
    const packet = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") });
    expect(JSON.stringify(packet)).not.toContain("UNVERIFIED-OLDER-67096");
    expect(packet.sources.memory.recent.some((row:any)=>row.ref==="memory:manual")).toBe(true);
  });

  test("includes bounded quarter, month and week Progress goals with their actual status and dated update trail", () => {
    const { write, service } = workspace();
    write(".operator-data/business.json", { progress: {
      goals: [
        { id: "quarter-goal", title: "Quarter outcome", horizon: "quarter", status: "active", notes: "Measured quarterly target", updatedAt: "2026-09-14T09:00:00Z" },
        { id: "month-goal", title: "Monthly work", horizon: "month", status: "planned", notes: "Not started yet", updatedAt: "2026-09-15T09:00:00Z" },
        { id: "week-goal", title: "Weekly delivery", horizon: "week", status: "done", notes: "Delivered", updatedAt: "2026-09-16T09:00:00Z" },
        { id: "future-goal", title: "FUTURE-GOAL", horizon: "quarter", status: "active", updatedAt: "2026-09-17T09:00:00Z" },
        { id: "invalid-goal", title: "INVALID-GOAL", horizon: "week", status: "active", updatedAt: "not-a-date" },
      ],
      updates: [
        { id: "old-update", text: "First check-in", createdAt: "2026-09-15T10:00:00Z", goalId: "quarter-goal" },
        { id: "new-update", text: "Delivery complete", createdAt: "2026-09-16T10:00:00Z", goalId: "week-goal" },
        { id: "future-update", text: "FUTURE-UPDATE", createdAt: "2026-09-17T10:00:00Z" },
        { id: "invalid-update", text: "INVALID-UPDATE", createdAt: "not-a-date" },
      ],
    } });
    const packet = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") }), progress = packet.sources.business.progress;
    expect(progress.goals.map((goal: any) => [goal.horizon, goal.status])).toEqual([["quarter", "active"], ["month", "planned"], ["week", "done"]]);
    expect(progress.goals[0]).toMatchObject({ id: "quarter-goal", ref: "progress:quarter-goal", title: "Quarter outcome", notes: "Measured quarterly target", updatedAt: "2026-09-14T09:00:00Z", recordedAt: "2026-09-14T09:00:00.000Z" });
    expect(progress.updates.map((update: any) => update.id)).toEqual(["new-update", "old-update"]);
    expect(progress.updates[0]).toMatchObject({ ref: "progress-update:new-update", goalId: "week-goal", createdAt: "2026-09-16T10:00:00Z", currentGoal: { id: "week-goal", horizon: "week", status: "done", ref: "progress:week-goal" } });
    expect(packet.coverage.find(row => row.source === "progress")?.count).toBe(5);
    for (const forbidden of ["FUTURE-GOAL", "INVALID-GOAL", "FUTURE-UPDATE", "INVALID-UPDATE"]) expect(JSON.stringify(packet)).not.toContain(forbidden);
    write(".operator-data/workspace.json", { brainSources: { business: false } });
    const hidden = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") });
    expect(hidden.sources.business).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain("Quarter outcome");
    expect(JSON.stringify(hidden)).not.toContain("Delivery complete");
    expect(hidden.coverage.find(row => row.source === "progress")?.status).toBe("disabled");
  });

  test("Progress limits keep all three horizons represented and latest updates first", () => {
    const { write, service } = workspace();
    write(".operator-data/business.json", { progress: {
      goals: ["quarter", "month", "week"].flatMap(horizon => Array.from({ length: 8 }, (_, i) => ({ id: `${horizon}-${i}`, title: `${horizon} goal ${i}`, horizon, status: "active", notes: "n".repeat(2000), updatedAt: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00Z` }))),
      updates: Array.from({ length: 25 }, (_, i) => ({ id: `update-${i}`, text: `Update ${i}`, createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() })),
    } });
    const packet = service.collect({ asOf: new Date("2026-09-16T12:00:00Z") }), progress = packet.sources.business.progress;
    expect(progress.goals).toHaveLength(18);
    expect(progress.updates).toHaveLength(20);
    expect(progress.updates[0].id).toBe("update-24");
    for (const horizon of ["quarter", "month", "week"]) expect(progress.goals.filter((goal: any) => goal.horizon === horizon)).toHaveLength(6);
    expect(progress.goals[0].notesTruncated).toBe(true);
    expect(packet.coverage.find(row => row.source === "progress")?.gap).toContain("older progress history is omitted");
  });

  test("the chosen generator persists as a private catalog key and unknown assistants are refused", () => {
    const { root } = workspace();
    const catalog = { models: [
      { key: "claude|openai · via codex|gpt-5.6-sol", backend: "claude", provider: "openai · via codex", name: "gpt-5.6-sol", label: "Codex · GPT-5.6-Sol" },
      { key: "claude|claude-code|claude-sonnet-5", backend: "claude", provider: "claude-code", name: "claude-sonnet-5", label: "Claude Code · claude-sonnet-5" },
      { key: "hermes|openrouter|openai/gpt-5.6", backend: "hermes", provider: "openrouter", name: "openai/gpt-5.6", label: "Hermes · openai/gpt-5.6" },
    ], statuses: [] };
    const settings = briefModelSettings(root);
    expect(settings.read()).toEqual({ model: null });
    const chosen = settings.choose("claude|claude-code|claude-sonnet-5", catalog);
    expect(chosen).toMatchObject({ key: "claude|claude-code|claude-sonnet-5", backend: "claude", provider: "claude-code", name: "claude-sonnet-5", label: "Claude Code · claude-sonnet-5" });
    expect(Date.parse(chosen.chosenAt)).toBeGreaterThan(0);
    const file = join(root, ".operator-data", "business-brief-settings.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved).toEqual({ version: 1, model: chosen });
    expect(JSON.stringify(saved)).not.toMatch(/token|secret|password/i);
    expect(briefModelSettings(root).read().model?.key).toBe("claude|claude-code|claude-sonnet-5");
    expect(briefGeneratorFor(chosen)).toBe("claude");
    expect(briefGeneratorFor(catalog.models[0])).toBe("codex");
    expect(briefGeneratorFor(catalog.models[2])).toBe("hermes");
    expect(() => settings.choose("claude|claude-code|not-offered", catalog)).toThrow("not available");
    expect(() => settings.choose("nope", catalog)).toThrow("Choose an assistant");
    expect(() => settings.choose(42, catalog)).toThrow("Choose an assistant");
    expect(() => checkedBriefModelKey("a".repeat(241))).toThrow("Choose an assistant");
    // A refused choice never disturbs the saved one; a later valid choice replaces it.
    expect(settings.read().model?.key).toBe("claude|claude-code|claude-sonnet-5");
    expect(settings.choose("hermes|openrouter|openai/gpt-5.6", catalog).label).toBe("Hermes · openai/gpt-5.6");
    expect(findBriefModel(catalog, "hermes|openrouter|openai/gpt-5.6")?.name).toBe("openai/gpt-5.6");
    expect(findBriefModel(catalog, "claude|claude-code|gone")).toBeUndefined();
    expect(settings.clear()).toEqual({ model: null });
    // A damaged settings file reads as "no choice" so the default lane still writes the brief.
    writeFileSync(file, "{ not json");
    expect(briefModelSettings(root).read()).toEqual({ model: null });
  });
});
