import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { claudeDisplayText, startClaudeJob, type ClaudeJobOptions } from "./agent-jobs-claude";
import type { AgentAdapterEvent } from "./agent-jobs-types";

class FakeClaude extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  sent: any[] = [];
  killed: string[] = [];
  args: string[] = [];
  options: any;
  closed = false;
  initialize = true;
  onUser: (message: any) => void = () => {};
  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      for (const line of String(chunk).trim().split("\n")) {
        const message = JSON.parse(line); this.sent.push(message);
        if (message.type === "control_request" && this.initialize) queueMicrotask(() => {
          this.frame({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
          this.frame({ type: "system", subtype: "init", session_id: "session-123", mcp_servers: [{ name: "redacted", status: "connected" }] });
        });
        if (message.type === "user") queueMicrotask(() => this.onUser(message));
      }
    });
  }
  frame(value: unknown) { this.stdout.write(`${JSON.stringify(value)}\n`); }
  kill(signal: string) { this.killed.push(signal); queueMicrotask(() => this.close()); return true; }
  close() { if (!this.closed) { this.closed = true; this.emit("close", 0); } }
  spawn = (_bin: string, args: string[], options: any) => { this.args = args; this.options = options; return this as any; };
}
const complete = { type: "result", subtype: "success", is_error: false, permission_denials: [], result: "Done." };
const permission = (tool = "Bash", data: object = { command: "echo hello" }, id = "request-1") => ({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: tool, input: data } });
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
function setup(options: ClaudeJobOptions = {}, readOnly = false) {
  const child = new FakeClaude();
  const events: AgentAdapterEvent[] = [];
  const controller = new AbortController();
  const job = startClaudeJob({ cwd: "/tmp", prompt: "A harmless task", signal: controller.signal, onEvent: (event) => events.push(event), readOnly }, {
    binary: "/fixture/claude", spawn: child.spawn as any, initializeTimeoutMs: 500,
    runTimeoutMs: 1000, inputTimeoutMs: 500, shutdownTimeoutMs: 20, ...options,
  });
  return { child, events, job, controller };
}
const errors = (events: AgentAdapterEvent[]) => events.filter((event) => event.type === "error");
const results = (events: AgentAdapterEvent[]) => events.filter((event) => event.type === "done");

describe("Claude native task adapter", () => {
  test("simultaneous approvals are shown one at a time and only the visible request can be answered", async () => {
    const { child, events, job } = setup();
    child.onUser = () => {
      child.frame(permission("Bash", { command: "echo first" }, "first"));
      child.frame(permission("Write", { file_path: "/tmp/fixture" }, "second"));
    };
    await pause();
    const initial = events.filter((event) => event.type === "input");
    job.respond("second", "approve");
    const earlyReplies = child.sent.filter((message) => message.type === "control_response");
    job.respond("first", "approve");
    const next = events.filter((event) => event.type === "input").at(-1);
    job.respond("second", "approve");
    child.frame(complete); await job.done;
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ id: "first" });
    expect(earlyReplies).toHaveLength(0);
    expect(next).toMatchObject({ id: "second" });
    expect(child.sent.filter((message) => message.type === "control_response").map((message) => message.response.request_id)).toEqual(["first", "second"]);
    expect(results(events)).toHaveLength(1);
  });
  test("starts native streaming, preserves auth/MCP and waits for initialization", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame(complete);
    await job.done;
    expect(child.args).toContain("--permission-prompt-tool");
    expect(child.args).toContain("stdio");
    expect(child.args).toContain("manual");
    expect(child.args.join(" ")).not.toMatch(/skip-permissions|bypassPermissions|strict-mcp-config/);
    expect(child.options.env).toBe(process.env);
    expect(child.sent.map((item) => item.type)).toEqual(["control_request", "user"]);
    expect(events.some((event) => event.type === "session" && event.id === "session-123")).toBe(true);
    expect(results(events)).toHaveLength(1);
    expect(errors(events)).toHaveLength(0);
  });
  test("streams only visible assistant text without duplicating the full message", async () => {
    const { child, events, job } = setup();
    child.onUser = () => {
      child.frame({ type: "stream_event", event: { type: "message_start" } });
      child.frame({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private reasoning" } } });
      child.frame({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } } });
      child.frame({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } } });
      child.frame({ type: "assistant", message: { id: "message-1", content: [{ type: "text", text: "Hello world" }] } });
      child.frame({ type: "assistant", message: { id: "message-1", content: [{ type: "text", text: "Hello world" }] } });
      child.frame(complete);
    };
    await job.done;
    const text = events.filter((event) => event.type === "text");
    expect(text.at(-1)).toEqual({ type: "text", text: "Hello world", append: false });
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });
  test("waits for exact operator approval and passes original input without persistent rules", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame(permission());
    await pause();
    expect(events.some((event) => event.type === "input" && event.kind === "approval")).toBe(true);
    expect(child.sent).toHaveLength(2);
    job.respond("different-id", "approve");
    expect(child.sent).toHaveLength(2);
    job.respond("request-1", "approve");
    job.respond("request-1", "approve");
    expect(child.sent.at(-1).response.response).toEqual({ behavior: "allow", toolName: "Bash", updatedInput: { command: "echo hello" } });
    expect(child.sent).toHaveLength(3);
    child.frame(complete); await job.done;
    expect(results(events)).toHaveLength(1);
  });
  test("redacts credential fields and progress never exposes raw tool arguments", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame(permission("mcp__gmail__send", { to: "alex@example.test", body: "Hi", token: "sensitive", authorization: "Bearer hidden", nested: { apiKey: "hidden" } }));
    await pause();
    const serialized = JSON.stringify(events);
    expect(serialized).toContain("alex@example.test");
    expect(serialized).not.toContain("sensitive");
    expect(serialized).not.toContain("hidden");
    job.cancel(); await job.done;
  });
  test("denied action never becomes complete even if runtime emits success", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame(permission());
    await pause(); job.respond("request-1", "deny"); child.frame(complete);
    await job.done;
    expect(child.sent.at(-1).response.response.behavior).toBe("deny");
    expect(results(events)).toHaveLength(0); expect(errors(events)).toHaveLength(1);
  });
  test("native permission denials invalidate nominal success", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame({ ...complete, permission_denials: [{ tool_name: "Write" }] });
    await job.done; expect(results(events)).toHaveLength(0); expect(errors(events)).toHaveLength(1);
  });
  test("question answers must cover every exact question and are handed back once", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame(permission("AskUserQuestion", { questions: [{ question: "Which day?", options: [{ label: "Thursday" }] }] }));
    await pause();
    expect(events.find((event) => event.type === "input")).toMatchObject({ kind: "question", choices: ["Thursday"] });
    job.respond("request-1", "approve", { wrong: "answer" });
    expect(child.sent).toHaveLength(2);
    job.respond("request-1", "approve", { "question-1": "Thursday" });
    expect(child.sent.at(-1).response.response.updatedInput.answers).toEqual({ "Which day?": "Thursday" });
    child.frame(complete); await job.done;
  });
  test("pending questions time out closed", async () => {
    const { child, events, job } = setup({ inputTimeoutMs: 15 });
    child.onUser = () => child.frame(permission());
    await job.done; expect(errors(events)).toHaveLength(1); expect(results(events)).toHaveLength(0);
  });
  test("unsupported control requests fail closed", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.frame({ type: "control_request", request_id: "elicitation-1", request: { subtype: "elicitation", message: "secret" } });
    await job.done; expect(results(events)).toHaveLength(0); expect(errors(events)).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("secret");
  });
  test("read-only review disables inherited MCP and write tools; protocol gate rejects unexpected writes", async () => {
    const { child, events, job } = setup({}, true);
    child.onUser = () => child.frame(permission("mcp__email__send", { body: "Must not run" }));
    await job.done;
    expect(child.args).toContain("plan"); expect(child.args).toContain("--strict-mcp-config");
    expect(child.args).toContain('{"mcpServers":{}}');
    expect(child.args[child.args.indexOf("--tools") + 1]).not.toMatch(/Bash|Write|Edit|Agent/);
    expect(child.sent.at(-1).response.response.behavior).toBe("deny");
    expect(results(events)).toHaveLength(0);
  });
  test("abort stops the child and publishes only one terminal state", async () => {
    const { child, events, job, controller } = setup();
    await pause(); controller.abort(); job.cancel(); child.frame(complete); await job.done;
    expect(child.killed).toContain("SIGTERM"); expect(errors(events)).toHaveLength(1); expect(results(events)).toHaveLength(0);
  });
  test("cancelling before startup never spawns a process", async () => {
    const { child, events, job } = setup(); job.cancel(); await job.done; await pause();
    expect(child.args).toHaveLength(0); expect(errors(events)).toHaveLength(1);
  });
  test("early close is failure, not an empty completion", async () => {
    const { child, events, job } = setup();
    child.onUser = () => child.close(); await job.done;
    expect(results(events)).toHaveLength(0); expect(errors(events)).toHaveLength(1);
  });
  test("signin errors are useful without leaking stderr", async () => {
    const { child, events, job } = setup();
    child.onUser = () => { child.stderr.write("Authentication failed token=super-secret"); child.close(); };
    await job.done;
    expect(errors(events)[0]).toMatchObject({ message: expect.stringContaining("/login") });
    expect(JSON.stringify(events)).not.toContain("super-secret");
  });
  test("startup and run have bounded timeouts", async () => {
    const first = setup({ initializeTimeoutMs: 10 }); first.child.initialize = false;
    await first.job.done; expect(errors(first.events)[0]).toMatchObject({ message: expect.stringContaining("initialize") });
    const second = setup({ runTimeoutMs: 15 }); await second.job.done;
    expect(errors(second.events)[0]).toMatchObject({ message: expect.stringContaining("time limit") });
  });
  test("oversized and malformed frames stop processing", async () => {
    const first = setup(); first.child.onUser = () => first.child.stdout.write("x".repeat(512001));
    await first.job.done; expect(errors(first.events)).toHaveLength(1);
    const second = setup(); second.child.onUser = () => second.child.stdout.write("not json\n");
    await second.job.done; expect(errors(second.events)).toHaveLength(1);
  });
  test("background work prevents premature success", async () => {
    const { child, events, job } = setup();
    child.onUser = () => {
      child.frame({ type: "system", subtype: "task_started", task_id: "task-1" });
      child.frame(complete);
    };
    await pause(); expect(results(events)).toHaveLength(0);
    child.frame({ type: "system", subtype: "task_notification", task_id: "task-1", status: "completed" });
    child.frame(complete); await job.done;
    expect(results(events)).toHaveLength(1);
  });
  test("malformed or withdrawn questions cannot leave stale approvals", async () => {
    const first = setup(); first.child.onUser = () => first.child.frame(permission("AskUserQuestion", { questions: [{}] }));
    await first.job.done; expect(errors(first.events)).toHaveLength(1);
    const second = setup(); second.child.onUser = () => second.child.frame(permission());
    await pause(); second.child.frame({ type: "control_cancel_request", request_id: "request-1" });
    second.job.respond("request-1", "approve"); await second.job.done;
    expect(second.child.sent).toHaveLength(2); expect(errors(second.events)).toHaveLength(1);
  });
  test("redacts token strings and terminal escapes", () => {
    expect(claudeDisplayText("\x1b[31mtext sk-abc123 Bearer abcdef password=hello\x00")).toBe("text [redacted] Bearer [redacted] password=[redacted]");
  });
});

test("on Windows a claude.cmd shim runs through cmd.exe with verbatim quoting, no detached group, and stops without POSIX signal names", async () => {
  const child = new FakeClaude();
  let file = "";
  const spawnSpy = ((binary: string, args: string[], options: any) => { file = binary; return child.spawn(binary, args, options); }) as any;
  const events: AgentAdapterEvent[] = [];
  const controller = new AbortController();
  const job = startClaudeJob({ cwd: "C:\\Users\\example\\agentic-os", prompt: "A harmless task", signal: controller.signal, onEvent: (event) => events.push(event), readOnly: true }, {
    binary: "C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd", spawn: spawnSpy, platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    initializeTimeoutMs: 500, runTimeoutMs: 1000, inputTimeoutMs: 500, shutdownTimeoutMs: 20,
  });
  await pause();
  expect(file).toBe("C:\\Windows\\System32\\cmd.exe");
  expect(child.options).toMatchObject({ cwd: "C:\\Users\\example\\agentic-os", detached: false, windowsHide: true, windowsVerbatimArguments: true });
  expect(child.options.env).toBe(process.env);
  expect(child.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
  const command = child.args[3];
  expect(command).toStartWith('"C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd --print --input-format stream-json --output-format stream-json');
  expect(command).toContain("--permission-prompt-tool stdio --permission-mode plan");
  // The JSON MCP config and the multi-word system prompt survive cmd.exe quoting.
  expect(command).toContain('--mcp-config "{\\"mcpServers\\":{}}"');
  expect(command).toContain('--append-system-prompt "You are completing one task delegated by the operator through Jarvis.');
  expect(command).toEndWith('"');
  job.cancel();
  await job.done;
  expect(child.killed.length).toBeGreaterThan(0);
  expect(child.killed.every((signal) => signal === undefined)).toBe(true);
  expect(errors(events)).toHaveLength(1);
});

test("on Windows a native claude.exe starts directly and still has no detached process group", async () => {
  const child = new FakeClaude();
  let file = "";
  const spawnSpy = ((binary: string, args: string[], options: any) => { file = binary; return child.spawn(binary, args, options); }) as any;
  const controller = new AbortController();
  const job = startClaudeJob({ cwd: "C:\\Users\\example\\agentic-os", prompt: "A harmless task", signal: controller.signal, onEvent: () => {} }, {
    binary: "C:\\Users\\example\\.local\\bin\\claude.exe", spawn: spawnSpy, platform: "win32", env: {}, initializeTimeoutMs: 500, runTimeoutMs: 1000, inputTimeoutMs: 500, shutdownTimeoutMs: 20,
  });
  await pause();
  expect(file).toBe("C:\\Users\\example\\.local\\bin\\claude.exe");
  expect(child.args[0]).toBe("--print");
  expect(child.options).toMatchObject({ detached: false, windowsVerbatimArguments: false });
  job.cancel();
  await job.done;
});
