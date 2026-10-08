import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermesCheckIns, runAnswer } from "./ceo-reports";
import { ceoStore } from "./ceo-store";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A made-up Hermes home and a made-up OS folder. Nothing here touches the real ones. */
function fixture(jobs: unknown = { jobs: [
  { id: "abc123", name: "jarvis-morning-plan", enabled: false, state: "paused", schedule_display: "0 8 * * *" },
  { id: "def456", name: "jarvis-work-review", enabled: true, state: "scheduled", schedule_display: "every 3h", last_run_at: "2026-10-03T09:00:00+00:00" },
  { id: "zzz999", name: "someone-elses-job", enabled: true },
  { id: "../escape", name: "jarvis-morning-plan" },
] }) {
  const root = mkdtempSync(join(tmpdir(), "ceo-reports-"));
  roots.push(root);
  const cron = join(root, "hermes", "profiles", "ceo-worker", "cron");
  mkdirSync(cron, { recursive: true });
  writeFileSync(join(cron, "jobs.json"), JSON.stringify(jobs));
  const run = (job: string, name: string, document: string, at = "2026-10-03T08:00:05.000Z") => {
    mkdirSync(join(cron, "output", job), { recursive: true });
    writeFileSync(join(cron, "output", job, name), document);
    utimesSync(join(cron, "output", job, name), new Date(at), new Date(at));
  };
  return { store: ceoStore(root), checkIns: hermesCheckIns({ home: join(root, "hermes") }), run };
}
const saved = (prompt: string, answer: string) =>
  `# Cron Job: sample\n\n**Job ID:** abc123\n**Prompt Characters:** ${[...prompt].length}\n## Prompt\n\n${prompt}\n\n**Response Characters:** ${[...answer].length}\n## Response\n\n${answer}\n`;

test("the answer is read without the prompt Hermes stores above it, even when either quotes the heading", () => {
  expect(runAnswer(saved("Write the plan.", "Call the sample client first."))).toBe("Call the sample client first.");
  expect(runAnswer(saved("A prompt that quotes\n**Response Characters:** 3\n## Response\n\nabc\n", "The real answer, with an é."))).toBe("The real answer, with an é.");
  expect(runAnswer("# Cron Job: sample\n\n## Prompt\n\nWrite it.\n\n## Response\n\nAn older layout.\n")).toBe("An older layout.");
  expect(runAnswer("# Cron Job: sample\n\nError: the model did not answer.\n")).toBe("# Cron Job: sample\n\nError: the model did not answer.");
});

test("a run that chose to say nothing is not a report", () => {
  expect(runAnswer(saved("Review.", "[SILENT]"))).toBe("");
  expect(runAnswer("# Cron Job: sample\n\nScript gate returned `wakeAgent=false` — agent skipped.\n")).toBe("");
});

test("only Jarvis's own check-ins are listed, with whether each is on", () => {
  expect(fixture().checkIns.jobs()).toEqual([
    { id: "abc123", name: "jarvis-morning-plan", enabled: false, schedule: "0 8 * * *" },
    { id: "def456", name: "jarvis-work-review", enabled: true, schedule: "every 3h", lastRun: "2026-10-03T09:00:00+00:00" },
  ]);
  expect(fixture({ jobs: "not a list" }).checkIns.jobs()).toEqual([]);
});

test("each run is recorded once, and other jobs' output is left alone", () => {
  const { store, checkIns, run } = fixture();
  run("abc123", "2026-10-03_08-00-00.md", saved("Write the plan.", "Finish the sample proposal."));
  run("def456", "2026-10-03_09-00-00.md", saved("Review.", "[SILENT]"));
  run("def456", "2026-10-03_12-00-00.md", saved("Review.", "The sample research finished."), "2026-10-03T12:00:04.000Z");
  run("zzz999", "2026-10-03_08-00-00.md", saved("Something else.", "Not for Jarvis."));
  run("abc123", "notes.txt", "Not a run.");
  run("abc123", "2026-10-03_08-30-00.md", "# Cron Job: jarvis-morning-plan\n\n**Status:** BLOCKED\n\nThe agent was NOT run.\n", "2026-10-03T08:30:00.000Z");
  expect(checkIns.importInto(store)).toBe(3);
  expect(checkIns.importInto(store)).toBe(0);
  expect(store.reports().map(({ kind, title, text, at }) => ({ kind, title, text, at }))).toEqual([
    { kind: "plan", title: "Morning plan", text: "Finish the sample proposal.", at: "2026-10-03T08:00:05.000Z" },
    { kind: "plan", title: "Morning plan: did not run", text: "# Cron Job: jarvis-morning-plan\n\n**Status:** BLOCKED\n\nThe agent was NOT run.", at: "2026-10-03T08:30:00.000Z" },
    { kind: "review", title: "Work review", text: "The sample research finished.", at: "2026-10-03T12:00:04.000Z" },
  ]);
});

test("with no check-ins created there is nothing to read", () => {
  const root = mkdtempSync(join(tmpdir(), "ceo-reports-"));
  roots.push(root);
  expect(hermesCheckIns({ home: join(root, "no-hermes") }).importInto(ceoStore(root))).toBe(0);
});
