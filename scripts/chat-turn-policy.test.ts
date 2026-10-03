import { expect, test } from "bun:test";
import { createChatTurnPolicy } from "./chat-turn-policy";
import { emptyOutcome } from "../src/lib/turn-watchdog";
import { readChatStream } from "../src/lib/chat-stream";
import { chatSseEvent } from "./chat-request";

const success = () => ({
  ...emptyOutcome(),
  reachedResult: true,
  sawAssistantText: true,
});
const stream = (events: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(events));
      controller.close();
    },
  });

test("Claude OAuth assistant error followed by READY produces only a reconnect error", async () => {
  const policy = createChatTurnPolicy(true, "sub");
  expect(policy.claimAttempt()).toBe(true);
  let wire = "";
  for (const text of [
    "Failed to authenticate: OAuth session expired and could not be refreshed",
    "    at syntheticStackFrame",
    "READY\nSTREAM OK",
  ]) {
    if (policy.acceptAssistantText(text)) wire += chatSseEvent("chunk", text);
  }
  const result = policy.finish(success());
  wire += chatSseEvent(result.ok ? "done" : "error", result.ok ? "ok" : result.errorText);
  expect(result.ok).toBe(false);
  expect(result.errorText).toContain("Sign in to Claude Code again");
  expect(wire).not.toContain("event: chunk");
  expect(wire).not.toContain("READY");
  let text = "";
  await expect(
    readChatStream(stream(wire), (value) => {
      text = value;
    }),
  ).rejects.toThrow("Sign in to Claude Code again");
  expect(text).toBe("");
  expect(policy.canRecover).toBe(false);
  expect(policy.claimAttempt()).toBe(false);
});

test("supplied-context Chat admits one process regardless of retry reason or provider", () => {
  const policy = createChatTurnPolicy(true, "sub");
  const launches: string[] = [];
  for (const candidate of ["claude", "fresh-session", "without-flags", "codex-failover", "resume"])
    if (policy.claimAttempt()) launches.push(candidate);
  expect(launches).toEqual(["claude"]);
});

test("structured provider errors suppress unprefixed apology text and cannot become success", () => {
  for (const lane of ["sub", "codex", "ccr"] as const) {
    const policy = createChatTurnPolicy(true, lane);
    policy.recordFailure("authentication_failed synthetic-private-account");
    expect(policy.acceptAssistantText("Sorry, something went wrong.")).toBe(false);
    const result = policy.finish(success());
    expect(result.ok).toBe(false);
    expect(result.errorText).toMatch(/sign-in|authentication/);
    expect(result.errorText).not.toContain("synthetic-private-account");
    expect(result.errorText).toContain(
      lane === "sub" ? "Claude Code" : lane === "codex" ? "Codex" : "OpenRouter",
    );
  }
});

test("known CLI/provider error text is not a Chat answer", () => {
  for (const error of [
    "API Error: 401 unauthorized",
    "Error from provider: synthetic failure",
    "Error: synthetic failure",
    "Invalid API key",
    "Not logged in · Please run /login",
    "You've hit your limit",
    "There's an issue with the selected model (synthetic)",
  ]) {
    const policy = createChatTurnPolicy(true, "sub");
    expect(policy.acceptAssistantText(error)).toBe(false);
    expect(policy.finish(success()).ok).toBe(false);
  }
});

test("exit zero cannot turn failed, incomplete, interrupted or empty replies into done", () => {
  for (const patch of [
    { resultIsError: true },
    { harnessError: true },
    { reachedResult: false },
    { interrupted: true },
    { flatlined: true },
    { sawAssistantText: false },
    { ok: false },
  ]) {
    const policy = createChatTurnPolicy(true, "codex");
    expect(policy.finish({ ...success(), ...patch }).ok).toBe(false);
  }
});

test("a late error keeps prior answer text but ends the SSE stream as failed", async () => {
  const policy = createChatTurnPolicy(true, "codex");
  const partial = "First line\nSecond line";
  expect(policy.acceptAssistantText(partial)).toBe(true);
  policy.recordFailure("API Error: 429 rate limit exceeded");
  expect(policy.acceptAssistantText("Recovered automatically")).toBe(false);
  const result = policy.finish(success());
  let text = "";
  await expect(
    readChatStream(
      stream(chatSseEvent("chunk", partial) + chatSseEvent("error", result.errorText)),
      (value) => {
        text = value;
      },
    ),
  ).rejects.toThrow("Codex rejected");
  expect(text).toBe(partial);
});

test("successful multiline replies retain cumulative stream semantics", async () => {
  const policy = createChatTurnPolicy(true, "codex");
  let wire = "";
  for (const text of ["READY\n", "STREAM OK"])
    if (policy.acceptAssistantText(text)) wire += chatSseEvent("chunk", text);
  const result = success();
  expect(policy.finish(result)).toBe(result);
  wire += chatSseEvent("done", "ok");
  let text = "";
  const answer = await readChatStream(stream(wire), (value) => {
    text = value;
  });
  expect(answer).toBe("READY\nSTREAM OK");
  expect(text).toBe(answer);
});

test("explicit cancellation retains the existing stopped result", () => {
  const policy = createChatTurnPolicy(true, "sub");
  policy.recordFailure("Failed to authenticate");
  const stopped = { ...emptyOutcome(), reachedResult: true };
  expect(policy.finish(stopped, true)).toBe(stopped);
  expect(policy.canRecover).toBe(false);
});

test("native agent panes preserve recovery, error text and outcome identity", () => {
  const policy = createChatTurnPolicy(false, "sub");
  policy.recordFailure("Failed to authenticate");
  expect(policy.canRecover).toBe(true);
  expect(policy.claimAttempt()).toBe(true);
  expect(policy.claimAttempt()).toBe(true);
  expect(policy.acceptAssistantText("API Error: 401")).toBe(true);
  const native = { ...emptyOutcome(), resultIsError: true };
  expect(policy.finish(native)).toBe(native);
});

test("unsupported required flags give update guidance without exposing stderr", () => {
  const policy = createChatTurnPolicy(true, "codex");
  const result = policy.finish({
    ...emptyOutcome(),
    ok: false,
    stderr: "unexpected argument --ignore-user-config /synthetic/private/path",
  });
  expect(result.errorText).toContain("Update it");
  expect(result.errorText).not.toContain("/synthetic/private/path");
  expect(policy.canRecover).toBe(false);
});
