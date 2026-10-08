import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefing, ceoRoutes } from "./ceo-routes";
import { ceoStore } from "./ceo-store";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const none = { importInto: () => 0 };
function routes(options: Partial<Parameters<typeof ceoRoutes>[0]> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ceo-routes-"));
  roots.push(root);
  return ceoRoutes({ root, jobs: () => [], checkIns: none, sync: { refresh: async () => {} }, ...options });
}
const answers = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("the call token and the greeting come from the voice brain on this computer", async () => {
  const asked: string[] = [];
  const fetcher = (async (url: string) => { asked.push(url); return new Response(JSON.stringify({ token: "made-up-token", firstMessage: "Good evening." })); }) as unknown as typeof fetch;
  expect(await routes({ fetcher }).handle("/ceo/voice-token", "POST", {})).toEqual({ token: "made-up-token", firstMessage: "Good evening." });
  expect(asked).toEqual(["http://127.0.0.1:3002/token"]);
  expect(await routes({ fetcher: answers({ token: "made-up-token", firstMessage: "  " }) }).handle("/ceo/voice-token", "POST", {})).toEqual({ token: "made-up-token" });
});

test("a brain that is down or refuses says so in plain words", async () => {
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await expect(routes({ fetcher: down }).handle("/ceo/voice-token", "POST", {})).rejects.toThrow("Jarvis's voice is not running");
  await expect(routes({ fetcher: answers({ error: "ElevenLabs did not issue a token." }, 502) }).handle("/ceo/voice-token", "POST", {})).rejects.toThrow("ElevenLabs did not issue a token.");
  await expect(routes({ fetcher: answers({}) }).handle("/ceo/voice-token", "POST", {})).rejects.toThrow("did not issue a call token");
});

test("the token answers only to POST, which the page's own token guards", async () => {
  await expect(routes({ fetcher: answers({ token: "made-up-token" }) }).handle("/ceo/voice-token", "GET", undefined)).rejects.toThrow("Unknown CEO request");
});

test("the page gets what the check-ins wrote, read in on the way", async () => {
  const root = mkdtempSync(join(tmpdir(), "ceo-routes-"));
  roots.push(root);
  const store = ceoStore(root);
  const checkIns = { importInto: (into: typeof store) => { into.addReport({ key: "job/1.md", kind: "plan", title: "Morning plan", text: "Finish the sample proposal.", at: "2026-10-03T08:00:00.000Z" }); return 1; } };
  const reply: any = await routes({ root, store, checkIns }).handle("/ceo", "GET", undefined);
  expect(reply.reports.map((item: any) => item.text)).toEqual(["Finish the sample proposal."]);
  const broken = { importInto: () => { throw new Error("unreadable"); } };
  expect(((await routes({ root, store, checkIns: broken }).handle("/ceo", "GET", undefined)) as any).reports).toHaveLength(1);
});

test("a check-in is given goals and the state of the work, and nothing when business is kept private", async () => {
  const root = mkdtempSync(join(tmpdir(), "ceo-routes-"));
  roots.push(root);
  const store = ceoStore(root);
  store.addTask({ key: "k1", agent: "hermes", title: "Sample research", task: "Summarise the sample report.", ref: "card-1" });
  store.propose({ action: "Send the sample invoice to the sample client" });
  const now = new Date("2026-10-03T12:00:00");
  const text = briefing({ longTerm: "Grow the sample studio", week: "Ship the sample page", quarter: " " }, store, now);
  expect(text).toStartWith("Today is Saturday 3 October 2026.");
  expect(text).toContain("- Long term: Grow the sample studio\n- This week: Ship the sample page\n");
  expect(text).not.toContain("This quarter");
  expect(text).toContain(`- hermes "Sample research": queued, updated`);
  expect(text).toContain(`- "Send the sample invoice to the sample client", asked`);
  expect(text).not.toContain("Summarise the sample report");
  const reply: any = await routes({ root, store, goals: () => null }).handle("/ceo/briefing", "GET", undefined);
  expect(reply.briefing).toContain("- None are written down in the OS.");
});

test("the OpenClaw page is told what is installed, and nothing more", async () => {
  const openclaw = () => ({ status: async () => ({ installed: true, version: "2026.9.9", gateway: "unknown" as const }) });
  expect(await routes({ openclaw }).handle("/ceo/openclaw", "GET", undefined)).toEqual({ openclaw: { installed: true, version: "2026.9.9", gateway: "unknown" } });
  await expect(routes({ openclaw }).handle("/ceo/openclaw", "POST", {})).rejects.toThrow("Unknown CEO request.");
});
