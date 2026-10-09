import { expect, test } from "bun:test";
import { NEVER_COMMANDS, NEVER_FLAGS, NOT_CLEARED, NOT_INSTALLED, openclaw, openclawPaths, workArgs, type Run } from "./ceo-openclaw";

const HOME = "/Users/sample";
const NVM = `${HOME}/.nvm/versions/node`;
/** A made-up disk: the files that exist, and the folders under nvm. */
const disk = (files: string[], versions: string[] = []) => ({
  home: HOME,
  exists: (file: string) => files.includes(file),
  list: (folder: string) => (folder === NVM ? versions : []),
});
/** An OpenClaw that is never started: a stand-in for the command that records what it was asked. */
function fixture(answer: (args: string[]) => { code?: number; stdout?: string; stderr?: string } = () => ({})) {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "", ...answer(args) };
  };
  return { claw: openclaw({ run }), calls };
}

test("OpenClaw on the PATH is found there, with the node beside it", () => {
  const found = openclawPaths({ ...disk(["/opt/tools/openclaw", "/opt/tools/node"]), path: "/opt/tools:/usr/bin" });
  expect(found).toEqual({ bin: "/opt/tools/openclaw", node: "/opt/tools/node" });
});

test("with nothing on the PATH, the newest nvm install is found", () => {
  const files = [`${NVM}/v24.9.0/bin/openclaw`, `${NVM}/v24.21.0/bin/openclaw`, `${NVM}/v24.21.0/bin/node`];
  const found = openclawPaths({ ...disk(files, ["v24.9.0", "v24.21.0", "v22.1.0", "notes"]), path: "/usr/bin:/bin" });
  expect(found).toEqual({ bin: `${NVM}/v24.21.0/bin/openclaw`, node: `${NVM}/v24.21.0/bin/node` });
});

test("an install with no node beside it is started on its own", () => {
  expect(openclawPaths({ ...disk([`${HOME}/.local/bin/openclaw`]), path: "/usr/bin" })).toEqual({ bin: `${HOME}/.local/bin/openclaw` });
});

test("a computer without OpenClaw says so and runs nothing", async () => {
  const claw = openclaw({ ...disk([]), path: "/usr/bin" });
  expect(claw.installed()).toBe(false);
  expect(claw.workerProblem()).toBe(NOT_INSTALLED);
  expect(await claw.status()).toEqual({ installed: false });
});

test("an installed OpenClaw reports its version and still takes no work", async () => {
  const { claw, calls } = fixture((args) => (args[0] === "--version" ? { stdout: "OpenClaw 2026.9.9 (bcfc888)\n" } : {}));
  const status = await claw.status();
  expect(status.installed).toBe(true);
  expect(status.version).toBe("2026.9.9");
  expect(claw.workerProblem()).toBe(NOT_CLEARED);
  expect(calls[0]).toEqual(["--version"]);
});

test("a version that cannot be read leaves the rest of the status standing", async () => {
  const { claw } = fixture(() => ({ code: 1, stdout: "something else" }));
  expect((await claw.status()).installed).toBe(true);
  expect((await claw.status()).version).toBeUndefined();
});

test("nothing it asks of OpenClaw can send, connect, change its limits or show the gateway token", async () => {
  const { claw, calls } = fixture((args) => (args[0] === "--version" ? { stdout: "OpenClaw 2026.9.9" } : { stdout: "{}" }));
  await claw.status();
  expect(calls.length).toBeGreaterThan(0);
  for (const args of calls) {
    expect(NEVER_COMMANDS).not.toContain(args[0]);
    for (const arg of args) expect(NEVER_FLAGS).not.toContain(arg.split("=")[0]);
  }
  expect(NEVER_FLAGS).toEqual(expect.arrayContaining(["--deliver", "--channel", "--reply-channel", "--reply-to", "--reply-account", "--to"]));
  expect(NEVER_COMMANDS).toEqual(expect.arrayContaining(["message", "channels", "pairing", "dashboard", "agent"]));
});

const LIMITS = { folder: "/Users/sample/agents/openclaw", minutes: 10, tasksPerDay: 5, dollarsPerDay: 3 };
const ID = "0f6b9a52-3c1d-4e8f-9a7b-1c2d3e4f5a6b";
/** A made-up OpenClaw that answers a work run with the given envelope and exit code. */
function worker(code: number, envelope: unknown, stderr = "") {
  const runs: { args: string[]; input?: string; timeoutMs?: number }[] = [], folders: string[] = [];
  const claw = openclaw({ run: async (args, options) => { runs.push({ args, input: options?.input, timeoutMs: options?.timeoutMs }); return { code, stdout: JSON.stringify(envelope), stderr }; } });
  const work = (prompt = "Sort the receipts.") => claw.work({ id: ID, prompt, limits: LIMITS, makeFolder: (folder) => folders.push(folder) });
  return { claw, runs, folders, work };
}

test("without agreed limits, OpenClaw is not cleared; within them it is", () => {
  const { claw } = worker(0, {});
  expect(claw.workerProblem()).toBe(NOT_CLEARED);
  expect(claw.workerProblem({ limits: LIMITS, tasks: [] })).toBeUndefined();
});

test("work is one headless turn in the task's own folder, with no channel and the agreed deadline", async () => {
  const { runs, folders, work } = worker(0, { ok: true, status: "ok", final: "Sorted 40 receipts into receipts.csv.", costUsd: 0.12 });
  expect(await work()).toEqual({ status: "done", note: "Sorted 40 receipts into receipts.csv.", costUsd: 0.12 });
  expect(folders).toEqual([`${LIMITS.folder}/${ID}`]);
  expect(runs).toEqual([{ args: workArgs(`${LIMITS.folder}/${ID}`, 10), input: "Sort the receipts.", timeoutMs: 11 * 60_000 }]);
  expect(runs[0].args).toEqual(["agent", "exec", "--message-file", "-", "--cwd", `${LIMITS.folder}/${ID}`, "--json", "--timeout", "600"]);
  for (const arg of runs[0].args) expect(NEVER_FLAGS).not.toContain(arg);
});

test("a run that timed out, failed or answered nonsense is told as failed, with its cost when known", async () => {
  expect(await worker(2, { ok: false, status: "timeout", costUsd: 0.4 }).work()).toEqual({ status: "failed", note: "It was stopped at the 10-minute limit before it finished.", costUsd: 0.4 });
  expect(await worker(1, { ok: false, status: "error", error: { message: "No API key for openai.", kind: "auth" } }).work()).toEqual({ status: "failed", note: "No API key for openai." });
  expect(await worker(1, "garbage", "Error: config could not be parsed\n").work()).toEqual({ status: "failed", note: "Error: config could not be parsed" });
});

test("only the fixed reads and the one work shape ever reach OpenClaw", async () => {
  const asked: string[][] = [];
  const claw = openclaw({ run: async (args) => { asked.push(args); return { code: 0, stdout: "", stderr: "" }; } });
  const bad = await claw.work({ id: "not-an-id", prompt: "x", limits: LIMITS, makeFolder: () => {} });
  expect(bad.status).toBe("failed");
  const relative = await claw.work({ id: ID, prompt: "x", limits: { ...LIMITS, folder: "agents" }, makeFolder: () => {} });
  expect(relative).toEqual({ status: "failed", note: "That is not something the OS asks of OpenClaw." });
  expect(asked).toEqual([]);
});
