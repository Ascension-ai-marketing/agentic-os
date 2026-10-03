import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLiveVoiceSession, openAIVoice } from "./openai-voice";

test("live voice drives the OS with fast tools and delegates only real work", () => {
  const s = buildLiveVoiceSession();
  const names = s.tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["open_page", "os_lookup", "show_in_memory", "open_current_record", "walkthrough", "get_recent_meetings", "agent_task_status", "delegate_task"]));
  expect(names).not.toContain("run_workflow");
  expect(s.audio.input.turn_detection).toMatchObject({ type: "server_vad", create_response: true, interrupt_response: true });
  expect(s.instructions).toContain("Never delegate a question, a lookup or navigation");
  const pages = (s.tools.find((t) => t.name === "open_page") as any).parameters.properties.page.enum;
  expect(pages).toEqual(expect.arrayContaining(["dashboard", "reels", "library", "settings"]));
  expect((s.tools.find((t) => t.name === "os_lookup") as any).parameters.properties.tool.enum).toEqual(expect.arrayContaining(["now", "calendar", "usage", "web_search"]));
});
test("a live session is requested with the live configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "live-")); mkdirSync(join(root, ".operator-data"));
  writeFileSync(join(root, ".operator-data/openai-voice.json"), JSON.stringify({ apiKey: "sk-" + "a".repeat(40) }));
  let session: any;
  const sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 AA:BB\r\n";
  const voice = openAIVoice(root, { envKey: () => "", fetch: (async (_u: string, init: any) => { session = JSON.parse(init.body.get("session")); return new Response(sdp); }) as any });
  await voice.session({ sdp, mode: "live" });
  expect(session.tools.some((t: any) => t.name === "open_page")).toBe(true);
  await voice.session({ sdp });
  expect(session.tools.some((t: any) => t.name === "open_page")).toBe(false);
  await expect(voice.session({ sdp, mode: "other" })).rejects.toThrow();
});
