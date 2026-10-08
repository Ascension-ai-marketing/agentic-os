import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ceoRoutes } from "./ceo-routes";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function routes(options: { fetcher?: typeof fetch; wakeKey?: () => string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ceo-routes-"));
  roots.push(root);
  return ceoRoutes({ root, jobs: () => [], ...options });
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

test("the token and the wake key answer only to POST, which the page's own token guards", async () => {
  const all = routes({ fetcher: answers({ token: "made-up-token" }), wakeKey: () => "made-up-key" });
  await expect(all.handle("/ceo/voice-token", "GET", undefined)).rejects.toThrow("Unknown CEO request");
  await expect(all.handle("/ceo/wake-key", "GET", undefined)).rejects.toThrow("Unknown CEO request");
  expect(await all.handle("/ceo/wake-key", "POST", {})).toEqual({ key: "made-up-key" });
  expect(await routes({ wakeKey: () => "" }).handle("/ceo/wake-key", "POST", {})).toEqual({ missing: true });
});
