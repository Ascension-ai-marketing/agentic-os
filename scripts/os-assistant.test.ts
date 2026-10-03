import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOsAssistant, osModelFor } from "./os-assistant";
import { instantAnswer } from "../src/lib/os-instant";

const fixed = new Date("2026-09-28T10:30:00");
test("date and time are answered instantly with no model", async () => {
  expect(instantAnswer("Hey there bro, what day is it?", fixed)).toBe("It's Monday 28 September 2026.");
  expect(instantAnswer("what time is it", fixed)).toBe("It's 10:30.");
  expect(instantAnswer("what's the date today and what time is it?", fixed)).toContain("10:30");
  expect(instantAnswer("what's on my calendar today?", fixed)).toBeNull();
  let calls = 0;
  const os = createOsAssistant({ root: mkdtempSync(join(tmpdir(), "os-")), key: () => "k", local: async () => ({}), now: () => fixed, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
  const r = await os.ask({ text: "what day is it" }, () => {});
  expect(r.text).toBe("It's Monday 28 September 2026."); expect(calls).toBe(0);
});
test("the chat's own model is used when OpenRouter serves it, Haiku otherwise", () => {
  expect(osModelFor("claude-sonnet-5")).toBe("anthropic/claude-sonnet-5");
  expect(osModelFor("claude-opus-5-5")).toBe("anthropic/claude-opus-5.5");
  expect(osModelFor("claude-haiku-4-5-20251001")).toBe("anthropic/claude-haiku-4.5");
  expect(osModelFor("gpt-6-astra")).toBe("openai/gpt-6-astra");
  expect(osModelFor("auto-jev")).toBe("anthropic/claude-haiku-4.5");
});
test("tools run over the OS: calendar from the workspace, pages as actions, chips for each tool", async () => {
  const root = mkdtempSync(join(tmpdir(), "os-")); mkdirSync(join(root, ".operator-data"));
  writeFileSync(join(root, ".operator-data/workspace.json"), JSON.stringify({ events: [{ title: "Team stand-up", start: "2026-09-28T11:00:00", end: "2026-09-28T11:30:00" }] }));
  const bodies: any[] = []; let round = 0;
  const os = createOsAssistant({ root, key: () => "k", local: async () => ({}), now: () => fixed, fetch: (async (_u, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    round++;
    if (round === 1) return Response.json({ choices: [{ message: { content: "", tool_calls: [{ id: "a", function: { name: "calendar", arguments: "{}" } }, { id: "b", function: { name: "open_page", arguments: '{"page":"calendar"}' } }] } }], usage: { cost: 0.0004 } });
    return Response.json({ choices: [{ message: { content: "You have Team stand-up at 11:00." } }], usage: { cost: 0.0003 } });
  }) as typeof fetch });
  const events: any[] = [];
  const r = await os.ask({ text: "what's on my calendar today?", chatModel: "claude-sonnet-5" }, (e) => events.push(e));
  expect(bodies[0].model).toBe("anthropic/claude-haiku-4.5");
  expect(bodies[0].messages[0].content).toContain("Team stand-up");
  expect(JSON.parse(bodies[1].messages.find((m: any) => m.tool_call_id === "a").content).events[0].title).toBe("Team stand-up");
  expect(events.filter((e) => e.type === "tool").map((e) => e.label)).toEqual(["Checked calendar", "Opened page"]);
  expect(r.actions).toEqual([{ type: "open", path: "/calendar", label: "Calendar" }]);
  expect(r.text).toBe("You have Team stand-up at 11:00.");
  expect(events.at(-1)).toMatchObject({ type: "done", costUsd: 0.0007 });
});
test("switched-off email and meetings never reach the model, not even in the prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "os-")); mkdirSync(join(root, ".operator-data"));
  writeFileSync(join(root, ".operator-data/workspace.json"), JSON.stringify({ brainSources: { email: false, meetings: false }, events: [{ title: "Secret board meeting", start: "2026-09-28T11:00:00" }], inbox: [{ from: "lawyer@example.test", subject: "Private settlement terms", status: "open" }] }));
  const bodies: any[] = []; let round = 0; let localCalls = 0;
  const os = createOsAssistant({ root, key: () => "k", local: async () => { localCalls++; return { items: [{ subject: "leak" }] }; }, now: () => fixed, fetch: (async (_u, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    round++;
    if (round === 1) return Response.json({ choices: [{ message: { content: "", tool_calls: [{ id: "a", function: { name: "search_email", arguments: '{"query":"settlement"}' } }, { id: "b", function: { name: "calendar", arguments: "{}" } }] } }] });
    return Response.json({ choices: [{ message: { content: "Email is switched off." } }] });
  }) as typeof fetch });
  await os.ask({ text: "tell me a joke" }, () => {});
  const all = JSON.stringify(bodies);
  expect(all).not.toContain("Secret board meeting");
  expect(all).not.toContain("Private settlement terms");
  expect(all).not.toContain("leak");
  expect(localCalls).toBe(0);
  expect(bodies[0].messages[0].content).toContain("switched off");
});
