import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { agentJobs } from "./agent-jobs";
import type { AgentRunInput, AgentRunHandle } from "./agent-jobs-types";

const roots: string[] = [],
  services: ReturnType<typeof agentJobs>[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(deferShutdown = false) {
  const root = mkdtempSync(join(tmpdir(), "jarvis-jobs-"));
  roots.push(root);
  const started: Array<{
    input: AgentRunInput;
    handle: AgentRunHandle;
    settle: () => void;
    responses: unknown[];
  }> = [];
  const start = (input: AgentRunInput) => {
    let settle!: () => void;
    const responses: unknown[] = [];
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const handle: AgentRunHandle = {
      done,
      cancel: () => {
        input.onEvent({ type: "error", message: "Cancelled" });
        if (!deferShutdown) settle();
      },
      respond: (id, decision, answers) => {
        responses.push({ id, decision, answers });
        input.onEvent({ type: "input_resolved", id });
      },
    };
    input.signal.addEventListener("abort", () => handle.cancel());
    started.push({ input, handle, settle, responses });
    return handle;
  };
  const config = {
    start: { codex: start, claude: start },
    status: async () => [
      {
        id: "codex" as const,
        installed: true,
        signedIn: true,
        detail: "Fixture",
        tools: [],
        checkedAt: new Date().toISOString(),
      },
    ],
  };
  const service = agentJobs(root, config);
  services.push(service);
  const create = (targets = ["codex"], prompt = "Create a local note") =>
    service.create({ requestId: randomUUID(), targets, prompt }).job;
  return { root, service, started, create, config };
}

describe("Jarvis native task coordinator", () => {
  test("both runs start together in isolated directories, with Claude review only", () => {
    const f = fixture(),
      job = f.create(["codex", "claude"]);
    expect(f.started).toHaveLength(2);
    expect(job.runs.find((r) => r.agent === "codex")?.role).toBe("execute");
    expect(job.runs.find((r) => r.agent === "claude")?.role).toBe("review");
    expect(f.started.map((s) => s.input.readOnly).sort()).toEqual([false, true]);
    expect(new Set(f.started.map((s) => s.input.cwd)).size).toBe(2);
    expect(f.started.find((s) => !s.input.readOnly)?.input.prompt).toBe("Create a local note");
    expect(f.started.find((s) => s.input.readOnly)?.input.prompt).toContain(
      "independent review, not proof",
    );
  });
  test("Claude alone can execute the user's exact request without attaching OS context", () => {
    const f = fixture(),
      job = f.create(["claude"], "Summarize a file I name");
    expect(job.runs[0].role).toBe("execute");
    expect(f.started[0].input.readOnly).toBe(false);
    expect(f.started[0].input.prompt).toBe("Summarize a file I name");
  });
  test("matching request IDs deduplicate work and conflicting reuse is rejected", () => {
    const f = fixture(),
      body = { requestId: randomUUID(), targets: ["codex"], prompt: "Hello" };
    const first = f.service.create(body);
    expect(f.service.create(body).job.id).toBe(first.job.id);
    expect(f.started).toHaveLength(1);
    expect(() => f.service.create({ ...body, prompt: "Different" })).toThrow("different work");
  });
  test("bounds concurrent work and rejects invalid targets/extra inputs", () => {
    const f = fixture();
    f.create(["codex", "claude"]);
    f.create(["codex", "claude"]);
    expect(() => f.create()).toThrow("Four agents");
    expect(() => f.create(["codex", "codex"])).toThrow("Choose");
    expect(() =>
      f.service.create({
        requestId: randomUUID(),
        targets: ["codex"],
        prompt: "Hello",
        credentials: "ignored?",
      }),
    ).toThrow("Choose");
  });
  test("OS workflow uses this checkout and the shipped skill, while both keeps Claude read-only", () => {
    const f = fixture();
    const body = {
      requestId: randomUUID(),
      targets: ["codex", "claude"],
      prompt: "Make the calendar clearer",
      workflow: "improve-os",
    };
    const job = f.service.create(body).job;
    expect(job.workflow).toBe("improve-os");
    expect(f.started.every((s) => s.input.cwd === f.root)).toBe(true);
    expect(f.started.find((s) => !s.input.readOnly)?.input.prompt).toContain(
      join(f.root, ".agents/skills/improve-agentic-os/SKILL.md"),
    );
    expect(f.started.find((s) => !s.input.readOnly)?.input.prompt).toContain(body.prompt);
    expect(f.started.find((s) => s.input.readOnly)?.input.prompt).toContain(
      "Do not execute external actions",
    );
    expect(f.service.create(body).job.id).toBe(job.id);
    expect(f.started).toHaveLength(2);
    expect(() => f.service.create({ ...body, requestId: randomUUID() })).toThrow("already running");
    expect(() => f.service.create({ ...body, workflow: "build" })).toThrow("different work");
  });
  test("build remains isolated and cannot accept caller-supplied paths or unknown workflows", () => {
    const f = fixture(),
      body = {
        requestId: randomUUID(),
        targets: ["codex"],
        prompt: "Build a new page",
        workflow: "build",
      };
    const job = f.service.create(body).job;
    expect(f.started[0].input.cwd).toBe(
      join(f.root, ".operator-data/agent-tasks", job.id, "codex"),
    );
    expect(f.started[0].input.prompt).toBe(body.prompt);
    expect(() => f.service.create({ ...body, cwd: "/tmp" })).toThrow("Choose");
    expect(() => f.service.create({ ...body, workflow: "anything" })).toThrow("Choose Build");
    expect(() => f.service.create({ ...body, workflow: "improve-os" }, true)).toThrow(
      "Choose Build",
    );
  });
  test("OS editing stays locked until the stopped process exits, while retries still deduplicate", async () => {
    const f = fixture(true);
    const body = { requestId: randomUUID(), targets: ["codex"], prompt: "Improve Jarvis", workflow: "improve-os" };
    const job = f.service.create(body).job;
    f.service.cancel({ jobId: job.id });
    expect(f.service.create(body).job.id).toBe(job.id);
    expect(() => f.service.create({ ...body, requestId: randomUUID() })).toThrow("already running");
    expect(f.started).toHaveLength(1);
    f.started[0].settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.service.create({ ...body, requestId: randomUUID() }).job.runs[0].status).toBe("running");
  });
  test("stopping processes still count towards the concurrent task limit", async () => {
    const f = fixture(true);
    for (let i = 0; i < 4; i++) f.service.cancel({ jobId: f.create().id });
    expect(() => f.create()).toThrow("Four agents");
    f.started[0].settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.create().runs[0].status).toBe("running");
  });
  test("check success requires the real expected file, not an agent's success claim", () => {
    const f = fixture(),
      job = f.service.create({ requestId: randomUUID(), targets: ["codex", "claude"] }, true).job;
    expect(job.runs.every((r) => r.role === "check")).toBe(true);
    const [first, second] = f.started;
    writeFileSync(join(first.input.cwd, "agent-check.txt"), "JARVIS_AGENT_CHECK_OK\n");
    first.input.onEvent({ type: "done" });
    second.input.onEvent({ type: "done" });
    const result = f.service.list().jobs[0];
    expect(result.runs[0].status).toBe("completed");
    expect(result.runs[1].status).toBe("failed");
    expect(result.runs[1].error).toContain("expected file");
  });
  test("questions require exact job, agent and request ID, then clear when resolved", () => {
    const f = fixture(),
      job = f.create();
    f.started[0].input.onEvent({
      type: "input",
      id: "permission-1",
      kind: "question",
      title: "Which?",
      detail: "Pick",
      questions: [{ id: "q1", question: "Name" }],
    });
    expect(f.service.list().jobs[0].runs[0].status).toBe("needs_input");
    expect(() =>
      f.service.respond({ jobId: job.id, agent: "codex", requestId: "old", decision: "approve" }),
    ).toThrow("no longer");
    f.service.respond({
      jobId: job.id,
      agent: "codex",
      requestId: "permission-1",
      decision: "approve",
      answers: { q1: "Alice" },
    });
    expect(f.started[0].responses).toEqual([
      { id: "permission-1", decision: "approve", answers: { q1: "Alice" } },
    ]);
    expect(f.service.list().jobs[0].runs[0].pending).toBeUndefined();
    expect(() =>
      f.service.respond({
        jobId: job.id,
        agent: "codex",
        requestId: "permission-1",
        decision: "approve",
      }),
    ).toThrow("no longer");
  });
  test("stopping one agent preserves the other and late completion cannot undo cancellation", () => {
    const f = fixture(),
      job = f.create(["codex", "claude"]);
    f.service.cancel({ jobId: job.id, agent: "codex" });
    const stopped = f.started.find((s) => s.input.cwd.endsWith("/codex"))!;
    stopped.input.onEvent({ type: "done" });
    const result = f.service.list().jobs[0];
    expect(stopped.input.signal.aborted).toBe(true);
    expect(result.runs.find((r) => r.agent === "codex")?.status).toBe("cancelled");
    expect(result.runs.find((r) => r.agent === "claude")?.status).toBe("running");
  });
  test("persists privately, restores history without replaying interrupted work", () => {
    const f = fixture();
    f.create();
    const file = join(f.root, ".operator-data", "agent-jobs.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const restarted = agentJobs(f.root, f.config);
    services.push(restarted);
    expect(restarted.list().jobs[0].runs[0].status).toBe("failed");
    expect(restarted.list().jobs[0].runs[0].error).toContain("restarted");
    expect(f.started).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });
  test("adapter failure and unexpected exit never become success", async () => {
    const f = fixture();
    f.create();
    f.started[0].settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.service.list().jobs[0].runs[0].status).toBe("failed");
    expect(f.service.list().jobs[0].runs[0].error).toContain("without confirming");
  });
  test("status separates native sign-in, tool discovery and a verified check", async () => {
    const f = fixture();
    const before = await f.service.status();
    expect(before.agents[0].signedIn).toBe(true);
    expect(before.agents[0].lastCheck).toBeUndefined();
    f.service.create({ requestId: randomUUID(), targets: ["codex"] }, true);
    writeFileSync(join(f.started[0].input.cwd, "agent-check.txt"), "JARVIS_AGENT_CHECK_OK\n");
    f.started[0].input.onEvent({ type: "done" });
    const after = await f.service.status();
    expect(after.agents[0].lastCheck?.status).toBe("completed");
    expect(after.agents[0].lastCheck?.detail).toContain("External actions were not tested");
  });
  test("task snapshots cannot mutate the job, and shutdown rejects new work", () => {
    const f = fixture(),
      job = f.create();
    job.prompt = "mutated";
    expect(f.service.list().jobs[0].prompt).toBe("Create a local note");
    f.service.close();
    expect(() => f.create()).toThrow("shutting down");
    expect(f.started[0].input.signal.aborted).toBe(true);
  });
  test("redacts known credentials and bounds progress/output", () => {
    const f = fixture();
    f.create();
    f.started[0].input.onEvent({ type: "text", text: "token sk-abcdefghijklmnop" });
    expect(f.service.list().jobs[0].runs[0].text).toContain("[redacted]");
    for (let i = 0; i < 70; i++)
      f.started[0].input.onEvent({ type: "progress", label: `Step ${i}` });
    f.started[0].input.onEvent({ type: "text", text: "x".repeat(50000) });
    const run = f.service.list().jobs[0].runs[0];
    expect(run.events).toHaveLength(60);
    expect(run.text.length).toBe(32000);
  });
  test("Jev's model reaches the executing agent, and a follow-up resumes the same session", async () => {
    const f = fixture();
    const job = f.service.create({ requestId: randomUUID(), targets: ["codex"], prompt: "Build a page", model: "gpt-6-astra" }).job;
    expect(f.started[0].input.model).toBe("gpt-6-astra");
    expect(() => f.service.create({ requestId: randomUUID(), targets: ["codex"], prompt: "x", model: "bad model;" })).toThrow("supported model");
    f.started[0].input.onEvent({ type: "session", id: "thread-1" });
    f.started[0].input.onEvent({ type: "text", text: "First pass done." });
    expect(() => f.service.continue({ jobId: job.id, agent: "codex", prompt: "Make it blue" })).toThrow("still working");
    f.started[0].input.onEvent({ type: "done" });
    f.started[0].settle();
    await new Promise((r) => setTimeout(r, 5));
    const next = f.service.continue({ jobId: job.id, agent: "codex", prompt: "Make it blue" }).job;
    expect(f.started).toHaveLength(2);
    expect(f.started[1].input).toMatchObject({ prompt: "Make it blue", resumeSessionId: "thread-1", model: "gpt-6-astra" });
    expect(f.started[1].input.cwd).toBe(f.started[0].input.cwd);
    expect(next.runs[0].status).toBe("running");
    f.started[1].input.onEvent({ type: "text", text: "Now blue." });
    const run = f.service.list().jobs[0].runs[0];
    expect(run.text).toContain("First pass done.");
    expect(run.text).toContain("› Make it blue");
    expect(run.text.endsWith("Now blue.")).toBe(true);
  });
  test("jobs from Chat or voice work autonomously", () => {
    const f = fixture();
    f.service.create({ requestId: randomUUID(), targets: ["claude"], prompt: "Research Galileo", autonomous: true });
    expect(f.started[0].input.autonomous).toBe(true);
    f.service.create({ requestId: randomUUID(), targets: ["codex"], prompt: "From Tasks" });
    expect(f.started[1].input.autonomous).toBeUndefined();
  });
});
