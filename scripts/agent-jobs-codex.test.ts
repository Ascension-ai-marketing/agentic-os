import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { startCodexJob, safeAgentText } from "./agent-jobs-codex";
import type { AgentAdapterEvent, AgentRunInput } from "./agent-jobs-types";

class FakeCodex extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  args: string[] = [];
  options: any;
  sent: any[] = [];
  stopped: string[] = [];
  account: unknown = { type: "chatgpt" };
  stall?: string;
  fail?: string;
  onTurn: () => void = () => {};
  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      for (const line of String(chunk).trim().split("\n")) {
        const message = JSON.parse(line); this.sent.push(message);
        if (message.id === undefined || !message.method || message.method === this.stall) continue;
        queueMicrotask(() => {
          if (message.method === this.fail) return this.frame({ id: message.id, error: { code: -1, message: "provider raw secret" } });
          const results: Record<string, unknown> = {
            initialize: { userAgent: "fixture" },
            "account/read": { account: this.account },
            "thread/start": { thread: { id: "thread-123" } },
            "turn/start": { turn: { id: "turn-123" } },
            "turn/interrupt": {},
          };
          this.frame({ id: message.id, result: results[message.method] });
          if (message.method === "turn/start") queueMicrotask(() => this.onTurn());
        });
      }
    });
  }
  frame(value: unknown) { this.stdout.write(`${JSON.stringify(value)}\n`); }
  notify(method: string, params: object = {}) { this.frame({ method, params: { threadId: "thread-123", turnId: "turn-123", ...params } }); }
  finish(status = "completed") { this.notify("turn/completed", { turn: { id: "turn-123", status } }); }
  ask(id: string | number, method = "item/commandExecution/requestApproval", params: object = {}) {
    this.frame({ id, method, params: { threadId: "thread-123", turnId: "turn-123", command: "echo hello", ...params } });
  }
  close() { if (this.exitCode === null) { this.exitCode = 0; this.emit("close", 0); } }
  kill(signal: string) { this.stopped.push(signal); this.signalCode = signal; queueMicrotask(() => this.close()); return true; }
  launch = (_binary: string, args: string[], options: any) => { this.args = args; this.options = options; return this as any; };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
function setup(overrides: Partial<AgentRunInput> = {}, runtime: { timeoutMs?: number; configure?: (child: FakeCodex) => void } = {}) {
  const child = new FakeCodex(); runtime.configure?.(child);
  const controller = new AbortController();
  const events: AgentAdapterEvent[] = [];
  const job = startCodexJob({ cwd: "/tmp", prompt: "A harmless fixture task", signal: controller.signal, onEvent: (event) => events.push(event), ...overrides }, {
    binary: "/fixture/codex", launch: child.launch as any, timeoutMs: runtime.timeoutMs ?? 1000,
  });
  return { child, controller, events, job };
}
const doneEvents = (events: AgentAdapterEvent[]) => events.filter((event) => event.type === "done");
const errorEvents = (events: AgentAdapterEvent[]) => events.filter((event) => event.type === "error");
const replies = (child: FakeCodex) => child.sent.filter((message) => message.id !== undefined && !message.method);

describe("Codex native task adapter", () => {
  test("handshake checks native account before creating a persistent task", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.finish(); await job.done;
    expect(child.args).toEqual(["app-server", "--stdio", "-c", 'model_provider="openai"']);
    expect(child.sent.map((message) => message.method)).toEqual(["initialize", "initialized", "account/read", "thread/start", "turn/start"]);
    expect(child.sent.find((message) => message.method === "account/read").params).toEqual({ refreshToken: false });
    expect(child.sent.find((message) => message.method === "thread/start").params).toMatchObject({ cwd: "/tmp", sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user", ephemeral: false });
    expect(child.sent.find((message) => message.method === "turn/start").params.input).toEqual([{ type: "text", text: "A harmless fixture task" }]);
    expect(events).toContainEqual({ type: "session", id: "thread-123" });
    expect(doneEvents(events)).toHaveLength(1); expect(errorEvents(events)).toHaveLength(0);
  });
  test("native API-key account works without copying a key into the thread", async () => {
    const { child, events, job } = setup({}, { configure: (child) => { child.account = { type: "apiKey" }; } });
    child.onTurn = () => child.finish(); await job.done;
    expect(doneEvents(events)).toHaveLength(1);
    expect(JSON.stringify(child.sent)).not.toContain("apiKey");
  });
  test("signed-out account stops before thread or turn creation", async () => {
    const { child, events, job } = setup({}, { configure: (child) => { child.account = null; } });
    await job.done;
    expect(child.sent.some((message) => message.method === "thread/start")).toBe(false);
    expect(errorEvents(events)[0]).toMatchObject({ message: expect.stringContaining("signed out") });
    expect(doneEvents(events)).toHaveLength(0);
  });
  test("read-only jobs request the native read-only sandbox", async () => {
    const { child, job } = setup({ readOnly: true }); child.onTurn = () => child.finish(); await job.done;
    expect(child.sent.find((message) => message.method === "thread/start").params.sandbox).toBe("read-only");
  });
  test("progress is derived from tool names while text streams and final answer replaces it", async () => {
    const { child, events, job } = setup(); child.onTurn = () => {
      child.notify("item/started", { item: { type: "mcpToolCall", tool: "gmail.search", arguments: { secret: "never exposed" } } });
      child.notify("item/agentMessage/delta", { delta: "Hello " });
      child.notify("item/agentMessage/delta", { delta: "world" });
      child.notify("item/completed", { item: { type: "commandExecution", status: "completed", aggregatedOutput: "private command output" } });
      child.notify("item/completed", { item: { type: "agentMessage", phase: "final_answer", text: "Hello world" } });
      child.finish();
    }; await job.done;
    expect(events).toContainEqual({ type: "progress", label: "Using gmail.search" });
    expect(events).toContainEqual({ type: "text", text: "Hello ", append: true });
    expect(events.filter((event) => event.type === "text").at(-1)).toEqual({ type: "text", text: "Hello world" });
    expect(JSON.stringify(events)).not.toMatch(/never exposed|private command output/);
  });
  test("approval requires the exact ID, is sent once, and never auto-accepts", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.ask(71); await wait();
    expect(events.find((event) => event.type === "input")).toMatchObject({ id: "71", kind: "approval", detail: "echo hello" });
    expect(replies(child)).toHaveLength(0);
    expect(() => job.respond("wrong", "approve")).toThrow(); expect(replies(child)).toHaveLength(0);
    job.respond("71", "approve");
    expect(replies(child)).toEqual([{ id: 71, result: { decision: "accept" } }]);
    expect(() => job.respond("71", "approve")).toThrow();
    expect(events).toContainEqual({ type: "input_resolved", id: "71" });
    child.finish(); await job.done;
  });
  test("approval queue preserves wire string IDs and exposes requests one at a time", async () => {
    const { child, events, job } = setup(); child.onTurn = () => { child.ask("first"); child.ask("second", "item/fileChange/requestApproval", { grantRoot: "/tmp/task" }); child.ask("first"); }; await wait();
    expect(events.filter((event) => event.type === "input")).toHaveLength(1);
    expect(() => job.respond("second", "approve")).toThrow();
    job.respond("first", "approve");
    expect(events.filter((event) => event.type === "input").at(-1)).toMatchObject({ id: "second" });
    job.respond("second", "approve");
    expect(replies(child).map((reply) => reply.id)).toEqual(["first", "second"]);
    child.finish(); await job.done;
  });
  test("denied action cannot later be reported as completed", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.ask("deny-me"); await wait();
    job.respond("deny-me", "deny"); child.finish(); await job.done;
    expect(replies(child)[0]).toEqual({ id: "deny-me", result: { decision: "decline" } });
    expect(doneEvents(events)).toHaveLength(0); expect(errorEvents(events)).toHaveLength(1);
  });
  test("turn cannot complete with an unanswered approval", async () => {
    const { child, events, job } = setup(); child.onTurn = () => { child.ask("unanswered"); child.finish(); }; await job.done;
    expect(replies(child)).toHaveLength(0); expect(doneEvents(events)).toHaveLength(0); expect(errorEvents(events)).toHaveLength(1);
  });
  test("permission grants are scoped to the current turn", async () => {
    const { child, job } = setup(); child.onTurn = () => child.ask("permissions", "item/permissions/requestApproval", { permissions: { fileSystem: { write: ["/tmp/task"] } } }); await wait();
    job.respond("permissions", "approve");
    expect(replies(child)[0]).toEqual({ id: "permissions", result: { permissions: { fileSystem: { write: ["/tmp/task"] } }, scope: "turn" } });
    child.finish(); await job.done;
  });
  test("questions require answers to every requested key and transmit the expected wire shape", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.ask("question", "item/tool/requestUserInput", { questions: [{ id: "day", question: "Which day?", options: [{ label: "Thursday" }] }, { id: "place", question: "Where?" }] }); await wait();
    expect(events.find((event) => event.type === "input")).toMatchObject({ kind: "question", questions: [{ id: "day", question: "Which day?", options: ["Thursday"] }, { id: "place", question: "Where?" }] });
    expect(() => job.respond("question", "approve", { day: "Thursday" })).toThrow(); expect(replies(child)).toHaveLength(0);
    job.respond("question", "approve", { day: "Thursday", place: "Office" });
    expect(replies(child)[0].result).toEqual({ answers: { day: { answers: ["Thursday"] }, place: { answers: ["Office"] } } });
    child.finish(); await job.done;
  });
  test("declining a question stops the task without inventing a tool answer", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.ask("question", "item/tool/requestUserInput", { questions: [{ id: "send", question: "Send this message?", options: [{ label: "Yes" }, { label: "No" }] }] }); await wait();
    job.respond("question", "deny"); child.finish(); await job.done;
    expect(replies(child)).toHaveLength(0); expect(doneEvents(events)).toHaveLength(0); expect(errorEvents(events)).toHaveLength(1);
  });
  test("question enums are enforced unless the native request allows a freeform answer", async () => {
    const first = setup(); first.child.onTurn = () => first.child.ask("day", "item/tool/requestUserInput", { questions: [{ id: "day", question: "Which day?", options: [{ label: "Thursday" }] }] }); await wait();
    expect(() => first.job.respond("day", "approve", { day: "Friday" })).toThrow(); expect(replies(first.child)).toHaveLength(0);
    first.job.cancel(); await first.job.done;
    const second = setup(); second.child.onTurn = () => second.child.ask("day", "item/tool/requestUserInput", { questions: [{ id: "day", question: "Which day?", isOther: true, options: [{ label: "Thursday" }] }] }); await wait();
    second.job.respond("day", "approve", { day: "Friday" }); expect(replies(second.child)[0].result.answers.day.answers).toEqual(["Friday"]);
    second.child.finish(); await second.job.done;
  });
  test("secret questions and provider sign-in forms fail without exposing inputs", async () => {
    const first = setup(); first.child.onTurn = () => first.child.ask("secret", "item/tool/requestUserInput", { questions: [{ id: "key", question: "Secret value", isSecret: true }] });
    await first.job.done; expect(errorEvents(first.events)).toHaveLength(1); expect(first.events.some((event) => event.type === "input")).toBe(false);
    const second = setup(); second.child.onTurn = () => second.child.ask("oauth", "mcpServer/elicitation/request", { mode: "url", url: "https://provider.test/secret-token" });
    await second.job.done; expect(errorEvents(second.events)).toHaveLength(1); expect(JSON.stringify(second.events)).not.toContain("secret-token");
  });
  test("MCP elicitation exposes supported fields and validates enum answers", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.ask("form", "mcpServer/elicitation/request", { serverName: "calendar", mode: "form", message: "Confirm details", requestedSchema: { properties: { day: { type: "string", enum: ["Thursday", "Friday"] }, visible: { type: "boolean" } } } }); await wait();
    expect(events.find((event) => event.type === "input")).toMatchObject({ kind: "question" });
    expect(() => job.respond("form", "approve", { day: "Saturday", visible: "Yes" })).toThrow();
    expect(replies(child)).toHaveLength(0);
    expect(() => job.respond("form", "approve", { day: "Thursday", visible: "Maybe" })).toThrow();
    expect(replies(child)).toHaveLength(0);
    job.respond("form", "approve", { day: "Thursday", visible: "No" });
    expect(replies(child)[0].result).toEqual({ action: "accept", content: { day: "Thursday", visible: false } });
    child.finish(); await job.done;
  });
  test("resolved native requests remove stale approval controls", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.ask("resolved"); await wait();
    child.notify("serverRequest/resolved", { requestId: "resolved" });
    expect(() => job.respond("resolved", "approve")).toThrow(); expect(replies(child)).toHaveLength(0);
    expect(events).toContainEqual({ type: "input_resolved", id: "resolved" }); child.finish(); await job.done;
  });
  test("requests for another task and unsupported requests fail closed", async () => {
    const first = setup(); first.child.onTurn = () => first.child.ask("other", "item/commandExecution/requestApproval", { threadId: "another-thread" });
    await first.job.done; expect(errorEvents(first.events)[0]).toMatchObject({ message: expect.stringContaining("another task") });
    const second = setup(); second.child.onTurn = () => second.child.ask("unsupported", "executeUnknown");
    await second.job.done; expect(errorEvents(second.events)).toHaveLength(1);
    expect(replies(second.child)[0].error.code).toBe(-32601);
  });
  test("other thread notifications never alter the current result", async () => {
    const { child, events, job } = setup(); child.onTurn = () => { child.notify("item/agentMessage/delta", { threadId: "another-thread", delta: "Wrong conversation" }); child.finish(); }; await job.done;
    expect(JSON.stringify(events)).not.toContain("Wrong conversation"); expect(doneEvents(events)).toHaveLength(1);
  });
  test("abort interrupts the active turn, kills the process and emits one terminal event", async () => {
    const { child, controller, events, job } = setup(); await wait(); controller.abort(); job.cancel(); child.finish(); await job.done;
    expect(child.sent.some((message) => message.method === "turn/interrupt" && message.params.threadId === "thread-123")).toBe(true);
    expect(child.stopped).toContain("SIGTERM"); expect(errorEvents(events)).toHaveLength(1); expect(doneEvents(events)).toHaveLength(0);
  });
  test("late notifications from another turn cannot replace text, resolve input or finish this task", async () => {
    const { child, events, job } = setup(); await wait();
    child.ask("current");
    child.notify("turn/started", { turnId: "old-turn", turn: { id: "old-turn" } });
    child.notify("item/agentMessage/delta", { turnId: "old-turn", delta: "Stale answer" });
    child.notify("serverRequest/resolved", { turnId: "old-turn", requestId: "current" });
    child.notify("turn/completed", { turnId: "old-turn", turn: { id: "old-turn", status: "completed" } });
    child.notify("error", { turnId: "old-turn", willRetry: false });
    expect(JSON.stringify(events)).not.toContain("Stale answer");
    expect(events.filter((event) => event.type === "input_resolved")).toHaveLength(0);
    expect(doneEvents(events)).toHaveLength(0);
    expect(errorEvents(events)).toHaveLength(0);
    job.respond("current", "approve");
    child.finish(); await job.done;
    expect(doneEvents(events)).toHaveLength(1);
  });
  test("approval requests from another turn cannot be authorized", async () => {
    const { child, events, job } = setup(); await wait();
    child.ask("stale", "item/commandExecution/requestApproval", { turnId: "old-turn" });
    expect(events.some((event) => event.type === "input")).toBe(false);
    job.cancel(); await job.done;
    expect(replies(child)).toHaveLength(0);
    expect(errorEvents(events)[0]).toMatchObject({ message: expect.stringContaining("another turn") });
  });
  test("answered requests are not offered again when the native server repeats them", async () => {
    const { child, events, job } = setup(); await wait();
    child.ask("once"); job.respond("once", "approve"); child.ask("once");
    const offered = events.filter((event) => event.type === "input");
    child.finish(); await job.done;
    expect(offered).toHaveLength(1);
    expect(replies(child)).toHaveLength(1);
    expect(doneEvents(events)).toHaveLength(1);
  });
  test("cancellation reports promptly but releases the process only after close", async () => {
    const { child, events, job } = setup({}, { configure: (child) => {
      child.kill = (signal: string) => { child.stopped.push(signal); return true; };
    } });
    await wait();
    let exited = false;
    void job.done.then(() => { exited = true; });
    job.cancel(); await wait();
    const exitedBeforeClose = exited;
    child.close(); await job.done;
    expect(exitedBeforeClose).toBe(false);
    expect(errorEvents(events)).toHaveLength(1);
  });
  test("an already aborted signal never launches a process", async () => {
    const controller = new AbortController(); controller.abort();
    const { child, events, job } = setup({ signal: controller.signal }); await job.done;
    expect(child.args).toHaveLength(0); expect(errorEvents(events)).toHaveLength(1);
  });
  test("RPC errors and early process exits fail without leaking stderr/provider data", async () => {
    const first = setup({}, { configure: (child) => { child.fail = "account/read"; } }); await first.job.done;
    expect(errorEvents(first.events)).toHaveLength(1); expect(JSON.stringify(first.events)).not.toContain("provider raw secret");
    const second = setup(); second.child.onTurn = () => { second.child.stderr.write("token=not-for-ui"); second.child.close(); }; await second.job.done;
    expect(doneEvents(second.events)).toHaveLength(0); expect(JSON.stringify(second.events)).not.toContain("not-for-ui");
  });
  test("native terminal errors fail while retryable errors remain active", async () => {
    const first = setup(); first.child.onTurn = () => { first.child.notify("error", { willRetry: true }); first.child.finish(); }; await first.job.done;
    expect(doneEvents(first.events)).toHaveLength(1);
    const second = setup(); second.child.onTurn = () => second.child.notify("error", { willRetry: false }); await second.job.done;
    expect(doneEvents(second.events)).toHaveLength(0); expect(errorEvents(second.events)).toHaveLength(1);
  });
  test("startup timeout and malformed stdout cannot hang the job", async () => {
    const first = setup({}, { timeoutMs: 20, configure: (child) => { child.stall = "initialize"; } }); await first.job.done;
    expect(errorEvents(first.events)[0]).toMatchObject({ message: expect.stringContaining("timed out") });
    const second = setup(); second.child.onTurn = () => second.child.stdout.write("not json\n"); await second.job.done;
    expect(errorEvents(second.events)[0]).toMatchObject({ message: expect.stringContaining("unreadable") });
  });
  test("UTF-8 output can span chunks without corrupting the answer", async () => {
    const { child, events, job } = setup(); child.onTurn = () => {
      const bytes = Buffer.from(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId: "thread-123", delta: "Ready 🐋" } }) + "\n");
      const split = bytes.indexOf(Buffer.from("🐋")) + 2;
      child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split)); child.finish();
    }; await job.done;
    expect(events).toContainEqual({ type: "text", text: "Ready 🐋", append: true });
  });
  test("oversized native output stops the task instead of storing an unbounded buffer", async () => {
    const { child, events, job } = setup(); child.onTurn = () => child.stdout.write("x".repeat(16 * 1024 * 1024 + 1));
    await job.done; expect(errorEvents(events)[0]).toMatchObject({ message: expect.stringContaining("limit") }); expect(doneEvents(events)).toHaveLength(0);
  });
  test("secret-looking answer text is redacted before display", () => {
    expect(safeAgentText("Key sk-abcdefghijklmnop and Bearer abcdefghij password=hidden")).toBe("Key [redacted] and Bearer [redacted] password=[redacted]");
    expect(safeAgentText('{"api_key":"hidden", "refresh_token":"also-hidden"}')).toBe('{"api_key":"[redacted]", "refresh_token":"[redacted]"}');
    expect(safeAgentText("\u001b[31mReady\u001b[0m")).toBe("Ready");
  });
});

test("on Windows a codex.cmd shim runs through cmd.exe with the TOML override re-quoted, hidden, and stops without POSIX signal names", async () => {
  const child = new FakeCodex();
  let file = "";
  const launch = ((binary: string, args: string[], options: any) => { file = binary; return child.launch(binary, args, options); }) as any;
  const controller = new AbortController();
  const events: AgentAdapterEvent[] = [];
  const job = startCodexJob({ cwd: "C:\\Users\\example\\agentic-os", prompt: "A harmless fixture task", signal: controller.signal, onEvent: (event) => events.push(event) }, {
    binary: "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd", launch, timeoutMs: 1000, platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });
  await wait();
  expect(file).toBe("C:\\Windows\\System32\\cmd.exe");
  expect(child.args).toEqual(["/d", "/s", "/c", '"C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd app-server --stdio -c "model_provider=\\"openai\\"""']);
  expect(child.options).toMatchObject({ cwd: "C:\\Users\\example\\agentic-os", windowsHide: true, windowsVerbatimArguments: true });
  expect(child.options.env.RUST_LOG).toBe("error");
  controller.abort();
  await job.done;
  expect(child.stopped.length).toBeGreaterThan(0);
  expect(child.stopped.every((signal) => signal === undefined)).toBe(true);
  expect(events.some((event) => event.type === "error")).toBe(true);
});
