import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existingConnectionDiscovery, normalizeExistingApps } from "./account-discovery";

function runtime(replies: Record<string, unknown>, split = false) {
  const requests: any[] = [], children: any[] = [];
  const start = (_binary: string, args: string[]) => {
    expect(args).toEqual(["app-server", "--stdio"]);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null as string | null, kill(signal: string) { this.signalCode = signal; return true; } });
    children.push(child); let buffer = "";
    child.stdin.on("data", chunk => {
      buffer += chunk.toString(); let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); requests.push(message);
        const response = message.method === "initialize" ? { result: { userAgent: "synthetic" } } : (typeof replies[message.method] === "function" ? (replies[message.method] as Function)(message.params) : replies[message.method]) ?? (message.method === "plugin/installed" ? { result: { marketplaces: [] } } : undefined);
        if (response) queueMicrotask(() => {
          const data = Buffer.from(JSON.stringify({ id: message.id, ...response as object }) + "\n");
          if (split) for (const byte of data) child.stdout.write(Buffer.from([byte]));
          else child.stdout.write(data);
        });
      }
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { start, requests, children };
}
test("only explicit refreshed responses establish callability; metadata fields stay separate and private", async () => {
  const mock = runtime({ "app/list": { result: { data: [{ id: "gmail", name: "Gmaíl", isAccessible: true, isEnabled: true, privateToken: "must-not-return" }, { id: "directory", name: "Directory app", isAccessible: true, isEnabled: true }], nextCursor: "next" } }, "app/installed": { result: { apps: [{ id: "gmail", enabled: false, callable: false }] } } }, true);
  const service = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start });
  const result = await service.read();
  expect(mock.requests.map(request => request.method)).toEqual(["initialize", "initialized", "app/list", "app/installed", "plugin/installed", "app/list"]);
  expect(mock.requests[2].params).toEqual({ limit: 50, forceRefetch: true });
  expect(mock.requests[3].params).toEqual({ forceRefresh: true });
  expect(result).toMatchObject({ status: "available", runtimeFresh: true, truncated: true });
  expect(result.apps[0]).toMatchObject({ id: "gmail", name: "Gmaíl", isAccessible: true, isEnabled: true, runtimeEnabled: false, callable: false, observed: true, directAuthorization: false });
  expect(result.apps[1]).toMatchObject({ callable: null, observed: false });
  expect(JSON.stringify(result)).not.toContain("must-not-return"); expect(mock.children[0].signalCode).toBe("SIGTERM"); service.close();
});
test("concurrent checks share one process and cached metadata expires without claiming a new check", async () => {
  let now = 1000;
  const mock = runtime({ "app/list": { result: { data: [] } }, "app/installed": { result: { apps: [{ id: "gmail", runtimeName: "Gmail", enabled: true, callable: true }] } } });
  const service = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start, now: () => now, ttlMs: 1000 });
  const [first, second] = await Promise.all([service.read(), service.read()]);
  expect(first).toEqual(second); expect(mock.children).toHaveLength(1);
  first.apps.length = 0; expect((await service.read()).apps).toHaveLength(1);
  now += 1001; await service.read(); expect(mock.children).toHaveLength(2); service.close();
});
test("unsupported runtime discovery leaves callable unknown even when app metadata says accessible", async () => {
  const mock = runtime({ "app/list": { result: { data: [{ id: "gmail", name: "Gmail", isAccessible: true, isEnabled: true }] } }, "app/installed": { error: { code: -32601, message: "private internal path" } } });
  const service = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start });
  const result = await service.read(); expect(result.runtimeFresh).toBe(false); expect(result.apps[0].callable).toBeNull(); expect(JSON.stringify(result)).not.toContain("private internal path"); service.close();
});
test("missing optional Codex does not start a process and old unsupported RPCs fail safely", async () => {
  const absent = existingConnectionDiscovery("/synthetic", { binary: null, start: () => { throw new Error("Must not launch"); } });
  expect((await absent.read()).status).toBe("unavailable"); absent.close();
  const mock = runtime({ "app/list": { error: { code: -32601 } }, "app/installed": { error: { code: -32601 } } });
  const old = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start }); expect((await old.read()).status).toBe("unsupported"); old.close();
});
test("timeout, oversized metadata and malformed output terminate without leaking output", async () => {
  for (const failure of ["timeout", "oversize", "malformed"]) {
    const mock = runtime({}); const service = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start, timeoutMs: 15 });
    const pending = service.read();
    if (failure === "oversize") mock.children[0].stderr.write("private".repeat(400000));
    if (failure === "malformed") mock.children[0].stdout.write("private-output\n");
    const result = await pending;
    expect(result.status).toBe(failure === "timeout" ? "timeout" : "error"); expect(result.apps).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("private"); expect(mock.children[0].signalCode).toBe("SIGTERM"); service.close();
  }
});
test("directory notifications alone never establish callability and shutdown cancels pending discovery", async () => {
  const mock = runtime({}), service = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start });
  const pending = service.read();
  mock.children[0].stdout.write(JSON.stringify({ method: "app/list/updated", params: { data: [{ id: "gmail", name: "Gmail", isAccessible: true, isEnabled: true }] } }) + "\n");
  service.close(); const result = await pending;
  expect(result.status).toBe("unavailable"); expect(result.apps).toHaveLength(0); expect((await service.read()).status).toBe("unavailable");
});
test("metadata normalization bounds output and never invents missing flags", () => {
  const data = Array.from({ length: 600 }, (_, i) => ({ id: `app-${i}`, name: "x".repeat(500), isAccessible: true }));
  const result = normalizeExistingApps({ data }, { apps: [{ id: "native", runtimeName: "Observed app", enabled: true, callable: true }] });
  expect(result.apps).toHaveLength(500); expect(result.truncated).toBe(true);
  expect(result.apps[0]).toMatchObject({ id: "native", isAccessible: null, isEnabled: null, observed: true, callable: true });
  expect(result.apps[1].name).toHaveLength(80);
});

test("completed listing survives a runtime timeout without inventing callability", async () => {
  const mock = runtime({ "app/list": { result: { data: [{ id: "slack", name: "Slack", isAccessible: true }] } } });
  const service = existingConnectionDiscovery("/synthetic", { binary: "synthetic", start: mock.start, timeoutMs: 15 });
  const pending = service.read(); mock.children[0].stderr.write("discarded diagnostic ".repeat(40000));
  const result = await pending;
  expect(result).toMatchObject({ status: "available", runtimeFresh: false });
  expect(result.apps[0]).toMatchObject({ name: "Slack", callable: null });
  expect(JSON.stringify(result)).not.toContain("discarded"); service.close();
});

test("discovery follows all metadata pages and includes installed plugins without paths or secrets", async () => {
  const mock = runtime({
    "app/list": (params: any) => ({ result: params.cursor ? { data:[{id:"granola",name:"Granola",isAccessible:true}],nextCursor:null } : {data:[{id:"gmail",name:"Gmail"}],nextCursor:"page-two"} }),
    "app/installed": {result:{apps:[{id:"granola",runtimeName:"Granola",enabled:true,callable:true}]}},
    "plugin/installed": {result:{marketplaces:[{path:"PRIVATE",plugins:[{id:"granola-plugin",name:"granola",interface:{displayName:"Granola"},installed:true,enabled:true,installPath:"PRIVATE",token:"PRIVATE"},{id:"uninstalled",installed:false}]}]}}
  });
  const service=existingConnectionDiscovery("/synthetic",{binary:"synthetic",start:mock.start});
  const result=await service.read(); expect(result.truncated).toBe(false); expect(result.apps).toHaveLength(2);
  expect(result.apps[0]).toMatchObject({id:"granola",callable:true}); expect(result.plugins).toEqual([{id:"granola-plugin",name:"Granola",enabled:true}]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(mock.requests.filter(r=>r.method==="app/list").map(r=>r.params.cursor)).toEqual([undefined,"page-two"]);
  await service.read(true); expect(mock.children).toHaveLength(2); service.close();
});

import { installedCodex } from "./account-discovery";

// Windows branches are proven by parameter: no real process, no real file system.
const windowsEnv = {
  PATH: "C:\\Windows\\System32;C:\\Users\\example\\AppData\\Roaming\\npm",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  APPDATA: "C:\\Users\\example\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
};
const npmShim = "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd";

test("Windows finds the npm codex.cmd shim, prefers .exe, probes bun/volta/pnpm/scoop folders and keeps the AGENTIC_OS_NO_CODEX switch", () => {
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: (candidate) => candidate === npmShim })).toBe(npmShim);
  // With nothing installed every well-known Windows folder is probed, and only Windows-shaped files are.
  const probed: string[] = [];
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: (candidate) => { probed.push(candidate); return false; } })).toBeNull();
  expect(probed.every((candidate) => /^[A-Z]:\\.*\.(?:exe|cmd|bat|com)$/.test(candidate))).toBe(true);
  for (const folder of ["C:\\Users\\example\\AppData\\Local\\Volta\\bin", "C:\\Users\\example\\.bun\\bin", "C:\\Users\\example\\AppData\\Local\\pnpm", "C:\\Users\\example\\scoop\\shims", "C:\\Users\\example\\.local\\bin", "C:\\Users\\example\\AppData\\Local\\Programs\\Codex"])
    expect(probed).toContain(folder + "\\codex.exe");
  // Same folder, both kinds present: the native .exe wins so no shell is needed.
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: (candidate) => candidate.startsWith("C:\\Users\\example\\AppData\\Roaming\\npm\\codex.") })).toBe("C:\\Users\\example\\AppData\\Roaming\\npm\\codex.exe");
  // PATHEXT without .CMD means Windows itself would not run the shim either.
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: { ...windowsEnv, PATHEXT: ".EXE" }, exists: (candidate) => candidate === npmShim })).toBeNull();
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: { ...windowsEnv, AGENTIC_OS_NO_CODEX: "1" }, exists: () => true })).toBeNull();
  expect(installedCodex("C:\\Users\\example", undefined, { platform: "win32", env: windowsEnv, exists: () => false })).toBeNull();
});

test("on Windows a codex.cmd shim is launched through cmd.exe with verbatim quoting and stopped without POSIX signal names", async () => {
  const launched: Array<{ file: string; args: string[]; cwd: string }> = [];
  const kills: unknown[] = [];
  const mock = runtime({ "app/list": { result: { data: [] } }, "app/installed": { result: { apps: [{ id: "gmail", runtimeName: "Gmail", enabled: true, callable: true }] } } });
  const start = (file: string, args: string[], cwd: string) => {
    launched.push({ file, args, cwd });
    const child = mock.start("synthetic", ["app-server", "--stdio"]) as any;
    const kill = child.kill.bind(child);
    child.kill = (signal?: string) => { kills.push(signal); return kill(signal); };
    return child;
  };
  const service = existingConnectionDiscovery("C:\\Users\\example\\agentic-os", { binary: npmShim, start, platform: "win32", env: windowsEnv });
  const result = await service.read();
  expect(result).toMatchObject({ status: "available", runtimeFresh: true });
  expect(launched).toEqual([{ file: "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", '"C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd app-server --stdio"'], cwd: "C:\\Users\\example\\agentic-os" }]);
  expect(kills.length).toBeGreaterThan(0);
  expect(kills.every((signal) => signal === undefined)).toBe(true);
  service.close();
  // A native codex.exe needs no shell at all.
  const direct = existingConnectionDiscovery("C:\\Users\\example\\agentic-os", { binary: "C:\\Users\\example\\.local\\bin\\codex.exe", start, platform: "win32", env: windowsEnv });
  await direct.read();
  expect(launched[1]).toMatchObject({ file: "C:\\Users\\example\\.local\\bin\\codex.exe", args: ["app-server", "--stdio"] });
  direct.close();
});
