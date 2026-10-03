import { expect, test } from "bun:test";
import { askHermes, cleanHermesReply, speechChunks, spokenText } from "../src/lib/eleven-hermes-voice";

/** A synthetic app server: /__token plus a /__hermes_chat event stream. */
function hermes(events: string, options: { status?: number } = {}) {
  const calls: { url: string; body?: any; headers?: any }[] = [];
  const fetcher = (async (input: any, init: any = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    if (url === "/__token") return Response.json({ token: "local-fixture-token" });
    return new Response(events, { status: options.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const event = (name: string, data: string) => `event: ${name}\ndata: ${data}\n\n`;

test("a Hermes turn returns the reply and the session to resume, using only local routes", async () => {
  const { calls, fetcher } = hermes(
    event("chunk", "Warning: Unknown toolset voice") +
      event("chunk", "You have two meetings today.") +
      event("info", "session_id: 20261003_fixture") +
      event("done", "ok"),
  );
  const answer = await askHermes("What is on today?", { sessionId: "earlier_session", fetch: fetcher });
  expect(answer).toEqual({ text: "You have two meetings today.", sessionId: "20261003_fixture" });
  expect(calls.map((call) => call.url)).toEqual(["/__token", "/__hermes_chat"]);
  expect(calls[1].body).toEqual({ prompt: "What is on today?", sessionId: "earlier_session" });
  expect(calls[1].headers["X-Claude-OS-Token"]).toBe("local-fixture-token");
});

test("a missing or failing Hermes is reported as Hermes, not answered by another model", async () => {
  const missing = hermes(event("error", "Hermes binary not found on PATH."));
  await expect(askHermes("Hello", { fetch: missing.fetcher })).rejects.toThrow("Hermes is not installed");
  expect(missing.calls.map((call) => call.url)).toEqual(["/__token", "/__hermes_chat"]);
  await expect(
    askHermes("Hello", { fetch: hermes(event("error", "hermes exited with code 1")).fetcher }),
  ).rejects.toThrow("Hermes could not answer: hermes exited with code 1");
  await expect(askHermes("Hello", { fetch: hermes(event("done", "ok")).fetcher })).rejects.toThrow(
    "Hermes returned no answer",
  );
  await expect(askHermes("Hello", { fetch: hermes("", { status: 403 }).fetcher })).rejects.toThrow(
    "did not accept the request",
  );
});

test("an interrupted Hermes turn rejects as an abort", async () => {
  const controller = new AbortController();
  const fetcher = (async (input: any, init: any = {}) => {
    if (String(input) === "/__token") return Response.json({ token: "t" });
    controller.abort();
    init.signal.throwIfAborted();
    return new Response("");
  }) as unknown as typeof fetch;
  const error = await askHermes("Hello", { fetch: fetcher, signal: controller.signal }).catch((e) => e);
  expect(error.name).toBe("AbortError");
});

test("spoken text drops markdown, code and links and caps long replies at a sentence", () => {
  expect(spokenText("## Plan\n- **Call** [Sam](https://example.com) at `9am`\n```js\ncode()\n```")).toBe(
    "Plan Call Sam at 9am",
  );
  const long = spokenText(`${"This is a sentence. ".repeat(80)}`, 200);
  expect(long.length).toBeLessThan(260);
  expect(long.endsWith("The rest is on screen.")).toBe(true);
  expect(cleanHermesReply("Warning: No config found\nHello\n")).toBe("Hello");
});

test("speech is split into sentence-sized requests", () => {
  expect(speechChunks("One. Two? Three!", 8)).toEqual(["One.", "Two?", "Three!"]);
  expect(speechChunks("Short reply")).toEqual(["Short reply"]);
  expect(speechChunks("")).toEqual([]);
});
