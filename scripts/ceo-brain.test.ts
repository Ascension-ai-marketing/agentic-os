import { afterEach, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicReply, claudeProblem, toMessages } from "./ceo-brain";
import type { HermesBoard, HermesCard } from "./ceo-hermes";
import { ceoStore } from "./ceo-store";
import { brainTools } from "./ceo-tools";
import { ceoReply, type Turn } from "./speech-engine";

const apiKey = "sk_unit_test_only_no_real_credentials";
const signal = () => new AbortController().signal;

// One model response as the server-sent events the Messages API streams.
const sse = (events: any[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const opened = { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "fixture-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } };
const text = (index: number, ...parts: string[]) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  ...parts.map((part) => ({ type: "content_block_delta", index, delta: { type: "text_delta", text: part } })),
  { type: "content_block_stop", index },
];
const toolUse = (index: number, id: string, name: string, json: string) => [
  { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
  { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } },
  { type: "content_block_stop", index },
];
const closed = (stop_reason: string) => [{ type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 7 } }, { type: "message_stop" }];
const response = (stop: string, ...blocks: any[][]) => sse([opened, ...blocks.flat(), ...closed(stop)]);

/** A fake Messages API: answers each request with the next canned stream and records what was sent. */
function model(...streams: string[]) {
  const sent: any[] = [];
  const fetcher = async (_: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(streams[sent.length - 1], { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { sent, fetcher };
}
async function spoken(stream: AsyncIterable<string>) {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

test("speaks text as it streams, caches the persona and keeps the scripted greeting out of the turns", async () => {
  const { sent, fetcher } = model(response("end_turn", text(0, "Good ", "evening.")));
  const reply = anthropicReply({ apiKey, model: "fixture-model", system: "persona", context: () => "It is Monday.", fetcher });
  const out = await spoken(reply([{ role: "agent", content: "Good evening, sir." }, { role: "user", content: "Hi" }], signal()));
  expect(out).toBe("Good evening.");
  const [request] = sent;
  expect(request.messages).toEqual([{ role: "user", content: "Hi" }]);
  expect(request.system[0]).toEqual({ type: "text", text: "persona", cache_control: { type: "ephemeral" } });
  expect(request.system[1].text).toContain("It is Monday.");
  expect(request.system[1].text).toContain("Good evening, sir.");
  expect(request.system[1].cache_control).toBeUndefined();
  expect(request.thinking).toEqual({ type: "adaptive" });
  expect(request.output_config).toEqual({ effort: "low" });
  expect(request.stream).toBe(true);
  expect(request.tools).toBeUndefined();
  expect(request.tool_choice).toBeUndefined();
});

test("drops empty and trailing agent turns, and stays silent with nothing from the user", async () => {
  const kept = toMessages([{ role: "agent", content: "Hello." }, { role: "user", content: "One" }, { role: "agent", content: " " }, { role: "agent", content: "Two" }, { role: "user", content: "Three" }, { role: "agent", content: "cut off" }]);
  expect(kept.opening).toBe("Hello.");
  expect(kept.messages).toEqual([{ role: "user", content: "One" }, { role: "assistant", content: "Two" }, { role: "user", content: "Three" }]);
  const { sent, fetcher } = model();
  expect(await spoken(anthropicReply({ apiKey, model: "fixture-model", system: "persona", fetcher })([{ role: "agent", content: "Hello." }], signal()))).toBe("");
  expect(sent).toHaveLength(0);
});

test("fills the silence, runs the lookup and answers from its result", async () => {
  const { sent, fetcher } = model(response("tool_use", toolUse(0, "toolu_1", "os_lookup", '{"name":"calendar"}')), response("end_turn", text(0, "You are free today.")));
  const calls: unknown[] = [];
  const reply = anthropicReply({
    apiKey, model: "fixture-model", system: "persona", fetcher, tools: brainTools().tools,
    runTool: async (name, input) => { calls.push([name, input]); return '{"events":[]}'; },
  });
  expect(await spoken(reply([{ role: "user", content: "What is on today?" }], signal()))).toBe("One moment, sir. You are free today.");
  expect(calls).toEqual([["os_lookup", { name: "calendar" }]]);
  expect(sent).toHaveLength(2);
  // Same system and tools both rounds; the first reply goes back unchanged with its result after it.
  expect(sent[1].system).toEqual(sent[0].system);
  expect(sent[1].tools).toEqual(sent[0].tools);
  expect(sent[1].messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(sent[1].messages[1].content[0]).toMatchObject({ type: "tool_use", id: "toolu_1", name: "os_lookup", input: { name: "calendar" } });
  expect(sent[1].messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", content: '{"events":[]}' }]);
});

test("says a few words before a lookup only once, and a failed tool goes back as an error", async () => {
  const { sent, fetcher } = model(response("tool_use", text(0, "Let me look."), toolUse(1, "toolu_1", "task_status", "{}")), response("end_turn", text(0, "The OS is not running.")));
  const reply = anthropicReply({ apiKey, model: "fixture-model", system: "persona", fetcher, tools: brainTools().tools, runTool: async () => { throw new Error("The dashboard is not running."); } });
  expect(await spoken(reply([{ role: "user", content: "What are my agents doing?" }], signal()))).toBe("Let me look. The OS is not running.");
  expect(sent[1].messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "The dashboard is not running." }]);
});

test("a refusal or a reply cut off mid tool call never runs the tool", async () => {
  for (const [stop, said] of [["refusal", "I can't help with that one, sir."], ["max_tokens", "One moment, sir. I couldn't finish that one, sir. Try me again."]]) {
    const { sent, fetcher } = model(response(stop, stop === "refusal" ? [] : toolUse(0, "toolu_1", "search_memory", '{"query":"pla')));
    let ran = 0;
    const reply = anthropicReply({ apiKey, model: "fixture-model", system: "persona", fetcher, tools: brainTools().tools, runTool: async () => { ran++; return "{}"; } });
    expect(await spoken(reply([{ role: "user", content: "Find my plan" }], signal()))).toBe(said);
    expect(ran).toBe(0);
    expect(sent).toHaveLength(1);
  }
});

test("stops asking after the last round instead of looping on lookups", async () => {
  const again = response("tool_use", toolUse(0, "toolu_1", "task_status", "{}"));
  const { sent, fetcher } = model(again, again);
  const reply = anthropicReply({ apiKey, model: "fixture-model", system: "persona", fetcher, maxRounds: 2, tools: brainTools().tools, runTool: async () => "{}" });
  expect(await spoken(reply([{ role: "user", content: "Status?" }], signal()))).toBe("One moment, sir. I couldn't finish that one, sir. Try me again.");
  expect(sent).toHaveLength(2);
});

test("talking over the reply cancels the request", async () => {
  const fetcher = async (_: RequestInfo | URL, init?: RequestInit) =>
    new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse([opened, ...text(0, "Good ").slice(0, 2)])));
        init!.signal!.addEventListener("abort", () => controller.error(new DOMException("The request was aborted.", "AbortError")));
      },
    }), { status: 200 });
  const interrupt = new AbortController();
  const stream = anthropicReply({ apiKey, model: "fixture-model", system: "persona", fetcher })([{ role: "user", content: "Hi" }], interrupt.signal)[Symbol.asyncIterator]();
  expect((await stream.next()).value).toBe("Good ");
  interrupt.abort();
  await expect(stream.next()).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
});

test("a key that cannot use the model is reported in the API's words, and a workspace ID travels as its header", async () => {
  const headers: (string | null)[] = [];
  const denied = async (_: RequestInfo | URL, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get("anthropic-workspace-id"));
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace." } }, { status: 400 });
  };
  expect(await claudeProblem({ apiKey, model: "fixture-model", fetcher: denied })).toBe("This API key is not scoped to a workspace.");
  const allowed = async (_: RequestInfo | URL, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get("anthropic-workspace-id"));
    return Response.json({ id: "fixture-model", type: "model", display_name: "Fixture", created_at: "2026-01-01T00:00:00Z" });
  };
  expect(await claudeProblem({ apiKey, model: "fixture-model", workspaceId: "wrkspc_fixture", fetcher: allowed })).toBe("");
  expect(headers).toEqual([null, "wrkspc_fixture"]);
});

test("an outage at start is not held against the key", async () => {
  const overloaded = async () => Response.json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, { status: 529 });
  expect(await claudeProblem({ apiKey, model: "fixture-model", fetcher: overloaded })).toBe("");
  const offline = async (): Promise<Response> => { throw new TypeError("fetch failed"); };
  expect(await claudeProblem({ apiKey, model: "fixture-model", fetcher: offline })).toBe("");
  const revoked = async () => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 });
  expect(await claudeProblem({ apiKey, model: "fixture-model", fetcher: revoked })).toBe("invalid x-api-key");
});

test("the saved greeting stands in when the transcript does not carry it", async () => {
  const { sent, fetcher } = model(response("end_turn", text(0, "Very good.")), response("end_turn", text(0, "Very good.")));
  const reply = anthropicReply({ apiKey, model: "fixture-model", system: "persona", greeting: "All systems are online, sir.", fetcher });
  await spoken(reply([{ role: "user", content: "Yes, proceed." }], signal()));
  expect(sent[0].system[1].text).toContain("All systems are online, sir.");
  expect(sent[0].messages).toEqual([{ role: "user", content: "Yes, proceed." }]);
  await spoken(reply([{ role: "agent", content: "What was actually said." }, { role: "user", content: "Yes, proceed." }], signal()));
  expect(sent[1].system[1].text).toContain("What was actually said.");
  expect(sent[1].system[1].text).not.toContain("All systems are online, sir.");
});

test("lookups go to the local OS route with its token, and only read", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const request = async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Response.json(url.endsWith("/__token") ? { token: "fixture-token-0123456789" } : { result: { events: [{ title: "Sample planning call" }] } });
  };
  const { tools, runTool } = brainTools({ baseUrl: "http://127.0.0.1:8081", request });
  expect(await runTool("os_lookup", { name: "calendar", date: "2026-01-31", days: 3, extra: "ignored" }, signal())).toContain("Sample planning call");
  expect(seen.map((s) => s.url)).toEqual(["http://127.0.0.1:8081/__token", "http://127.0.0.1:8081/__voice/tool"]);
  expect(seen[1].init?.method).toBe("POST");
  expect((seen[1].init?.headers as Record<string, string>)["x-claude-os-token"]).toBe("fixture-token-0123456789");
  expect(JSON.parse(String(seen[1].init?.body))).toEqual({ name: "calendar", args: { date: "2026-01-31", days: 3 } });
  await runTool("Task_Status", {}, signal());
  expect(JSON.parse(String(seen.at(-1)!.init?.body))).toEqual({ name: "agent_jobs", args: {} });
  await runTool("search_memory", { query: "  pricing notes  " }, signal());
  expect(JSON.parse(String(seen.at(-1)!.init?.body))).toEqual({ name: "search_memory", args: { query: "pricing notes" } });

  const before = seen.length;
  await expect(runTool("os_lookup", { name: "send_email" }, signal())).rejects.toThrow("name must be one of");
  await expect(runTool("os_lookup", { name: "web_search" }, signal())).rejects.toThrow("needs a query");
  await expect(runTool("os_lookup", { name: "calendar", date: "tomorrow" }, signal())).rejects.toThrow("date must look like");
  await expect(runTool("search_memory", "not an object", signal())).rejects.toThrow("needs a query");
  await expect(runTool("run_shell", { command: "ls" }, signal())).rejects.toThrow("no tool called run_shell");
  expect(seen).toHaveLength(before);

  // The voice can look and report. Approving, answering, cancelling, sending and running commands are not its tools.
  expect(tools.map((t) => t.name)).toEqual(["os_lookup", "search_memory", "task_status"]);
  for (const t of tools) {
    expect(t.name).not.toMatch(/approv|respond|confirm|cancel|send|publish|shell|bash|exec|write|delete/i);
    expect(t.eager_input_streaming).toBe(true);
    expect((t.input_schema as any).additionalProperties).toBe(false);
  }
  expect(() => brainTools({ baseUrl: "https://example.com" })).toThrow("local http address");
});

test("a stopped dashboard becomes a sentence the voice can say", async () => {
  const { runTool } = brainTools({ request: async () => { throw new TypeError("fetch failed"); } });
  await expect(runTool("os_lookup", { name: "inbox" }, signal())).rejects.toThrow("dashboard is not running");
  const refused = brainTools({ request: async (url) => (url.endsWith("/__token") ? Response.json({ token: "fixture-token-0123456789" }) : Response.json({ error: "Local workspace token required" }, { status: 403 })) });
  await expect(refused.runTool("os_lookup", { name: "inbox" }, signal())).rejects.toThrow("could not run the inbox lookup");
});

// The whole voice CEO: Claude (canned), the tools, the records and the yes-gate, in a temporary folder.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const user = (content: string): Turn => ({ role: "user", content });
const agent = (content: string): Turn => ({ role: "agent", content });
const ACTION = "Email Dana Lee the March invoice";
const QUESTION = "To confirm, sir: Email Dana Lee the March invoice. Yes or no?";
const proposes = response("tool_use", toolUse(0, "toolu_1", "propose_external_action", JSON.stringify({ action: ACTION, detail: "Hello Dana, the March invoice is attached." })));
const says = (words: string) => response("end_turn", text(0, words));

function ceo(fetcher: Parameters<typeof ceoReply>[0]["fetcher"]) {
  const root = mkdtempSync(join(tmpdir(), "ceo-reply-"));
  roots.push(root);
  const cards: HermesCard[] = [], tasks: string[] = [], logged: string[] = [];
  const board: HermesBoard = {
    workerProblem: () => "",
    async dispatch(input) { tasks.push(input.task); cards.push({ id: `t_${cards.length + 1}`, title: input.title, status: "queued" }); return cards.at(-1)!; },
    async cards() { return cards; },
    async show(id) { return cards.find((card) => card.id === id)!; },
  };
  // No dashboard: nothing here may need it.
  const request = async (): Promise<Response> => { throw new TypeError("fetch failed"); };
  const reply = ceoReply({ root, apiKey, model: "fixture-model", fetcher, os: { request }, board, log: (line) => logged.push(line) });
  return { root, store: ceoStore(root), tasks, logged, say: (transcript: Turn[], conversation = "conv-1", interrupt = signal()) => spoken(reply(transcript, interrupt, conversation)) };
}
const asks = [agent("Good evening, sir."), user("Email Dana the March invoice.")];

test("an outside action is read back by code, and only the person's own yes approves it", async () => {
  const { sent, fetcher } = model(proposes, says("Filed, sir."), says("Approved and waiting in the OS, sir."), says("As I said, sir."));
  const { store, say, logged } = ceo(fetcher);
  const first = await say(asks);
  expect(first).toBe(`One moment, sir. Filed, sir. ${QUESTION}`);
  expect(sent[0].tools.map((t: any) => t.name)).toEqual(["os_lookup", "search_memory", "task_status", "dispatch_agent", "propose_external_action", "list_pending"]);
  expect(sent[0].system[0].text).toContain("File it with propose_external_action");
  expect(sent[0].system[0].text).not.toContain("You cannot yet send");
  expect(sent[0].system[1].text).toContain("Nothing is waiting for the person's approval.\nNo work is handed out.");
  expect(sent[1].messages[2].content[0].content).toContain(`they will hear, word for word: "${QUESTION}"`);
  expect(store.approvals()).toMatchObject([{ action: ACTION, status: "pending", conversationId: "conv-1" }]);

  const answered = [...asks, agent(first), user("Yes.")];
  expect(await say(answered)).toBe("Approved and waiting in the OS, sir.");
  expect(store.approvals()).toMatchObject([{ action: ACTION, status: "approved", by: "voice" }]);
  expect(sent[2].system[1].text).toContain(`The person has just said yes to: "${ACTION}". It is approved and recorded.`);
  expect(sent[2].system[1].text).toContain("never say it was sent or done");
  expect(sent[2].system[1].text).toContain("Nothing is waiting for the person's approval.");
  expect(sent[2].system[0]).toEqual(sent[0].system[0]);
  expect(logged).toContain(`approval approved: ${ACTION}`);

  // The same turn delivered again changes nothing and asks nothing.
  expect(await say(answered)).toBe("As I said, sir.");
  expect(store.approvals()).toMatchObject([{ status: "approved", by: "voice" }]);
  expect(sent[3].system[1].text).toContain("The person has just said yes to");
});

test("a no declines, and a yes in another conversation or after another action answers nothing", async () => {
  const { sent, fetcher } = model(proposes, says("Filed, sir."), says("Very good."), says("Left alone, sir."));
  const { store, say } = ceo(fetcher);
  const first = await say(asks);
  // Someone else's conversation hears nothing of it.
  expect(await say([agent(first), user("Yes.")], "conv-2")).toBe("Very good.");
  expect(sent[2].system[1].text).not.toContain("has just said");
  expect(store.approvals()).toMatchObject([{ status: "pending" }]);

  expect(await say([...asks, agent(first), user("No, leave it.")])).toBe("Left alone, sir.");
  expect(store.approvals()).toMatchObject([{ status: "declined", by: "voice" }]);
  expect(sent[3].system[1].text).toContain(`The person has just said no to: "${ACTION}". It is declined`);
});

test("a yes cannot approve an action the person did not hear; asked again and heard, it can", async () => {
  const { sent, fetcher } = model(proposes, says("Filed, sir."), proposes, says("Asking again, sir."), says("Approved and waiting, sir."));
  const { store, say, logged } = ceo(fetcher);
  await say(asks);
  // The person talked over the question: the record of what was spoken stops before the action.
  const cut = [...asks, agent("One moment, sir. Filed, sir. To confirm, sir: Email"), user("Yes.")];
  const again = await say(cut);
  expect(store.approvals()).toMatchObject([{ status: "pending" }]);
  expect(sent[2].system[1].text).toContain("did not count as a yes or a no");
  expect(sent[2].system[1].text).toContain(`Waiting for the person's yes (1): "${ACTION}"`);
  expect(logged).toContain(`approval still waiting, no plain yes or no: ${ACTION}`);
  expect(again).toBe(`One moment, sir. Asking again, sir. ${QUESTION}`);
  expect(store.approvals()).toHaveLength(1);

  expect(await say([...cut, agent(again), user("Yes, go ahead.")])).toBe("Approved and waiting, sir.");
  expect(store.approvals()).toMatchObject([{ status: "approved", by: "voice" }]);
});

test("talking over the reply leaves the action unasked, and the next yes approves nothing", async () => {
  const interrupt = new AbortController();
  let requests = 0;
  const later = model(says("Still waiting on that, sir."));
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    if (++requests === 1) return new Response(proposes, { status: 200, headers: { "content-type": "text/event-stream" } });
    if (requests === 2) { interrupt.abort(); throw new DOMException("The request was aborted.", "AbortError"); }
    return later.fetcher(url, init);
  };
  const { store, say } = ceo(fetcher);
  await expect(say(asks, "conv-1", interrupt.signal)).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
  expect(store.approvals()).toMatchObject([{ status: "pending" }]);

  expect(await say([...asks, agent("One moment, sir."), user("Yes.")])).toBe("Still waiting on that, sir.");
  expect(store.approvals()).toMatchObject([{ status: "pending" }]);
  expect(later.sent[0].system[1].text).not.toContain("has just said");
  expect(later.sent[0].system[1].text).toContain(`Waiting for the person's yes (1): "${ACTION}"`);
});

test("an action already decided by the button is not changed by a later spoken answer", async () => {
  const { sent, fetcher } = model(proposes, says("Filed, sir."), says("Already declined, sir."));
  const { store, say } = ceo(fetcher);
  const first = await say(asks);
  store.resolve(store.approvals()[0].id, "declined", "button");
  expect(await say([...asks, agent(first), user("Yes.")])).toBe("Already declined, sir.");
  expect(store.approvals()).toMatchObject([{ status: "declined", by: "button" }]);
  expect(sent[2].system[1].text).toContain(`"${ACTION}" had already been declined in the OS before the person answered aloud, and that stands.`);
});

test("work handed to an agent shows in the next reply's records and is not handed out twice", async () => {
  const hands = response("tool_use", toolUse(0, "toolu_1", "dispatch_agent", JSON.stringify({ agent: "hermes", title: "Competitor pricing", task: "List three competitors and their prices." })));
  const { sent, fetcher } = model(hands, says("Under way, sir."), says("Still queued, sir."), hands, says("Already under way, sir."));
  const { store, say, tasks } = ceo(fetcher);
  const researches = [user("Research competitor pricing.")];
  expect(await say(researches)).toBe("One moment, sir. Under way, sir.");
  expect(tasks).toEqual(["List three competitors and their prices."]);
  expect(store.tasks()).toMatchObject([{ agent: "hermes", title: "Competitor pricing", ref: "t_1", status: "queued" }]);

  await say([...researches, agent("One moment, sir. Under way, sir."), user("How is it going?")]);
  expect(sent[2].system[1].text).toContain(`Work you handed out: Hermes "Competitor pricing", queued (just now).`);

  await say(researches);
  expect(sent[4].messages[2].content[0].content).toContain("Already handed to Hermes");
  expect(tasks).toHaveLength(1);
  expect(store.tasks()).toHaveLength(1);
});

test("records that cannot be read do not silence the voice", async () => {
  const { sent, fetcher } = model(says("Good evening, sir."));
  const { root, say } = ceo(fetcher);
  mkdirSync(join(root, ".operator-data", "ceo"), { recursive: true });
  writeFileSync(join(root, ".operator-data", "ceo", "tasks.json"), "{ not json");
  expect(await say([user("Hello.")])).toBe("Good evening, sir.");
  expect(sent[0].system[1].text).toContain("The records of handed-out work and approvals could not be read just now.");
});
