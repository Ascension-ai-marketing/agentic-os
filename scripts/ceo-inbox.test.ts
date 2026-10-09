import { expect, test } from "bun:test";
import { ago, inboxView, type InboxApproval, type InboxTask } from "../src/lib/ceo-inbox";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const approval = (id: string, minutesAgo: number, more: Partial<InboxApproval> = {}): InboxApproval =>
  ({ id, action: `Sample action ${id}`, status: "pending", createdAt: at(minutesAgo), ...more });
const task = (id: string, minutesAgo: number, more: Partial<InboxTask> = {}): InboxTask =>
  ({ id, agent: "hermes", title: `Sample ${id}`, task: "A sample task.", status: "running", createdAt: at(minutesAgo), updatedAt: at(minutesAgo), ...more });

test("what waits for a yes is listed oldest first and counted as needing the person", () => {
  const view = inboxView({ approvals: [approval("b", 2), approval("a", 9), approval("c", 5, { status: "approved", by: "voice", resolvedAt: at(4) })], tasks: [] });
  expect(view.waiting.map((item) => item.id)).toEqual(["a", "b"]);
  expect(view.decided.map((item) => item.id)).toEqual(["c"]);
  expect(view.needsYou).toBe(2);
});

test("unfinished work comes before finished work, the newest first in each", () => {
  const view = inboxView({ tasks: [
    task("done-old", 90, { status: "done" }), task("running-old", 60), task("failed-new", 3, { status: "failed" }),
    task("blocked-new", 1, { status: "blocked" }), task("queued", 30, { status: "queued" }),
  ] });
  expect(view.tasks.map((item) => item.id)).toEqual(["blocked-new", "queued", "running-old", "failed-new", "done-old"]);
  expect(view.needsYou).toBe(1);
});

test("only work run by the OS's own agents carries a job to open", () => {
  const view = inboxView({ tasks: [
    task("claude", 1, { agent: "claude_code", ref: "job-1" }), task("codex", 2, { agent: "codex", ref: "job-2" }),
    task("card", 3, { agent: "hermes", ref: "t_1" }), task("unsent", 4, { agent: "claude_code" }),
  ] });
  expect(view.tasks.map((item) => item.job)).toEqual([{ id: "job-1", agent: "claude" }, { id: "job-2", agent: "codex" }, undefined, undefined]);
  expect(view.tasks.map((item) => item.card)).toEqual([false, false, false, false]);
});

test("OpenClaw's work is listed under its own name and carries no OS job", () => {
  const view = inboxView({ tasks: [task("claw", 2, { agent: "openclaw", ref: "openclaw-exec" })] }, [{ id: "openclaw-exec", runs: [{ agent: "claude", status: "completed" }] }]);
  expect(view.tasks).toHaveLength(1);
  expect(view.tasks[0]).toMatchObject({ id: "claw", agent: "openclaw", status: "running", card: false });
  expect(view.tasks[0].job).toBeUndefined();
});

test("a task follows its OS job at once, ahead of the saved record", () => {
  const job = (id: string, status: string, agent = "claude") => ({ id, runs: [{ agent, status }] });
  const view = inboxView(
    { tasks: [
      task("answered", 1, { agent: "claude_code", ref: "j1", status: "blocked", note: "Waiting." }),
      task("asking", 2, { agent: "codex", ref: "j2", status: "running" }),
      task("finished", 3, { agent: "claude_code", ref: "j3", status: "running" }),
      task("stopped", 4, { agent: "claude_code", ref: "j4", status: "running" }),
      task("unknown", 5, { agent: "claude_code", ref: "j5", status: "running" }),
      task("other-agent", 6, { agent: "claude_code", ref: "j6", status: "running" }),
      task("card", 7, { agent: "hermes", ref: "j1", status: "running" }),
    ] },
    [job("j1", "running"), job("j2", "needs_input", "codex"), job("j3", "completed"), job("j4", "cancelled"), job("j5", "mystery"), job("j6", "completed", "codex")],
  );
  expect(view.tasks.map((item) => [item.id, item.status, item.card])).toEqual([
    ["answered", "running", true], ["asking", "blocked", true], ["unknown", "running", true], ["other-agent", "running", false], ["card", "running", false],
    ["finished", "done", true], ["stopped", "failed", true],
  ]);
  expect(view.needsYou).toBe(1);
});

test("without the OS's jobs the saved record stands and no task card is shown", () => {
  const tasks = [task("a", 1, { agent: "claude_code", ref: "j1", status: "blocked" })];
  for (const jobs of [undefined, null, "x", [], [null, { id: 3 }, { id: "j1" }, { id: "j1", runs: "x" }, { id: "j1", runs: [null, { agent: "claude" }] }]]) {
    const view = inboxView({ tasks }, jobs);
    expect(view.tasks.map((item) => [item.status, item.card, item.job?.id])).toEqual([["blocked", false, "j1"]]);
    expect(view.needsYou).toBe(1);
  }
});

test("past decisions are kept to the latest few and long lists of work are cut", () => {
  const decided = Array.from({ length: 9 }, (_, index) => approval(`d${index}`, 100, { status: "declined", by: "button", resolvedAt: at(index) }));
  const many = Array.from({ length: 40 }, (_, index) => task(`t${index}`, index, { status: "done" }));
  const view = inboxView({ approvals: decided, tasks: many });
  expect(view.decided.map((item) => item.id)).toEqual(["d0", "d1", "d2", "d3", "d4"]);
  expect(view.tasks).toHaveLength(20);
  expect(view.tasks[0].id).toBe("t0");
});

test("a reply that is not the expected record shows nothing rather than failing", () => {
  for (const reply of [undefined, null, {}, { approvals: "x", tasks: 3 }, { approvals: [null, 4, { id: "a" }], tasks: [{ title: "no id" }] }])
    expect(inboxView(reply as never)).toEqual({ waiting: [], decided: [], tasks: [], needsYou: 0, reports: [] });
});

test("how long ago, in plain words", () => {
  expect(ago(at(0), NOW)).toBe("just now");
  expect(ago(at(1), NOW)).toBe("1 min ago");
  expect(ago(at(59), NOW)).toBe("59 min ago");
  expect(ago(at(150), NOW)).toBe("2 h ago");
  expect(ago(at(60 * 24 * 3), NOW)).toBe("3 d ago");
  expect(ago("not a date", NOW)).toBe("");
});

test("what the check-ins wrote is shown newest first, and anything malformed is left out", () => {
  const report = (id: string, minutesAgo: number, more: object = {}) => ({ id, kind: "plan", title: "Morning plan", text: `Sample plan ${id}`, at: at(minutesAgo), ...more });
  const view = inboxView({ reports: [report("old", 900), report("new", 5, { kind: "review", title: "Work review" }), report("bad", 1, { kind: "other" }), report("undated", 1, { at: "soon" }), "text"] });
  expect(view.reports.map((item) => item.id)).toEqual(["new", "old"]);
  expect(inboxView({ reports: Array.from({ length: 9 }, (_, i) => report(`r${i}`, i)) }).reports).toHaveLength(6);
  expect(inboxView(null).reports).toEqual([]);
});
