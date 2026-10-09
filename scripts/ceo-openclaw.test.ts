import { expect, test } from "bun:test";
import { NEVER_COMMANDS, NEVER_FLAGS, NOT_CLEARED, NOT_INSTALLED, openclaw, openclawPaths, pinnedConfig, pinnedFile, readGateway, readModel, workArgs, type Run } from "./ceo-openclaw";

const HOME = "/Users/sample";
/** A made-up OS folder; the settings file the OS writes for each run is kept under it. */
const ROOT = "/Users/sample/os", PINNED = pinnedFile(ROOT);
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
  return { claw: openclaw({ run, root: ROOT, save: () => {} }), calls };
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
  expect(calls).toContainEqual(["--version"]);
});

const GATEWAY = { cli: { version: "2026.9.9" }, service: { runtime: { status: "running", pid: 4242 } }, rpc: { ok: true }, gateway: { bindMode: "loopback", bindHost: "127.0.0.1", port: 18789, controlUiLinks: { httpUrl: "http://127.0.0.1:18789/" } } };

test("the gateway line says whether it answers, that it is local, and a bare local address", async () => {
  const { claw } = fixture((args) => (args[0] === "gateway" ? { stdout: `Checking the service\n${JSON.stringify(GATEWAY, null, 2)}\n` } : args[0] === "config" ? { stdout: '{ "primary": "openai/sample-model@openai:setup-1", "fallbacks": [] }' } : { stdout: "OpenClaw 2026.9.9" }));
  expect(await claw.status()).toEqual({ installed: true, version: "2026.9.9", model: "openai/sample-model@openai:setup-1", gateway: "running", localOnly: true, address: "http://127.0.0.1:18789/" });
  expect(readGateway(JSON.stringify({ ...GATEWAY, rpc: { ok: false } }))).toEqual({ gateway: "stopped" });
  expect(readGateway(JSON.stringify({ ...GATEWAY, service: { runtime: { status: "stopped" } } }))).toEqual({ gateway: "stopped" });
  expect(readGateway("the service manager did not answer")).toEqual({ gateway: "unknown" });
  expect(readGateway(JSON.stringify({ ...GATEWAY, gateway: { bindMode: "lan", controlUiLinks: { httpUrl: "http://192.168.1.20:18789/" } } }))).toEqual({ gateway: "running" });
});

test("an address that could carry the gateway token is never passed on", () => {
  for (const httpUrl of ["http://127.0.0.1:18789/?token=sample", "http://127.0.0.1:18789/#token=sample", "http://user:sample@127.0.0.1:18789/", "https://gateway.example/", "javascript:alert(1)", 7])
    expect(readGateway(JSON.stringify({ ...GATEWAY, gateway: { bindMode: "loopback", controlUiLinks: { httpUrl } } }))).toEqual({ gateway: "running", localOnly: true });
  expect(readGateway(JSON.stringify({ ...GATEWAY, gateway: { bindMode: "loopback", controlUiLinks: { httpUrl: "http://localhost:18789/chat/sample-token" } } })).address).toBe("http://localhost:18789/");
});

test("the model is read as a name, alone or first of a list, and anything else is no model", () => {
  expect(readModel('"openai/sample-model"')).toBe("openai/sample-model");
  expect(readModel('{"primary":"openrouter/meta/sample-3.1:free"}')).toBe("openrouter/meta/sample-3.1:free");
  for (const bad of ["", "not json", "{}", '"sample-model"', '"openai/sample model"', JSON.stringify(`openai/${"m".repeat(200)}`)]) expect(readModel(bad)).toBeUndefined();
});

test("a version that cannot be read leaves the rest of the status standing", async () => {
  const { claw } = fixture(() => ({ code: 1, stdout: "something else" }));
  expect((await claw.status()).installed).toBe(true);
  expect((await claw.status()).version).toBeUndefined();
});

test("nothing it asks of OpenClaw can send, connect, change its limits or show the gateway token", async () => {
  const { claw, calls } = fixture((args) => (args[0] === "--version" ? { stdout: "OpenClaw 2026.9.9" } : { stdout: "{}" }));
  await claw.status();
  expect(calls).toHaveLength(3);
  for (const args of calls) {
    // The one read of its settings is the model's name, by its exact words; nothing else under a never-command runs.
    if (NEVER_COMMANDS.includes(args[0])) expect(args).toEqual(["config", "get", "agents.defaults.model", "--json"]);
    for (const arg of args) expect(NEVER_FLAGS).not.toContain(arg.split("=")[0]);
  }
  expect(NEVER_FLAGS).toEqual(expect.arrayContaining(["--deliver", "--channel", "--reply-channel", "--reply-to", "--reply-account", "--to"]));
  expect(NEVER_COMMANDS).toEqual(expect.arrayContaining(["message", "channels", "pairing", "dashboard", "agent"]));
});

const LIMITS = { folder: "/Users/sample/agents/openclaw", model: "openai/sample-model@openai:setup-1", minutes: 10, tasksPerDay: 5, dollarsPerDay: 3 };
const ID = "0f6b9a52-3c1d-4e8f-9a7b-1c2d3e4f5a6b";
/** A made-up OpenClaw that answers a work run with the given envelope and exit code. */
function worker(code: number, envelope: unknown, stderr = "") {
  const runs: { args: string[]; input?: string; timeoutMs?: number }[] = [], folders: string[] = [], saved: { file: string; text: string }[] = [];
  const claw = openclaw({ root: ROOT, save: (file, text) => saved.push({ file, text }), run: async (args, options) => { runs.push({ args, input: options?.input, timeoutMs: options?.timeoutMs }); return { code, stdout: JSON.stringify(envelope), stderr }; } });
  const work = (prompt = "Sort the receipts.") => claw.work({ id: ID, prompt, limits: LIMITS, makeFolder: (folder) => folders.push(folder) });
  return { claw, runs, folders, saved, work };
}

test("without agreed limits, OpenClaw is not cleared; within them it is", () => {
  const { claw } = worker(0, {});
  expect(claw.workerProblem()).toBe(NOT_CLEARED);
  expect(claw.workerProblem({ limits: LIMITS, tasks: [] })).toBeUndefined();
});

test("work is one headless turn in the task's own folder, under the settings the OS wrote, with the agreed deadline", async () => {
  const { runs, folders, saved, work } = worker(0, { ok: true, status: "ok", final: "Sorted 40 receipts into receipts.csv.", costUsd: 0.12, toolSummary: { calls: 3, tools: ["read", "write", "apply_patch"] } });
  expect(await work()).toEqual({ status: "done", note: "Sorted 40 receipts into receipts.csv.", costUsd: 0.12 });
  expect(folders).toEqual([`${LIMITS.folder}/${ID}`]);
  expect(runs).toEqual([{ args: workArgs(`${LIMITS.folder}/${ID}`, 10, PINNED), input: "Sort the receipts.", timeoutMs: 11 * 60_000 }]);
  expect(runs[0].args).toEqual(["agent", "exec", "--message-file", "-", "--cwd", `${LIMITS.folder}/${ID}`, "--config", PINNED, "--json", "--timeout", "600"]);
  for (const arg of runs[0].args) expect(NEVER_FLAGS).not.toContain(arg);
  // The file is written afresh for the run, and is exactly what the OS says it is.
  expect(saved).toEqual([{ file: PINNED, text: `${JSON.stringify(pinnedConfig(LIMITS.model), null, 2)}\n` }]);
  expect(PINNED).toBe(`${ROOT}/.operator-data/ceo/openclaw-worker.json`);
});

test("the settings a hand-off runs under give file tools in its folder and nothing else", () => {
  const settings: any = pinnedConfig("openai/sample-model@openai:setup-1");
  expect(settings.tools).toEqual({
    allow: ["read", "write", "edit"],
    deny: ["group:runtime", "group:web", "group:ui", "group:messaging", "group:automation", "group:nodes", "group:agents", "group:sessions", "group:media", "group:memory", "group:plugins"],
    fs: { workspaceOnly: true },
    elevated: { enabled: false },
  });
  // The model's own plugin and no other, no memory, and OpenClaw's own runtime, so the folder rule is the one in force.
  expect(settings.plugins).toEqual({ allow: ["openai"], entries: { openai: { enabled: true } }, slots: { memory: "none" } });
  expect(settings.agents).toEqual({ defaults: { model: { primary: "openai/sample-model@openai:setup-1" }, models: { "openai/sample-model": { agentRuntime: { id: "openclaw" } } } } });
  // Nothing to send through, nothing that runs on its own, nothing borrowed from the person's own settings.
  expect(Object.keys(settings).sort()).toEqual(["agents", "plugins", "tools"]);
  for (const bad of ["", "sample-model", "openai/sample model", 'openai/x","channels":{'])  expect(() => pinnedConfig(bad)).toThrow();
});

test("a run that used a tool outside its limits is told as failed, and nothing more is handed over", async () => {
  const { claw, runs, work } = worker(0, { ok: true, status: "ok", final: "Done.", costUsd: 0.2, toolSummary: { calls: 2, tools: ["read", "exec", { name: "message" }] } });
  const result = await work();
  expect(result).toMatchObject({ status: "failed", costUsd: 0.2, outside: ["exec", "message"] });
  expect(result.note).toContain("tools outside its limits (exec, message)");
  expect(claw.workerProblem({ limits: LIMITS, tasks: [] })).toContain("takes no more work until the person has looked");
  expect((await work()).status).toBe("failed");
  expect(runs).toHaveLength(1);
});

test("without an OS folder to keep its settings in, or when they cannot be written, nothing runs", async () => {
  const asked: string[][] = [];
  const run: Run = async (args) => { asked.push(args); return { code: 0, stdout: "{}", stderr: "" }; };
  const homeless = openclaw({ run });
  expect(homeless.workerProblem({ limits: LIMITS, tasks: [] })).toBe(NOT_CLEARED);
  expect(await homeless.work({ id: ID, prompt: "x", limits: LIMITS, makeFolder: () => {} })).toEqual({ status: "failed", note: NOT_CLEARED });
  const unwritable = openclaw({ run, root: ROOT, save: () => { throw new Error("disk full"); } });
  expect((await unwritable.work({ id: ID, prompt: "x", limits: LIMITS, makeFolder: () => {} })).note).toContain("could not be written");
  const unnamed = openclaw({ run, root: ROOT, save: () => {} });
  expect((await unnamed.work({ id: ID, prompt: "x", limits: { ...LIMITS, model: "" }, makeFolder: () => {} })).status).toBe("failed");
  expect(asked).toEqual([]);
});

test("a run that timed out, failed or answered nonsense is told as failed, with its cost when known", async () => {
  expect(await worker(2, { ok: false, status: "timeout", costUsd: 0.4 }).work()).toEqual({ status: "failed", note: "It was stopped at the 10-minute limit before it finished.", costUsd: 0.4 });
  expect(await worker(1, { ok: false, status: "error", error: { message: "No API key for openai.", kind: "auth" } }).work()).toEqual({ status: "failed", note: "No API key for openai." });
  expect(await worker(1, "garbage", "Error: config could not be parsed\n").work()).toEqual({ status: "failed", note: "Error: config could not be parsed" });
});

test("only the fixed reads and the one work shape ever reach OpenClaw", async () => {
  const asked: string[][] = [];
  const claw = openclaw({ root: ROOT, save: () => {}, run: async (args) => { asked.push(args); return { code: 0, stdout: "", stderr: "" }; } });
  const bad = await claw.work({ id: "not-an-id", prompt: "x", limits: LIMITS, makeFolder: () => {} });
  expect(bad.status).toBe("failed");
  const relative = await claw.work({ id: ID, prompt: "x", limits: { ...LIMITS, folder: "agents" }, makeFolder: () => {} });
  expect(relative).toEqual({ status: "failed", note: "That is not something the OS asks of OpenClaw." });
  expect(asked).toEqual([]);
});
