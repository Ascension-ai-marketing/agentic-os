import { expect, test } from "bun:test";
import { NEVER_COMMANDS, NEVER_FLAGS, NOT_CLEARED, NOT_INSTALLED, openclaw, openclawPaths, type Run } from "./ceo-openclaw";

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
