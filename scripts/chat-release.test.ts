import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { discoverCodexModels } from "./assistant-adapters";
import { claudeSignInStatus } from "./assistant-runtime";
import { chatRuntimeArgs } from "./chat-runtime";

function codexFixture(account: unknown, accountError = false) {
  const requests: any[] = [];
  let killed = false;
  const launch = (() => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
    };
    child.stdin = new Writable({
      write(bytes, _encoding, done) {
        const message = JSON.parse(String(bytes));
        requests.push(message);
        const result =
          message.id === 1
            ? {}
            : message.id === 2
              ? { account, requiresOpenaiAuth: true }
              : { data: [{ model: "test", displayName: "Test model" }] };
        if (message.id)
          queueMicrotask(() =>
            child.stdout.write(
              JSON.stringify(
                accountError && message.id === 2
                  ? { id: 2, error: { message: "unsupported" } }
                  : { id: message.id, result },
              ) + "\n",
            ),
          );
        done();
      },
    });
    return child;
  }) as any;
  return { launch, requests, stopped: () => killed };
}
test("Codex model discovery checks sign-in without refreshing tokens or returning account details", async () => {
  const fixture = codexFixture({
    type: "chatgpt",
    email: "synthetic@example.test",
    token: "synthetic-secret",
  });
  const discovery = await discoverCodexModels("/mock/codex", fixture.launch);
  expect(discovery.ready).toBe(true);
  expect(discovery.models[0].name).toBe("test");
  expect(fixture.requests.map((message) => message.method)).toEqual([
    "initialize",
    "initialized",
    "account/read",
    "model/list",
  ]);
  expect(fixture.requests.find((message) => message.method === "account/read").params).toEqual({
    refreshToken: false,
  });
  expect(JSON.stringify(discovery)).not.toContain("synthetic");
  expect(fixture.stopped()).toBe(true);
});
test("unsigned or unverifiable Codex never advertises models or starts a turn", async () => {
  for (const [account, error] of [
    [null, false],
    [{ type: "chatgpt" }, true],
    [{ type: "amazonBedrock" }, false],
  ] as const) {
    const fixture = codexFixture(account, error);
    expect((await discoverCodexModels("/mock/codex", fixture.launch)).ready).toBe(false);
    expect(
      fixture.requests.some(
        (message) => message.method === "model/list" || message.method === "turn/start",
      ),
    ).toBe(false);
    expect(fixture.stopped()).toBe(true);
  }
});
test("Claude sign-in discovery returns only bounded readiness, never auth identity or raw errors", async () => {
  const ready = await claudeSignInStatus("/mock/claude", async () => ({
    stdout: JSON.stringify({ loggedIn: true, email: "synthetic@example.test" }),
  }));
  expect(ready.ready).toBe(true);
  expect(JSON.stringify(ready)).not.toContain("synthetic");
  expect(
    (await claudeSignInStatus("/mock/claude", async () => ({ stdout: '{"loggedIn":false}' })))
      .ready,
  ).toBe(false);
  const failed = await claudeSignInStatus("/mock/claude", async () => {
    throw new Error("private failure");
  });
  expect(failed.ready).toBe(false);
  expect(JSON.stringify(failed)).not.toContain("private failure");
});
test("scoped text-chat arguments block native connector inheritance and unrendered approval tools", () => {
  const claude = chatRuntimeArgs("claude");
  expect(claude).toContain("--safe-mode");
  expect(claude[claude.indexOf("--tools") + 1]).toBe("");
  expect(claude[claude.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
  expect(claude).not.toContain("--permission-prompt-tool");
  const codex = chatRuntimeArgs("codex");
  expect(codex).toContain("--ignore-user-config");
  expect(codex).toContain("memories.use_memories=false");
  expect(codex).toContain("apps");
  expect(codex).not.toContain("--dangerously-bypass-approvals-and-sandbox");
});

test("a normal Claude signed-out exit is diagnosed precisely without exposing identity", async()=>{
 const result=await claudeSignInStatus("/mock/claude",async()=>{throw Object.assign(new Error("process failed"),{stdout:JSON.stringify({loggedIn:false,email:"PRIVATE"})});});
 expect(result.installed).toBe(true);expect(result.ready).toBe(false);
 expect(result.detail).toContain("signed out");expect(result.detail).toContain("local history");
 expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
