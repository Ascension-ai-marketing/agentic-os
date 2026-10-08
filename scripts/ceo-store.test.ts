import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ceoKey, ceoStore } from "./ceo-store";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ceo-store-"));
  roots.push(root);
  return { root, store: ceoStore(root), directory: join(root, ".operator-data", "ceo") };
}
const work = (key: string, extra: object = {}) => ({ key, agent: "hermes" as const, title: "Sample research", task: "Summarise the sample report.", ...extra });

test("the same words make the same key, whatever their case, spacing or punctuation", () => {
  expect(ceoKey("conv-1", "hermes", "Find  the March invoice.")).toBe(ceoKey("conv-1", "hermes", "find the march invoice"));
  expect(ceoKey("conv-1", "hermes", "Find the March invoice")).not.toBe(ceoKey("conv-2", "hermes", "Find the March invoice"));
  expect(ceoKey("conv-1", "hermes", "Find the March invoice")).not.toBe(ceoKey("conv-1", "codex", "Find the March invoice"));
  expect(ceoKey("anything")).toMatch(/^[0-9a-f]{32}$/);
});

test("the same request is recorded once, in private files that leave nothing behind", () => {
  const { store, directory } = fixture();
  expect(store.tasks()).toEqual([]);
  const first = store.addTask(work("key-1", { ref: "card-1", conversationId: "conv-1" }));
  const again = store.addTask(work("key-1", { title: "Asked again" }));
  expect(first.existing).toBe(false);
  expect(again.existing).toBe(true);
  expect(again.task).toEqual(first.task);
  expect(store.tasks()).toHaveLength(1);
  expect(first.task).toMatchObject({ key: "key-1", agent: "hermes", ref: "card-1", status: "queued", conversationId: "conv-1" });
  expect(statSync(join(directory, "tasks.json")).mode & 0o777).toBe(0o600);
  expect(statSync(directory).mode & 0o777).toBe(0o700);
  expect(readdirSync(directory)).toEqual(["tasks.json"]);
});

test("a task takes a new status and what the agent said; an unknown one changes nothing", () => {
  const { store } = fixture();
  const { task } = store.addTask(work("key-1"));
  expect(store.updateTask(task.id, { status: "done", note: "  The report is three pages.  " })).toMatchObject({ status: "done", note: "The report is three pages." });
  expect(store.updateTask(task.id, { note: "" })).toMatchObject({ status: "done", note: "" });
  expect(store.updateTask("no-such-task", { status: "failed" })).toBeUndefined();
  expect(store.tasks()).toHaveLength(1);
});

test("open work is never dropped to make room; the oldest finished work is", () => {
  const { store } = fixture();
  for (let i = 0; i < 3; i++) store.addTask(work(`done-${i}`, { status: "done" }));
  for (let i = 0; i < 100; i++) store.addTask(work(`open-${i}`));
  const kept = store.tasks();
  expect(kept).toHaveLength(100);
  expect(kept.every((task) => task.status === "queued")).toBe(true);
  store.addTask(work("open-100"));
  expect(store.tasks()).toHaveLength(101);
});

test("an action still waiting is asked again as the same record; once decided, the first decision stands", () => {
  const { store } = fixture();
  const filed = store.propose({ action: "Email Dana Lee the March invoice", conversationId: "conv-1" });
  const again = store.propose({ action: "email dana lee the march invoice.", detail: "Hello Dana, the invoice is attached." });
  expect(again.id).toBe(filed.id);
  expect(again.detail).toBe("Hello Dana, the invoice is attached.");
  expect(store.approvals()).toHaveLength(1);
  expect(filed).toMatchObject({ status: "pending", conversationId: "conv-1" });
  expect(filed.by).toBeUndefined();

  expect(store.resolve(filed.id, "approved", "button")).toMatchObject({ status: "approved", by: "button" });
  expect(store.resolve(filed.id, "declined", "voice")).toMatchObject({ status: "approved", by: "button" });
  expect(() => store.resolve("no-such-approval", "approved", "voice")).toThrow("no longer on record");
  expect(() => store.propose({ action: "   " })).toThrow("Say what the action is");
  // Decided, the same action is a new question.
  expect(store.propose({ action: "Email Dana Lee the March invoice" }).id).not.toBe(filed.id);
});

test("records that cannot be read are left exactly as they are", () => {
  const { store, directory } = fixture();
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "tasks.json");
  writeFileSync(file, "{ not json");
  expect(() => store.tasks()).toThrow("could not be read");
  expect(() => store.addTask(work("key-1"))).toThrow("could not be read");
  expect(() => store.digest()).toThrow("could not be read");
  expect(readFileSync(file, "utf8")).toBe("{ not json");
  expect(readdirSync(directory)).toEqual(["tasks.json"]);
  writeFileSync(join(directory, "approvals.json"), JSON.stringify({ version: 2, items: [] }));
  expect(() => store.approvals()).toThrow("unsupported format");
});

test("a lock left behind by a program that stopped does not block the next change", () => {
  const { store, directory } = fixture();
  mkdirSync(join(directory, ".lock"), { recursive: true });
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(directory, ".lock"), old, old);
  expect(store.addTask(work("key-1")).existing).toBe(false);
  expect(readdirSync(directory)).toEqual(["tasks.json"]);
});

test("the digest names what is waiting for a yes and what is handed out, without results", () => {
  const { store } = fixture();
  expect(store.digest()).toBe("Nothing is waiting for the person's approval.\nNo work is handed out.");
  store.propose({ action: "Email Dana Lee the March invoice" });
  const { task } = store.addTask(work("key-1", { title: "Competitor pricing" }));
  store.updateTask(task.id, { status: "done", note: "Private result that stays out of the digest." });
  store.addTask(work("key-2", { agent: "claude_code", title: "Fix the sample script" }));
  const digest = store.digest();
  expect(digest).toContain(`Waiting for the person's yes (1): "Email Dana Lee the March invoice" (asked just now).`);
  expect(digest).toContain(`Hermes "Competitor pricing", done (just now); Claude Code "Fix the sample script", queued (just now).`);
  expect(digest).not.toContain("Private result");
  // Work finished more than a day ago is no longer mentioned.
  expect(store.digest(Date.now() + 25 * 3600_000)).not.toContain("Competitor pricing");
  expect(store.digest(Date.now() + 25 * 3600_000)).toContain("Fix the sample script");
});

test("a check-in's run is kept once, the oldest make way, and the voice is told only that it exists", () => {
  const { store } = fixture();
  const now = Date.parse("2026-10-03T12:00:00.000Z");
  const first = store.addReport({ key: "job/1.md", kind: "plan", title: "Morning plan", text: "Finish the sample proposal.", at: "2026-10-03T08:00:00.000Z" });
  expect(store.addReport({ key: "job/1.md", kind: "plan", title: "Morning plan", text: "Written again.", at: "2026-10-03T09:00:00.000Z" })).toEqual(first);
  expect(store.digest(now)).toContain(`Scheduled check-ins wrote: "Morning plan" (4 h ago).`);
  expect(store.digest(now)).not.toContain("sample proposal");
  for (let i = 0; i < 45; i++) store.addReport({ key: `job/old-${i}.md`, kind: "review", title: "Work review", text: `Note ${i}`, at: new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 3600_000).toISOString() });
  expect(store.reports()).toHaveLength(40);
  expect(store.reports().at(-1)).toEqual(first);
  expect(store.reports().some((item) => item.text === "Note 0")).toBe(false);
});
