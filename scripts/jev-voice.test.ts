import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVoiceBackend } from "./jev-voice";
import { transcribeVoice } from "./voice-stt";
import type { JevDecision } from "../src/lib/jev-types";
const roots: string[] = []; afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const root = () => { const r = mkdtempSync(join(tmpdir(), "jev-voice-")); roots.push(r); mkdirSync(join(r, ".operator-data")); return r; };
const choice = (v: string) => ({ type: "choice" as const, choice: v, probabilities: { [v]: 1 }, confidence: 1 });
const decision = (tier = "tier-1", intent = "open-calendar", sure = 1): JevDecision => ({ id: "fixture", at: "", surface: "voice", purpose: "route", input: "", answers: { tier: { type: "choice", choice: tier, probabilities: { [tier]: sure }, confidence: sure }, intent: choice(intent), worker: choice("codex") }, picked: tier, escalated: false, costUsd: 0, ms: 4 });
test("tier 1 uses templates, validates the exact intent and never launches a worker", async () => {
  let jobs = 0; const voice = createVoiceBackend({ root: root(), decide: async () => decision(), context: async () => ({}), startJob: async () => { jobs++; return { job: { id: "fake" } }; } });
  expect((await voice.route("open the calendar")).navigateTo).toBe("/calendar");
  expect((await voice.route("open the calendar and delete everything")).tier).toBe("unavailable"); expect(jobs).toBe(0);
});
test("tier 2 sends bounded saved context to the cheapest worker", async () => {
  let sent: any; const voice = createVoiceBackend({ root: root(), decide: async () => decision("tier-2", "answer"), key: () => "test", context: async () => ({ brief: "Synthetic news" }), startJob: async () => { throw new Error("no job"); }, fetch: (async (_, init) => { sent = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: "Synthetic news." } }], usage: { cost: 0.0001 } }); }) as typeof fetch });
  expect((await voice.route("what is the news?")).replyText).toBe("Synthetic news."); expect(sent.messages[1].content).toContain("Synthetic news"); expect(sent.model).toBeTruthy();
});
test("tier 3 uses the existing jobs adapter and returns its id", async () => {
  let job: any; const voice = createVoiceBackend({ root: root(), decide: async () => decision("tier-3", "work"), context: async () => ({}), startJob: async body => { job = body; return { job: { id: "job-123" } }; } });
  expect((await voice.route("build a local sample app")).jobId).toBe("job-123"); expect(job.targets).toEqual(["codex"]); expect(job.prompt).toContain("Do not send messages");
});
test("voices only list an approved own clone and explicitly synthetic config voices", async () => {
  const r = root(); writeFileSync(join(r, ".operator-data/voice.json"), JSON.stringify({ voices: [{ id: "aaaaaaaaaaaaaaaa", name: "My voice", kind: "self" }, { id: "bbbbbbbbbbbbbbbb", name: "Studio synthetic", kind: "synthetic" }, { id: "cccccccccccccccc", name: "Celebrity", kind: "person" }] }));
  const calls: string[] = [];
  const voice = createVoiceBackend({ root: r, key: () => "fake", context: async () => ({}), startJob: async () => ({ job: { id: "" } }), fetch: (async (url) => { calls.push(String(url)); return String(url).includes("/model?") ? Response.json({ items: [{ _id: "aaaaaaaaaaaaaaaa", title: "My clone" }, { _id: "dddddddddddddddd", title: "Other real person" }] }) : new Response(new Uint8Array([1, 2, 3])); }) as typeof fetch });
  expect((await voice.voices()).voices.map(v => v.name)).toEqual(["My clone", "Jarvis", "Atlas", "Raven", "Sage", "Studio synthetic"]); expect((await voice.voices()).voices.some(v => v.name === "Other real person")).toBe(false); expect(calls[0]).toContain("self=true");
  expect((await voice.speak("Hello", "aaaaaaaaaaaaaaaa")).length).toBe(3);
  await expect(voice.speak("Hello", "dddddddddddddddd")).rejects.toThrow("listed voices"); expect(calls).toHaveLength(2);
});
test("shared STT requests real word timestamps", async () => {
  let form: FormData | undefined;
  const result = await transcribeVoice(new Uint8Array([1]), { key: "test", timings: true, fetch: (async (_, init) => { form = init?.body as FormData; return Response.json({ text: "Hi", words: [{ word: "Hi", start: 0, end: 0.5 }] }); }) as typeof fetch });
  expect(form?.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]); expect(result.words[0].end).toBe(0.5);
});
test("tier 3 below 80% asks first and starts nothing until confirmed", async () => {
  let jobs = 0; const start = async () => { jobs++; return { job: { id: "job-9" } }; };
  const unsure = createVoiceBackend({ root: root(), decide: async () => decision("tier-3", "work", 0.79), context: async () => ({}), startJob: start });
  const asked = await unsure.route("research the news trends");
  expect(asked.needsConfirm).toBe(true); expect(asked.jobId).toBeUndefined(); expect(jobs).toBe(0);
  expect((await unsure.route("research the news trends", { confirm: true })).jobId).toBe("job-9"); expect(jobs).toBe(1);
  const sure = createVoiceBackend({ root: root(), decide: async () => decision("tier-3", "work", 0.81), context: async () => ({}), startJob: start });
  expect((await sure.route("build a local sample app")).jobId).toBe("job-9"); expect(jobs).toBe(2);
});
test("force tier-2 answers quickly and never starts a job", async () => {
  let jobs = 0; const voice = createVoiceBackend({ root: root(), decide: async () => decision("tier-3", "work", 0.52), key: () => "test", context: async () => ({}), startJob: async () => { jobs++; return { job: { id: "x" } }; }, fetch: (async () => Response.json({ choices: [{ message: { content: "Quick." } }] })) as typeof fetch });
  const r = await voice.route("what is the news?", { force: "tier-2" });
  expect(r.tier).toBe("tier-2"); expect(r.replyText).toBe("Quick."); expect(jobs).toBe(0);
});
test("Fish speech-to-text is used when a Fish key is set", async () => {
  let url = ""; let form: FormData | undefined;
  const r = await transcribeVoice(new Uint8Array([1, 2]), { key: "", fishKey: "fish", contentType: "audio/webm", convert: async (a) => a, fetch: (async (u, init) => { url = String(u); form = init?.body as FormData; return Response.json({ text: " Open my brief ", duration: 1.2 }); }) as typeof fetch });
  expect(url).toBe("https://api.fish.audio/v1/asr"); expect(form?.get("ignore_timestamps")).toBe("true"); expect(r.text).toBe("Open my brief");
});
test("speech performs the tone and speed Fish supports, and ignores unknown tags", async () => {
  const bodies: any[] = [];
  const voice = createVoiceBackend({ root: root(), key: () => "fake", context: async () => ({}), startJob: async () => ({ job: { id: "" } }), fetch: (async (url, init) => { if (String(url).includes("/v1/tts")) bodies.push(JSON.parse(String(init?.body))); return String(url).includes("/model?") ? Response.json({ items: [] }) : new Response(new Uint8Array([1])); }) as typeof fetch });
  await voice.speak("Good morning.", "14129c3e320149449d6bada6862f7338", { tone: "calm", speed: 1.1 });
  await voice.speak("Hi.", "14129c3e320149449d6bada6862f7338", { tone: "(shouting) rm -rf", speed: 9 });
  expect(bodies[0].text).toBe("(calm) Good morning."); expect(bodies[0].prosody.speed).toBe(1.1);
  expect(bodies[1].text).toBe("Hi."); expect(bodies[1].prosody.speed).toBe(2);
});
test("with casting on, Jev's voice and tone come back with the reply", async () => {
  const d = decision("tier-1", "open-calendar"); d.answers.voice = { type: "choice", choice: "jarvis", probabilities: { jarvis: 0.9 }, confidence: 0.9 }; d.answers.tone = { type: "choice", choice: "calm", probabilities: { calm: 0.8 }, confidence: 0.8 };
  let asked: any; const voice = createVoiceBackend({ root: root(), decide: async (req) => { asked = req; return d; }, key: () => "", context: async () => ({}), startJob: async () => ({ job: { id: "" } }) });
  const r: any = await voice.route("open the calendar", { cast: true });
  expect(Object.keys(asked.questions)).toContain("voice"); expect(r.cast.voiceName).toBe("Jarvis"); expect(r.cast.tone).toBe("calm");
});
test("a question skips Jev and the chat model answers; unclear work lets Jev pick the answer model", async () => {
  let sent: any; let calls = 0;
  const d = decision("tier-2", "answer"); d.answers.model = choice("sonnet");
  const voice = createVoiceBackend({ root: root(), decide: async () => { calls++; return d; }, key: () => "test", context: async () => ({}), startJob: async () => { throw new Error("no job"); }, fetch: (async (_, init) => { sent = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: "Fine." } }] }); }) as typeof fetch });
  const r: any = await voice.route("what is on my calendar today?");
  expect(calls).toBe(0); expect(r.decision).toBeUndefined(); expect(r.gated).toBe(true);
  expect(sent.model).toBe("anthropic/claude-haiku-4.5"); expect(r.workerLabel).toBe("Haiku 4.5");
  const w: any = await voice.route("build me a quick summary page");
  expect(calls).toBe(1); expect(sent.model).toBe("anthropic/claude-sonnet-5"); expect(w.decision.optionLabels).toMatchObject({ haiku: "Haiku 4.5", opus: "Opus 5.5", sol: "GPT-6 Sol", "tier-3": "Agent" });
});
test("Jev can open any sidebar page, and only a known one", async () => {
  const d = decision("tier-1", "answer"); d.answers.page = choice("dashboard");
  const voice = createVoiceBackend({ root: root(), decide: async () => d, context: async () => ({}), startJob: async () => { throw new Error("no job"); } });
  const r: any = await voice.route("let's go check out my dashboard");
  expect(r.navigateTo).toBe("/business"); expect(r.replyText).toBe("Opening Dashboard."); expect(r.pageLabel).toBe("Dashboard");
  d.answers.page = choice("../etc");
  expect((await voice.route("go somewhere odd")).tier).toBe("unavailable");
});
test("work runs on the model Jev picked, and a follow-up continues the open task", async () => {
  let job: any, cont: any;
  const d = decision("tier-3", "work", 0.93); d.answers.codexModel = choice("sol");
  const voice = createVoiceBackend({ root: root(), decide: async () => d, context: async () => ({}), catalog: async () => [{ name: "gpt-5.6-sol", provider: "openai · via codex" }], startJob: async body => { job = body; return { job: { id: "job-1" } }; }, continueJob: async body => { cont = body; return { job: { id: "job-1" } }; } });
  const r: any = await voice.route("fix the failing build script");
  expect(job.targets).toEqual(["codex"]); expect(job.model).toBe("gpt-5.6-sol"); expect(r.agentModel.label).toBe("GPT-5.6 Sol");
  const c = decision("continue", "work", 0.9);
  const again = createVoiceBackend({ root: root(), decide: async () => { throw new Error("a follow-up needs no Jev call"); }, context: async () => ({}), startJob: async () => { throw new Error("must continue, not start"); }, continueJob: async body => { cont = body; return { job: { id: "job-1" } }; } });
  const f: any = await again.route("also make it blue", { activeTask: { jobId: "job-1", agent: "codex", prompt: "fix the failing build script" } });
  expect(cont).toEqual({ jobId: "job-1", agent: "codex", prompt: "also make it blue" }); expect(f.replyText).toBe("Continuing in Codex."); expect(f.continued).toBe(true);
});
test("a question about the past opens Memory focused on the source and words", async () => {
  const d = decision("memory", "answer"); d.answers.memorySource = choice("claude");
  const voice = createVoiceBackend({ root: root(), decide: async () => d, context: async () => ({}), startJob: async () => { throw new Error("no job"); } });
  const r: any = await voice.route("Hey Jev, when did I chat to Claude about pricing last month?");
  expect(r.navigateTo).toBe("/memory");
  expect(r.memoryFocus).toEqual({ source: "claude", query: "pricing", range: "30d", view: "timeline", open: true });
  expect(r.memoryLabel).toBe("Claude");
});
test("a signed-out agent is left out of Jev's options and never started", async () => {
  let asked: any; let jobs = 0;
  const d = decision("tier-3", "work", 0.95); d.answers.worker = { type: "choice", choice: "codex", probabilities: { codex: 1 }, confidence: 1 };
  const voice = createVoiceBackend({ root: root(), agentStatus: async () => ({ claude: false, codex: true }), decide: async (req) => { asked = req; return d; }, context: async () => ({}), startJob: async () => { jobs++; return { job: { id: "j" } }; } });
  const r: any = await voice.route("build me a landing page");
  expect(Object.keys(asked.questions.worker.criteria)).toEqual(["codex"]); expect(r.agent).toBe("codex"); expect(jobs).toBe(1);
  const out = createVoiceBackend({ root: root(), key: () => "", fetch: (async () => { throw new Error("no network in tests"); }) as typeof fetch, agentStatus: async () => ({ claude: false, codex: false }), decide: async () => ({ ...d, answers: { ...d.answers, worker: undefined as any } }), context: async () => ({}), startJob: async () => { jobs++; return { job: { id: "j" } }; } });
  const r2: any = await out.route("build me a landing page");
  expect(jobs).toBe(1); expect(r2.replyText).toContain("signed out");
});
test("a named agent is binding: Jev never switches it, and only picks the model within it", async () => {
  let jobs: any[] = [];
  // Jev leans to Claude (the Galileo case), but the user said Codex.
  const d = decision("tier-3", "work", 0.6); d.answers.worker = { type: "choice", choice: "claude", probabilities: { claude: 0.5, codex: 0.5 }, confidence: 0.5 };
  d.answers.codexModel = { type: "choice", choice: "sol", probabilities: { codex: 0.2, sol: 0.7, luna: 0.1 }, confidence: 0.7 };
  const make = () => createVoiceBackend({ root: root(), agentStatus: async () => ({ claude: false, codex: true }), catalog: async () => [{ name: "gpt-6-astra", provider: "openai · via codex" }, { name: "gpt-5.6-sol", provider: "openai · via codex" }], decide: async () => d, context: async () => ({}), startJob: async (b: any) => { jobs.push(b); return { job: { id: "j" } }; } });
  const r: any = await make().route("kick something off in Codex, do some research on Galileo", { confirm: true });
  expect(r.agent).toBe("codex"); expect(jobs[0].targets).toEqual(["codex"]); expect(jobs[0].model).toBe("gpt-5.6-sol");
  const t: any = await make().decideTask("do some research on Galileo", { agent: "codex", confirm: true });
  expect(t).toMatchObject({ lane: "codex", bound: true, agent: "codex" });
  expect(t.decision.optionLabels).toMatchObject({ codex: "GPT-6 Astra", sol: "GPT-5.6 Sol" });
  // A named model inside the agent is binding too.
  const m: any = await make().decideTask("use GPT-6 Astra in Codex to research Galileo", { confirm: true });
  expect(m.agentModel).toMatchObject({ key: "codex", model: "gpt-6-astra" });
  // Naming a signed-out agent never falls back to the other one.
  const c: any = await make().decideTask("have Claude Code research Galileo", { confirm: true });
  expect(c.lane).toBe("error"); expect(c.signInNeeded).toBe("claude");
});
