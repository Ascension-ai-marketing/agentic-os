import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJevRouter, fixedIntent, resolveRouteModel, recordRoutedUsage, routedSavings } from "./jev-router";
import type { JevDecision } from "../src/lib/jev-types";
const roots: string[] = []; afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const root = () => { const r = mkdtempSync(join(tmpdir(), "jev-router-")); roots.push(r); return r; };
const catalog = { catalog: [{ provider: "claude-code", models: [{ name: "claude-opus-5" }, { name: "claude-sonnet-5" }, { name: "claude-haiku-4-5-20251001" }] }, { provider: "openai · via codex", models: [{ name: "gpt-5.6-luna" }, { name: "gpt-5.3-codex" }] }] };
const decision: JevDecision = { id: "fixture", at: new Date().toISOString(), surface: "router", purpose: "Pick", input: "synthetic", answers: {}, picked: "small-fast", escalated: false, ms: 10, costUsd: 0.00002 };
test("a conversation is routed once, including concurrent starts and a server restart", async () => {
  const r = root(); let calls = 0; const router = createJevRouter(r, async () => { calls++; return decision; });
  const [a, b] = await Promise.all([router.route("chat-1", "Explain a loop", catalog), router.route("chat-1", "Explain a loop", catalog)]);
  expect(a).toEqual(b); expect(calls).toBe(1); expect(a.model).toBe("gpt-5.6-luna");
  router.attachSession("chat-1", "session-1");
  const restarted = createJevRouter(r, async () => { throw new Error("must not reroute"); });
  expect((await restarted.route("chat-1", "Now do something complex", catalog)).model).toBe(a.model);
  expect(restarted.find("session-1")?.model).toBe(a.model);
});
test("existing conversations cannot opt into Auto midway", async () => {
  await expect(createJevRouter(root()).route("old-chat", "Continue", catalog, { model: "opus", provider: "claude" })).rejects.toThrow("new chat");
});
test("unavailable lanes and corrupt pins fail closed", async () => {
  expect(() => resolveRouteModel("codex", { catalog: [] })).toThrow();
  const r = root(); const router = createJevRouter(r, async () => decision); await router.route("chat", "hello", catalog);
  writeFileSync(join(r, ".operator-data/jev/chat-routes.json"), "broken"); expect(() => router.find("chat")).toThrow("unreadable");
});
test("no-AI only accepts the fixed list, never embedded instructions", async () => {
  expect(fixedIntent("Open the calendar")).toBe("open-calendar"); expect(fixedIntent("Open the calendar and send invitations")).toBeUndefined();
  const router = createJevRouter(root(), async () => ({ ...decision, picked: "tier-1-no-ai" }));
  await expect(router.route("chat", "Delete all files", catalog)).rejects.toThrow("fixed intent");
});
test("worker cost comparisons use matched tokens and catalog prices", async () => {
  const r = root(); const route = await createJevRouter(r, async () => decision).route("chat", "hello", catalog);
  recordRoutedUsage(r, route, 1000, 100, null); const totals = routedSavings(r);
  expect(totals.costEstimated).toBe(true); expect(totals.measuredTurns).toBe(1); expect(totals.workerCostUsd).toBeGreaterThan(0); expect(totals.savedUsd).toBeGreaterThan(0);
});
test("Jev picks a concrete model from what the catalog can run, judging the typed words", async () => {
  let asked: any;
  const live = { catalog: [...catalog.catalog, { provider: "claude-code", models: [{ name: "claude-fable-5-1[1m]" }] }, { provider: "openai · via codex", models: [{ name: "gpt-6-astra" }] }] };
  const router = createJevRouter(root(), async (req) => { asked = req; return { ...decision, picked: "fable" }; });
  const pin = await router.route("chat-m", "LONG PROMPT WITH CONTEXT", live, undefined, { request: "Design me a hero section", context: "saved goals" });
  expect(asked.state.request).toBe("Design me a hero section"); expect(asked.state.savedContext).toBe("saved goals");
  expect(Object.keys(asked.questions.model.criteria)).toEqual(["haiku", "sonnet", "opus", "fable", "codex", "luna"]);
  expect(pin).toMatchObject({ lane: "fable", model: "claude-fable-5-1", provider: "claude-code", label: "Fable 5.1" });
  expect(pin.decision.optionLabels).toMatchObject({ haiku: "Haiku 4.5", sonnet: "Sonnet 5", opus: "Opus 5", codex: "Codex", luna: "GPT-5.6 Luna" });
});
