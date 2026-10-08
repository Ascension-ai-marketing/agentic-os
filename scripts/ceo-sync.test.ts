import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HermesCard } from "./ceo-hermes";
import { ceoRoutes } from "./ceo-routes";
import { ceoStore, type CeoStore } from "./ceo-store";
import { ceoSync, jobState, type OsJob } from "./ceo-sync";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** The CEO's records in a temporary folder, with a made-up Hermes board and OS job list. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ceo-sync-"));
  roots.push(root);
  const store = ceoStore(root);
  const world = { cards: [] as HermesCard[], shown: {} as Record<string, HermesCard>, jobs: [] as OsJob[], boardDown: false, osDown: false, listed: 0, showed: [] as string[] };
  const board = {
    async cards() { world.listed++; if (world.boardDown) throw new Error("Hermes did not answer."); return world.cards; },
    async show(id: string) { world.showed.push(id); const card = world.shown[id]; if (!card) throw new Error("Hermes could not do that: no such task"); return card; },
  };
  const jobs = () => { if (world.osDown) throw new Error("down"); return world.jobs; };
  const hand = (agent: "hermes" | "claude_code" | "codex", ref: string) => store.addTask({ key: `${agent}-${ref}`, agent, title: `Sample ${ref}`, task: "Sample task for the fixture.", ref }).task;
  const status = (id: string) => { const task = store.tasks().find((item) => item.id === id)!; return `${task.status}${task.note ? `: ${task.note}` : ""}`; };
  return { root, store, world, board, jobs, hand, status, sync: ceoSync({ store, board, jobs }) };
}
const job = (id: string, agent: string, status: string, extra: object = {}): OsJob => ({ id, runs: [{ agent, status, ...extra }] });

test("an OS agent run is told as queued, running, blocked, done or failed", () => {
  expect(jobState(job("j", "claude", "queued"), "claude")).toEqual({ status: "queued" });
  expect(jobState(job("j", "claude", "running"), "claude")).toEqual({ status: "running" });
  expect(jobState(job("j", "claude", "needs_input"), "claude")).toEqual({ status: "blocked", note: "It is waiting for the person's permission, on screen in the OS." });
  // A long result is told by its end, where the summary is.
  const long = jobState(job("j", "codex", "completed", { text: `${"x".repeat(2000)} The script is fixed.` }), "codex");
  expect(long.status).toBe("done");
  expect(long.note).toHaveLength(1500);
  expect(long.note).toEndWith("x The script is fixed.");
  expect(jobState(job("j", "claude", "cancelled"), "claude")).toEqual({ status: "failed", note: "It was stopped before it finished." });
  expect(jobState(job("j", "claude", "failed", { error: "Claude Code is not signed in." }), "claude")).toEqual({ status: "failed", note: "Claude Code is not signed in." });
  expect(jobState(job("j", "claude", "failed"), "claude")).toEqual({ status: "failed", note: "It failed without saying why." });
  // The run of another agent, or a job the OS no longer keeps.
  expect(jobState(job("j", "codex", "running"), "claude")).toEqual({ status: "failed", note: "The OS no longer has this task." });
  expect(jobState(undefined, "codex")).toEqual({ status: "failed", note: "The OS no longer has this task." });
});

test("Hermes work follows its card, and a finished card brings what the worker said", async () => {
  const { world, hand, status, sync } = fixture();
  const task = hand("hermes", "t_1");
  world.cards = [{ id: "t_1", title: "Sample", status: "running" }];
  await sync.refresh();
  expect(status(task.id)).toBe("running");
  expect(world.showed).toEqual([]);

  world.cards = [{ id: "t_1", title: "Sample", status: "done" }];
  world.shown.t_1 = { id: "t_1", title: "Sample", status: "done", note: "Three competitors found." };
  await sync.refresh(undefined, true);
  expect(status(task.id)).toBe("done: Three competitors found.");
  // Finished work is not asked about again.
  await sync.refresh(undefined, true);
  expect(world.listed).toBe(2);
  expect(world.showed).toEqual(["t_1"]);
});

test("a blocked card keeps its reason without being read again on every refresh", async () => {
  const { world, hand, status, sync } = fixture();
  const task = hand("hermes", "t_1");
  world.cards = [{ id: "t_1", title: "Sample", status: "blocked" }];
  world.shown.t_1 = { id: "t_1", title: "Sample", status: "blocked", note: "Needs approval: email Dana Lee the invoice." };
  await sync.refresh(undefined, true);
  await sync.refresh(undefined, true);
  expect(status(task.id)).toBe("blocked: Needs approval: email Dana Lee the invoice.");
  expect(world.showed).toEqual(["t_1"]);
});

test("a card that left the list is read on its own; one that is gone is told as failed", async () => {
  const { world, hand, status, sync } = fixture();
  const archived = hand("hermes", "t_old"), gone = hand("hermes", "t_gone"), unreadable = hand("hermes", "t_busy");
  world.cards = [{ id: "t_busy", title: "Sample", status: "done" }];
  world.shown.t_old = { id: "t_old", title: "Sample", status: "done", note: "Archived with its result." };
  await sync.refresh();
  expect(status(archived.id)).toBe("done: Archived with its result.");
  expect(status(gone.id)).toBe("failed: Its card is no longer on the Hermes board.");
  // Still on the list but its details did not come: left for the next refresh.
  expect(status(unreadable.id)).toBe("queued");
});

test("a card whose details did not come for any other reason is left as it was", async () => {
  const { store, world, jobs, hand, status } = fixture();
  const task = hand("hermes", "t_old");
  const board = { cards: async () => world.cards, show: async (): Promise<HermesCard> => { throw new Error("Hermes did not answer."); } };
  await ceoSync({ store, board, jobs }).refresh();
  expect(status(task.id)).toBe("queued");
});

test("a caller that gives up stops waiting, and the refresh still finishes for the others", async () => {
  const { store, world, jobs, hand, status } = fixture();
  const task = hand("hermes", "t_1");
  let answer = (_cards: HermesCard[]) => {};
  const board = { cards: () => new Promise<HermesCard[]>((done) => { answer = done; }), show: async (): Promise<HermesCard> => { throw new Error("unused"); } };
  const sync = ceoSync({ store, board, jobs });
  const first = new AbortController();
  const gaveUp = sync.refresh(first.signal, true), other = sync.refresh();
  first.abort();
  await gaveUp;
  expect(status(task.id)).toBe("queued");
  answer([{ id: "t_1", title: "Sample", status: "running" }]);
  await other;
  expect(status(task.id)).toBe("running");
  expect(world.listed).toBe(0);
});

test("records that cannot be read are told to a caller who could have given up, and no error is left loose", async () => {
  const { board, jobs } = fixture();
  const store = { tasks: () => { throw new Error("The CEO records could not be read. They were left untouched."); } } as unknown as CeoStore;
  const loose: unknown[] = [];
  // Only this test's own error counts; another test's loose error is not this one's failure.
  const seen = (reason: unknown) => { if (String(reason).includes("could not be read")) loose.push(reason); };
  process.on("unhandledRejection", seen);
  try {
    await expect(ceoSync({ store, board, jobs }).refresh(new AbortController().signal, true)).rejects.toThrow("could not be read");
    await new Promise((done) => setTimeout(done, 0));
    expect(loose).toEqual([]);
  } finally { process.off("unhandledRejection", seen); }
});

test("a caller that had already given up starts nothing and uses up no refresh", async () => {
  const unreadable = { tasks: () => { throw new Error("The CEO records could not be read. They were left untouched."); } } as unknown as CeoStore;
  const { store, world, board, jobs, hand } = fixture();
  hand("hermes", "t_1");
  const gaveUp = new AbortController();
  gaveUp.abort();
  const loose: unknown[] = [];
  // Only this test's own error counts; another test's loose error is not this one's failure.
  const seen = (reason: unknown) => { if (String(reason).includes("could not be read")) loose.push(reason); };
  process.on("unhandledRejection", seen);
  try {
    await ceoSync({ store: unreadable, board, jobs }).refresh(gaveUp.signal, true);
    await new Promise((done) => setTimeout(done, 0));
    expect(loose).toEqual([]);
  } finally { process.off("unhandledRejection", seen); }
  const sync = ceoSync({ store, board, jobs });
  await sync.refresh(gaveUp.signal);
  expect(world.listed).toBe(0);
  await sync.refresh();
  expect(world.listed).toBe(1);
});

test("an agent that did not answer is asked again sooner", async () => {
  const { store, world, board, jobs, hand } = fixture();
  hand("hermes", "t_1");
  world.cards = [{ id: "t_1", title: "Sample", status: "queued" }];
  world.boardDown = true;
  let clock = 0;
  const sync = ceoSync({ store, board, jobs, minGapMs: 20_000, now: () => clock });
  await sync.refresh();
  clock += 4_000;
  await sync.refresh();
  expect(world.listed).toBe(1);
  clock += 2_000;
  world.boardDown = false;
  await sync.refresh();
  expect(world.listed).toBe(2);
  clock += 6_000;
  await sync.refresh();
  expect(world.listed).toBe(2);
});

test("OS agent tasks follow their job, each by its own agent's run", async () => {
  const { world, hand, status, sync } = fixture();
  const claude = hand("claude_code", "job-1"), codex = hand("codex", "job-2"), lost = hand("claude_code", "job-3");
  world.jobs = [job("job-1", "claude", "needs_input"), job("job-2", "codex", "completed", { text: "Fixed the sample script." })];
  await sync.refresh();
  expect(status(claude.id)).toBe("blocked: It is waiting for the person's permission, on screen in the OS.");
  expect(status(codex.id)).toBe("done: Fixed the sample script.");
  expect(status(lost.id)).toBe("failed: The OS no longer has this task.");
  expect(world.listed).toBe(0);
});

test("an agent that cannot be reached leaves its tasks as they were, and the other side still updates", async () => {
  const { world, hand, status, sync } = fixture();
  const card = hand("hermes", "t_1"), run = hand("codex", "job-1");
  world.boardDown = true;
  world.jobs = [job("job-1", "codex", "running")];
  await sync.refresh();
  expect(status(card.id)).toBe("queued");
  expect(status(run.id)).toBe("running");

  world.boardDown = false;
  world.osDown = true;
  world.cards = [{ id: "t_1", title: "Sample", status: "running" }];
  await sync.refresh(undefined, true);
  expect(status(card.id)).toBe("running");
  expect(status(run.id)).toBe("running");
});

test("refreshes close together are one refresh, and nothing is asked when no work is open", async () => {
  const { world, hand, sync, store, board, jobs } = fixture();
  await sync.refresh(undefined, true);
  expect(world.listed).toBe(0);
  hand("hermes", "t_1");
  world.cards = [{ id: "t_1", title: "Sample", status: "queued" }];
  await Promise.all([sync.refresh(undefined, true), sync.refresh(undefined, true)]);
  expect(world.listed).toBe(1);
  await sync.refresh();
  expect(world.listed).toBe(1);

  let clock = 0;
  const timed = ceoSync({ store, board, jobs, minGapMs: 20_000, now: () => clock });
  await timed.refresh();
  clock += 19_000;
  await timed.refresh();
  expect(world.listed).toBe(2);
  clock += 2_000;
  await timed.refresh();
  expect(world.listed).toBe(3);
});

test("the dashboard reads the records and the button decides; the first decision stands", async () => {
  const { root, store, hand } = fixture();
  let refreshed = 0;
  const routes = ceoRoutes({ root, jobs: () => [], store, sync: { refresh: async () => { refreshed++; } }, checkIns: { importInto: () => 0 } });
  hand("hermes", "t_1");
  const filed = store.propose({ action: "Email Dana Lee the March invoice" });
  expect(await routes.handle("/ceo", "GET", undefined)).toMatchObject({ approvals: [{ id: filed.id, status: "pending" }], tasks: [{ ref: "t_1", status: "queued" }] });
  expect(refreshed).toBe(0);
  expect((await routes.handle("/ceo/tasks", "GET", undefined) as any).tasks).toHaveLength(1);
  expect(refreshed).toBe(1);

  expect(await routes.handle("/ceo/approvals/resolve", "POST", { id: filed.id, decision: "approved" })).toMatchObject({ approval: { status: "approved", by: "button" } });
  expect(await routes.handle("/ceo/approvals/resolve", "POST", { id: filed.id, decision: "declined" })).toMatchObject({ approval: { status: "approved", by: "button" } });

  const resolve = (body: unknown) => routes.handle("/ceo/approvals/resolve", "POST", body);
  await expect(resolve({ id: filed.id, decision: "approved", by: "voice" })).rejects.toThrow("Choose an approval and a decision");
  await expect(resolve({ id: filed.id, decision: "yes" })).rejects.toThrow("Choose approve or decline");
  await expect(resolve({ id: "../approvals", decision: "approved" })).rejects.toThrow("no longer on record");
  await expect(resolve({ id: "00000000-0000-4000-8000-000000000000", decision: "approved" })).rejects.toThrow("no longer on record");
  await expect(resolve([filed.id])).rejects.toThrow("Choose an approval and a decision");
  await expect(routes.handle("/ceo/approvals/resolve", "GET", undefined)).rejects.toThrow("Unknown CEO request");
  await expect(routes.handle("/ceo/tasks", "POST", {})).rejects.toThrow("Unknown CEO request");
  await expect(routes.handle("/ceo/approvals", "DELETE", {})).rejects.toThrow("Unknown CEO request");
});
