import { afterEach, expect, test } from "bun:test";
import { runAssistant, remoteHarnessModels } from "./assistant-adapters";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stream(text: string, keepOpen = false) {
  let cancelled = false;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const bytes = new TextEncoder().encode(text);
          for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
          if (!keepOpen) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
    )) as typeof fetch;
  return () => cancelled;
}
const chunk = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
async function ask() {
  let result = "";
  await runAssistant(
    "/tmp",
    { backend: "local", provider: "ollama", model: "test", prompt: "hi" },
    "",
    new AbortController().signal,
    (text) => {
      result += text;
    },
  );
  return result;
}
test("local SSE keeps split Unicode and accepts a final completion without newline", async () => {
  stream(chunk("Hello café\n\n世界") + "data: [DONE]");
  expect(await ask()).toBe("Hello café\n\n世界");
});
test("a partial local answer fails when the stream ends early", async () => {
  stream(chunk("Not finished"));
  await expect(ask()).rejects.toThrow("incomplete");
});
test("the final buffered provider error is surfaced", async () => {
  stream(chunk("Partial") + 'data: {"error":{"message":"provider stopped"}}');
  await expect(ask()).rejects.toThrow("provider stopped");
});
test("completion ends a local stream even when the server leaves it open", async () => {
  const cancelled = stream(
    chunk("Ready") + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    true,
  );
  expect(await ask()).toBe("Ready");
  expect(cancelled()).toBe(true);
});
test("empty and malformed completed streams are not successful replies", async () => {
  stream("data: [DONE]");
  await expect(ask()).rejects.toThrow("no text");
  stream(chunk("Partial") + "data: not-json\n\ndata: [DONE]");
  await expect(ask()).rejects.toThrow("invalid stream event");
});
test("missing Hermes never advertises unusable routes and preserves a usable SDK route", () => {
  const models = [
    { name: "deepseek/test", backend: "hermes" },
    { name: "other/test", backend: "hermes" },
  ];
  expect(remoteHarnessModels(models, false, false)).toEqual([]);
  expect(remoteHarnessModels(models, false, true).map((x) => x.backend)).toEqual(["deepseek", "deepseek"]);
  expect(remoteHarnessModels(models, true, false)).toEqual(models);
});

test("Claude discovery reads runtime model IDs without prompting or exposing account details", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough, Writable } = await import("node:stream");
  const { discoverClaudeModels } = await import("./assistant-adapters");
  const requests: any[] = []; let args: string[] = []; let killed = false;
  const launch = ((_binary: string, flags: string[]) => {
    args = flags;
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { killed = true; };
    child.stdin = new Writable({write(bytes, _encoding, done) {
      const message = JSON.parse(String(bytes)); requests.push(message);
      const response = {type:"control_response",response:{subtype:"success",request_id:message.request_id,response:{account:{email:"PRIVATE_ACCOUNT",token:"PRIVATE_TOKEN"},models:[
        {value:"default",resolvedModel:"claude-current[1m]"},
        {value:"opus[1m]",resolvedModel:"claude-current[1m]"},
        {value:"claude-new-model[1m]",resolvedModel:"claude-new-model"},
        {value:"sonnet",resolvedModel:"claude-current-sonnet"},
        {value:"unsupported-alias"},
      ]}}};
      queueMicrotask(()=>child.stdout.write(JSON.stringify(response)+"\n")); done();
    }});
    return child;
  }) as any;
  const result = await discoverClaudeModels("/mock/claude",launch);
  expect(result.models.map(model=>model.name)).toEqual(["claude-current[1m]","claude-new-model[1m]","claude-current-sonnet"]);
  expect(result.ready).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(requests).toHaveLength(1);
  expect(requests[0].request.subtype).toBe("initialize");
  expect(args).toContain("--safe-mode");
  expect(args).toContain("--no-session-persistence");
  expect(args[args.indexOf("--tools")+1]).toBe("");
  expect(killed).toBe(true);
});

test("Claude discovery failure returns no invented model list or raw runtime errors", async()=>{
 const { EventEmitter }=await import("node:events"); const {PassThrough,Writable}=await import("node:stream");
 const {discoverClaudeModels}=await import("./assistant-adapters");
 const result=await discoverClaudeModels("/mock/claude",(()=>{
  const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin=new Writable({write(bytes,_e,done){const request=JSON.parse(String(bytes));queueMicrotask(()=>child.stdout.write(JSON.stringify({type:"control_response",response:{subtype:"error",request_id:request.request_id,error:"PRIVATE_ERROR"}})+"\n"));done();}});return child;
 }) as any);
 expect(result.models).toEqual([]);expect(result.ready).toBe(false);expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR");
});

// Windows runtime resolution and launch planning, proven by parameter from any host.
import {
  assistantBinary, assistantPython, claudeSignInStatus, commandLaunch, executableCandidates,
  hermesInstalled, quoteCommandArgument, terminateChild, windowsExtensions,
} from "./assistant-runtime";

const windowsEnv = {
  PATH: "C:\\Windows\\System32;C:\\Users\\example\\AppData\\Roaming\\npm",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  APPDATA: "C:\\Users\\example\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
  SystemRoot: "C:\\Windows",
};

test("Windows resolves claude from PATH, %APPDATA%\\npm, the native installer and Programs folders, .exe before .cmd", () => {
  const home = "C:\\Users\\example";
  const candidates = executableCandidates("claude", { platform: "win32", env: windowsEnv, home, path: windowsEnv.PATH });
  expect(candidates[0]).toBe("C:\\Windows\\System32\\claude.exe");
  for (const expected of [
    "C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd",
    "C:\\Users\\example\\.local\\bin\\claude.exe",
    "C:\\Users\\example\\.bun\\bin\\claude.exe",
    "C:\\Users\\example\\AppData\\Local\\Volta\\bin\\claude.exe",
    "C:\\Users\\example\\AppData\\Local\\Programs\\claude\\claude.exe",
    "C:\\Users\\example\\AppData\\Local\\Programs\\Claude\\bin\\claude.exe",
    "C:\\Program Files\\Claude\\claude.exe",
    "C:\\Users\\example\\AppData\\Local\\Microsoft\\WindowsApps\\claude.exe",
  ]) expect(candidates).toContain(expected);
  expect(candidates.some((candidate) => candidate.startsWith("/") || /\\claude$/.test(candidate))).toBe(false);
  expect(candidates.indexOf("C:\\Users\\example\\AppData\\Roaming\\npm\\claude.exe")).toBeLessThan(candidates.indexOf("C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd"));
  expect(new Set(candidates).size).toBe(candidates.length);
  const shim = "C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd";
  expect(assistantBinary("claude", home, windowsEnv.PATH, { platform: "win32", env: windowsEnv, exists: (candidate) => candidate === shim })).toBe(shim);
  expect(assistantBinary("claude", home, windowsEnv.PATH, { platform: "win32", env: windowsEnv, exists: () => false })).toBeUndefined();
  // Quoted PATH entries are unwrapped; empty entries are dropped.
  expect(executableCandidates("codex", { platform: "win32", env: {}, home, path: '"C:\\Tools\\bin";;' })[0]).toBe("C:\\Tools\\bin\\codex.exe");
});

test("PATHEXT narrows the Windows suffix list but never adds script kinds this OS does not spawn", () => {
  expect(windowsExtensions({})).toEqual([".exe", ".cmd", ".bat", ".com"]);
  expect(windowsExtensions({ PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.PS1" })).toEqual([".exe", ".cmd", ".bat", ".com"]);
  expect(windowsExtensions({ PATHEXT: ".EXE" })).toEqual([".exe"]);
  expect(windowsExtensions({ PATHEXT: ".PS1" })).toEqual([".exe", ".cmd", ".bat", ".com"]);
});

test("POSIX lookups are unchanged: bare names, PATH first, Homebrew and the Codex app bundle", () => {
  expect(executableCandidates("codex", { platform: "darwin", env: {}, home: "/Users/example", path: "/usr/bin:/opt/homebrew/bin" })).toEqual([
    "/usr/bin/codex", "/opt/homebrew/bin/codex", "/Users/example/.local/bin/codex", "/Users/example/.bun/bin/codex", "/usr/local/bin/codex", "/Applications/Codex.app/Contents/Resources/codex",
  ]);
  expect(executableCandidates("claude", { platform: "linux", env: {}, home: "/home/example", path: "" })).toEqual([
    "/home/example/.local/bin/claude", "/home/example/.bun/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
  ]);
});

test("the cmd.exe launch plan quotes like CommandLineToArgvW and leaves native binaries alone", () => {
  expect(quoteCommandArgument("app-server")).toBe("app-server");
  expect(quoteCommandArgument("C:\\Program Files\\x\\codex.cmd")).toBe('"C:\\Program Files\\x\\codex.cmd"');
  expect(quoteCommandArgument('model_provider="openai"')).toBe('"model_provider=\\"openai\\""');
  expect(quoteCommandArgument('{"mcpServers":{}}')).toBe('"{\\"mcpServers\\":{}}"');
  expect(quoteCommandArgument("ends with backslash\\")).toBe('"ends with backslash\\\\"');
  expect(quoteCommandArgument('back\\"slash')).toBe('"back\\\\\\"slash"');
  expect(quoteCommandArgument("")).toBe('""');
  expect(commandLaunch("C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd", ["app-server", "--stdio", "-c", 'model_provider="openai"'], { platform: "win32", env: windowsEnv })).toEqual({
    file: "C:\\Windows\\System32\\cmd.exe",
    windowsVerbatimArguments: true,
    args: ["/d", "/s", "/c", '"C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd app-server --stdio -c "model_provider=\\"openai\\"""'],
  });
  expect(commandLaunch("C:\\Program Files\\Claude\\claude.BAT", ["mcp", "list"], { platform: "win32", env: {} })).toEqual({
    file: "cmd.exe", windowsVerbatimArguments: true, args: ["/d", "/s", "/c", '""C:\\Program Files\\Claude\\claude.BAT" mcp list"'],
  });
  expect(commandLaunch("C:\\Users\\example\\.local\\bin\\claude.exe", ["mcp", "list"], { platform: "win32", env: windowsEnv })).toEqual({ file: "C:\\Users\\example\\.local\\bin\\claude.exe", args: ["mcp", "list"], windowsVerbatimArguments: false });
  expect(commandLaunch("/opt/homebrew/bin/codex.cmd", ["x"], { platform: "darwin" })).toEqual({ file: "/opt/homebrew/bin/codex.cmd", args: ["x"], windowsVerbatimArguments: false });
});

test("terminateChild signals on POSIX and uses taskkill on the process tree on Windows, never a signal name", () => {
  const signals: unknown[] = [];
  const posix = { pid: undefined, kill: (signal?: string) => { signals.push(signal); return true; } };
  terminateChild(posix as any, "SIGTERM", { platform: "darwin", detached: true });
  terminateChild(posix as any, "SIGKILL", { platform: "linux" });
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  const taskkills: string[][] = [];
  const killed: unknown[] = [];
  const run = ((file: string, args: string[], options: any) => {
    taskkills.push([file, ...args, options.windowsHide ? "hidden" : "visible"]);
    return { on() { return this; }, unref() {} };
  }) as any;
  const win = { pid: 4242, kill: (signal?: string) => { killed.push(signal); return true; } };
  terminateChild(win as any, "SIGTERM", { platform: "win32", env: windowsEnv, run });
  expect(taskkills).toEqual([["C:\\Windows\\System32\\taskkill.exe", "/pid", "4242", "/t", "/f", "hidden"]]);
  expect(killed).toEqual([undefined]);
  // Without a pid there is nothing for taskkill; the direct kill still runs and nothing throws.
  terminateChild({ pid: undefined, kill: () => { throw new Error("gone"); } } as any, "SIGKILL", { platform: "win32", env: windowsEnv, run });
  expect(taskkills).toHaveLength(1);
});

test("Windows harness paths: venv Scripts\\python.exe, hermes.exe, and the sign-in probe through a .cmd shim", async () => {
  expect(assistantPython("C:\\Users\\example\\agentic-os", "win32")).toMatch(/[\\/]\.operator-data[\\/]dsh-venv[\\/]Scripts[\\/]python\.exe$/);
  expect(assistantPython("/Users/example/agentic-os", "darwin")).toBe("/Users/example/agentic-os/.operator-data/dsh-venv/bin/python");
  const home = "C:\\Users\\example";
  const venv = ["C:\\Users\\example\\.hermes\\hermes-agent\\venv\\Scripts\\python.exe", "C:\\Users\\example\\.hermes\\hermes-agent\\hermes_cli\\main.py"];
  expect(hermesInstalled(home, "", { platform: "win32", env: windowsEnv, exists: (candidate) => venv.includes(candidate) })).toBe(true);
  expect(hermesInstalled(home, "", { platform: "win32", env: windowsEnv, exists: (candidate) => candidate === venv[0] })).toBe(false);
  expect(hermesInstalled(home, "", { platform: "win32", env: windowsEnv, exists: (candidate) => candidate === "C:\\Users\\example\\.local\\bin\\hermes.exe" })).toBe(true);
  expect(hermesInstalled(home, "", { platform: "win32", env: windowsEnv, exists: () => false })).toBe(false);
  const runs: Array<{ file: string; args: string[]; options: any }> = [];
  const status = await claudeSignInStatus("C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd", async (file, args, options) => { runs.push({ file, args, options }); return { stdout: '{"loggedIn":true}' }; }, { platform: "win32", env: windowsEnv });
  expect(status).toMatchObject({ installed: true, ready: true });
  expect(runs).toEqual([{ file: "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", '"C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd auth status --json"'], options: { timeout: 4000, maxBuffer: 32000, windowsHide: true, windowsVerbatimArguments: true } }]);
  const native = await claudeSignInStatus("C:\\Users\\example\\.local\\bin\\claude.exe", async (file, args) => { runs.push({ file, args, options: {} }); return { stdout: '{"loggedIn":false}' }; }, { platform: "win32", env: windowsEnv });
  expect(native.ready).toBe(false);
  expect(runs[1]).toMatchObject({ file: "C:\\Users\\example\\.local\\bin\\claude.exe", args: ["auth", "status", "--json"] });
});
