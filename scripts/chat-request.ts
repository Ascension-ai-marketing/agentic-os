export function validateChatPrompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Enter a message before sending.");
  const prompt = value.trim();
  if (Buffer.byteLength(prompt, "utf8") > 100_000)
    throw new Error(
      "This message and its context exceed the 100 KB limit. Shorten the message or use fewer sources.",
    );
  return prompt;
}

/** Opt-in framing keeps exact newlines; existing agent panes keep their protocol. */
export function chatSseEvent(event: string, data: string): string {
  return `event: ${event}\n${data
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n")}\n\n`;
}
