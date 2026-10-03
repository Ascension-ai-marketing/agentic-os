import { expect, test } from "bun:test";
import { sessionIdFrom } from "../src/lib/hermes-chat";
import { chatSseEvent } from "./chat-request";
import { readChatStream } from "../src/lib/chat-stream";

test("the Hermes session id is read from Hermes' end-of-run line", () => {
  expect(sessionIdFrom("session_id: 20260930_183143_5b1b01")).toBe("20260930_183143_5b1b01");
  expect(sessionIdFrom("Using tool: web_search")).toBeUndefined();
  expect(sessionIdFrom("session_id: ../../etc")).toBeUndefined();
});

test("a streamed Hermes reply keeps its text and hands the info lines to the caller", async () => {
  const sse = chatSseEvent("chunk", "Line one\nLine two") + chatSseEvent("info", "session_id: abc_123") + chatSseEvent("done", "ok");
  const body = new Response(sse).body!;
  const info: string[] = [];
  const text = await readChatStream(body, () => {}, undefined, (name, data) => { if (name === "info") info.push(data); });
  expect(text).toBe("Line one\nLine two");
  expect(info.map(sessionIdFrom)).toEqual(["abc_123"]);
});
