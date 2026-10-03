import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slackConnection } from "./slack-connection";
import { EMPTY_STATE } from "../src/lib/operator";
let root: string,
  state = structuredClone(EMPTY_STATE),
  slack: ReturnType<typeof slackConnection>;
const originalFetch = globalThis.fetch;
const config = { apiKey: "xoxb-test-only-123456789", channel: "C123456789" };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slack-test-"));
  state = structuredClone(EMPTY_STATE);
  slack = slackConnection(
    root,
    () => structuredClone(state),
    (s) => {
      state = s;
    },
    { homeDir: root },
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
});
function mock() {
  globalThis.fetch = (async (url: any, init: any) => {
    expect(String(url).startsWith("https://slack.com/api/")).toBe(true);
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    if (String(url).endsWith("auth.test"))
      return Response.json({ ok: true, team: "Test team", team_id: "T123" });
    expect(init.body.get("channel")).toBe(config.channel);
    return Response.json({
      ok: true,
      has_more: true,
      messages: [{ ts: "1789552800.001", user: "U123", text: "Review the customer proposal." }],
    });
  }) as typeof fetch;
}
test("Slack validates channel access before saving and never returns token in status", async () => {
  mock();
  await slack.handle("/connections/configure", config);
  expect(slack.status()).toMatchObject({
    connected: true,
    email: "Test team",
    channel: config.channel,
  });
  expect(JSON.stringify(slack.status())).not.toContain(config.apiKey);
  expect(statSync(join(root, ".operator-data/slack.json")).mode & 0o777).toBe(0o600);
  globalThis.fetch = (async () =>
    Response.json({ ok: false, error: "invalid_auth" })) as typeof fetch;
  await expect(
    slack.handle("/connections/configure", { ...config, apiKey: "xoxb-other-123456789" }),
  ).rejects.toThrow();
  expect(JSON.parse(readFileSync(join(root, ".operator-data/slack.json"), "utf8")).token).toBe(
    config.apiKey,
  );
});
test("Slack read-only refresh is bounded, deduplicates and preserves local work", async () => {
  mock();
  await slack.handle("/connections/configure", config);
  expect(await slack.handle("/connections/sync", {})).toMatchObject({ messages: 1, limited: true });
  Object.assign(state.inbox[0], {
    draft: "Draft",
    read: true,
    category: "waiting",
    status: "done",
  });
  await slack.handle("/connections/sync", {});
  expect(state.inbox).toHaveLength(1);
  expect(state.inbox[0]).toMatchObject({
    source: "slack",
    draft: "Draft",
    read: true,
    category: "waiting",
    status: "done",
  });
  await slack.handle("/connections/disconnect", {});
  expect(slack.status().connected).toBe(false);
  expect(state.inbox).toHaveLength(1);
});
test("Slack rate limits and missing scopes keep saved inbox untouched", async () => {
  mock();
  await slack.handle("/connections/configure", config);
  globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
  await expect(slack.handle("/connections/sync", {})).rejects.toThrow("limiting");
  expect(state.inbox).toHaveLength(0);
  globalThis.fetch = (async () =>
    Response.json({ ok: false, error: "missing_scope" })) as typeof fetch;
  await expect(slack.handle("/connections/sync", {})).rejects.toThrow("channels:history");
  expect(state.inbox).toHaveLength(0);
});
test("Slack serializes configuration and disconnect so a late authorization cannot reconnect", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith("auth.test")) {
      await pending;
      return Response.json({ ok: true, team: "Test", team_id: "T123" });
    }
    return Response.json({ ok: true, messages: [] });
  }) as typeof fetch;
  const configuring = slack.handle("/connections/configure", config);
  await expect(slack.handle("/connections/disconnect", {})).rejects.toThrow("Wait");
  finish();
  await configuring;
  await slack.handle("/connections/disconnect", {});
  expect(slack.status().connected).toBe(false);
});
