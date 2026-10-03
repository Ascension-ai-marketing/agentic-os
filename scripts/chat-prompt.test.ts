import { expect, test } from "bun:test";
import {
  fitChatPrompt,
  chatHttpError,
  CHAT_PROMPT_BYTES,
  assembleChatPrompt,
} from "../src/lib/chat-prompt";
test("long contextual turns preserve instructions and user request inside the CLI byte budget", () => {
  const original =
    "SYSTEM: use only evidence\n" +
    "👩‍💻 Context ".repeat(18000) +
    "\nUSER REQUEST:\nFind my original invoice.";
  const fitted = fitChatPrompt(original);
  expect(new TextEncoder().encode(fitted).length).toBeLessThanOrEqual(CHAT_PROMPT_BYTES);
  expect(fitted).toStartWith("SYSTEM: use only evidence");
  expect(fitted).toEndWith("Find my original invoice.");
  expect(fitted).toContain("Earlier context shortened");
  expect(fitted).not.toContain("�");
  expect(fitChatPrompt("Hello")).toBe("Hello");
});
test("HTTP failures expose bounded actionable JSON errors without dumping HTML", async () => {
  expect(
    (await chatHttpError(Response.json({ error: "Connect this model first." }, { status: 400 })))
      .message,
  ).toBe("Connect this model first.");
  expect(
    (await chatHttpError(new Response("<html>internal server page</html>", { status: 502 })))
      .message,
  ).toContain("HTTP 502");
  expect(
    (await chatHttpError(Response.json({ error: "x".repeat(2000) }, { status: 400 }))).message
      .length,
  ).toBe(240);
});

test("structured context preserves every source heading and the entire latest request", () => {
  const request = "Keep the opening request. " + "request ".repeat(6000) + " Keep its ending.";
  const prompt = assembleChatPrompt(
    "SYSTEM: use only evidence",
    [
      { title: "BUSINESS", text: "business ".repeat(20000) },
      { title: "MEMORY", text: "👩‍💻 ".repeat(20000) },
      { title: "ATTACHMENTS", text: "document ".repeat(20000) },
      { title: "HISTORY", text: "old ".repeat(20000) + "MOST RECENT TURN", keepLatest: true },
      { title: "PROFILE", text: "Small profile stays whole." },
    ],
    request,
  );
  expect(new TextEncoder().encode(prompt).length).toBeLessThanOrEqual(CHAT_PROMPT_BYTES);
  for (const label of ["BUSINESS", "MEMORY", "ATTACHMENTS", "HISTORY", "PROFILE"])
    expect(prompt).toContain(label + ":");
  expect(prompt).toEndWith("USER REQUEST:\n" + request);
  expect(prompt).toContain("MOST RECENT TURN");
  expect(prompt).toContain("Small profile stays whole.");
  expect(prompt).not.toContain("�");
  expect(() =>
    assembleChatPrompt(
      "SYSTEM",
      [{ title: "MEMORY", text: "evidence" }],
      "a".repeat(CHAT_PROMPT_BYTES),
    ),
  ).toThrow("too long");
});
test("JSON error bodies without content type stay actionable", async () => {
  expect(
    (
      await chatHttpError(
        new Response(JSON.stringify({ error: "Message exceeds 100 KB." }), { status: 400 }),
      )
    ).message,
  ).toBe("Message exceeds 100 KB.");
});
