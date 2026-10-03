import { expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicReply, claudeProblem, toMessages } from "./ceo-brain";
import { brainTools } from "./ceo-tools";

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
