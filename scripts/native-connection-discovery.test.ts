import { expect, test } from "bun:test";
import { claudeConnectionMetadata } from "./native-connection-discovery";
test("Claude metadata keeps safe names and health without URLs, credentials or invented callability", () => {
  const result = claudeConnectionMetadata("Checking MCP server health...\nnotion: https://private.example?token=secret - ✓ Connected\nslack: local-command --secret hidden - ✗ Failed to connect\n");
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ name: "notion", harness: "claude", isAccessible: true, callable: null, directAuthorization: false });
  expect(result[1].isAccessible).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/private|secret|hidden|https/);
});

import { nativeConnectionDiscovery } from "./native-connection-discovery";
import { assistantBinary } from "./assistant-runtime";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Claude installed through PATH is discoverable outside the default home location", () => {
  const directory = mkdtempSync(join(tmpdir(), "claude-discovery-"));
  try {
    const binary = join(directory, process.platform === "win32" ? "claude.exe" : "claude");
    writeFileSync(binary, "synthetic executable", { mode: 0o755 });
    expect(assistantBinary("claude", join(directory, "empty-home"), directory)).toBe(binary);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("explicit rescan refreshes Claude health instead of returning cached metadata", async () => {
  let calls = 0;
  const launch = (() => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null;
    child.kill = () => { child.signalCode = "SIGTERM"; return true; };
    const label = ++calls === 1 ? "first" : "second";
    queueMicrotask(() => {
      child.stdout.write(`${label}: https://example.test - ✓ Connected\n`);
      child.exitCode = 0; child.emit("close", 0);
    });
    return child;
  }) as any;
  const service = nativeConnectionDiscovery("/synthetic", { claudeBinary: "/synthetic/claude", claudeStart: launch });
  try {
    expect((await service.read()).apps.map(app => app.name)).toEqual(["first"]);
    expect((await service.read()).apps.map(app => app.name)).toEqual(["first"]);
    expect(calls).toBe(1);
    expect((await service.read(true)).apps.map(app => app.name)).toEqual(["second"]);
    expect(calls).toBe(2);
  } finally { service.close(); }
});

test("on Windows the Claude MCP check runs claude.cmd through cmd.exe, hidden, and stops it without POSIX signal names", async () => {
  const launched: Array<{ file: string; args: string[]; options: any }> = [];
  const kills: unknown[] = [];
  const launch = ((file: string, args: string[], options: any) => {
    launched.push({ file, args, options });
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null;
    child.kill = (signal?: string) => { kills.push(signal); return true; };
    queueMicrotask(() => { child.stdout.write("notion: https://example.test - ✓ Connected\n"); child.exitCode = 0; child.emit("close", 0); });
    return child;
  }) as any;
  const service = nativeConnectionDiscovery("C:\\Users\\example\\agentic-os", {
    claudeBinary: "C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd", claudeStart: launch,
    platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });
  try {
    const result = await service.read();
    expect(result.apps.map((app) => [app.name, app.harness, app.isAccessible])).toEqual([["notion", "claude", true]]);
    expect(launched).toHaveLength(1);
    expect(launched[0].file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(launched[0].args).toEqual(["/d", "/s", "/c", '"C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd mcp list"']);
    expect(launched[0].options).toMatchObject({ cwd: "C:\\Users\\example\\agentic-os", windowsHide: true, windowsVerbatimArguments: true, env: { NO_COLOR: "1" } });
    expect(kills.length).toBeGreaterThan(0);
    expect(kills.every((signal) => signal === undefined)).toBe(true);
  } finally { service.close(); }
});

test("only Claude's connections are listed; no Codex inventory is read", async () => {
  const launch = (() => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null;
    child.kill = () => { child.signalCode = "SIGTERM"; return true; };
    queueMicrotask(() => { child.stdout.write("notion: https://example.test - ✓ Connected\n"); child.exitCode = 0; child.emit("close", 0); });
    return child;
  }) as any;
  const service = nativeConnectionDiscovery("/synthetic", { claudeBinary: "/synthetic/claude", claudeStart: launch, env: { AGENTIC_OS_NO_CODEX: "1" } });
  try {
    const result = await service.read();
    expect(result.harnesses.map((harness) => harness.id)).toEqual(["claude"]);
    expect(result.apps.map((app) => app.harness)).toEqual(["claude"]);
    expect(result.detail).toBe(result.harnesses[0].detail);
  } finally { service.close(); }
});
