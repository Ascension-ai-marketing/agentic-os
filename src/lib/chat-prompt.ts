// Keep a contextual turn below the local CLI argument limit, including Unicode.
// The opening instructions and latest user request survive context trimming.
export const CHAT_PROMPT_BYTES = 96_000;
const encoder = new TextEncoder();
const excerptMarker =
  "\n[Excerpt shortened for this turn; ask for a narrower source if evidence is missing.]\n";
function excerpt(text: string, budget: number, tail = false): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= budget) return text;
  const room = Math.max(0, budget - encoder.encode(excerptMarker).length);
  const part = new TextDecoder()
    .decode(tail ? bytes.slice(bytes.length - room) : bytes.slice(0, room))
    .replace(tail ? /^\uFFFD+/ : /\uFFFD+$/, "");
  return tail ? excerptMarker + part : part + excerptMarker;
}

/** Bound evidence separately so neither instructions nor the user's request is cut. */
export function assembleChatPrompt(
  instructions: string,
  sections: Array<{ title: string; text: string; keepLatest?: boolean }>,
  request: string,
): string {
  const ending = `\n\nUSER REQUEST:\n${request}`;
  const headings = sections.map((section) => `\n\n${section.title}:\n`);
  const remaining =
    CHAT_PROMPT_BYTES - encoder.encode(instructions + headings.join("") + ending).length;
  const minimum = encoder.encode(excerptMarker).length;
  if (remaining < sections.length * minimum)
    throw new Error(
      "Your message is too long for one turn. Shorten the message or attach it as a document.",
    );
  // Small sections stay whole; larger sections share the remaining evidence budget.
  const sizes = sections.map((section) => encoder.encode(section.text).length);
  const budgets = sizes.map(() => 0);
  let available = remaining;
  const ordered = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);
  ordered.forEach(({ size, index }, position) => {
    budgets[index] = Math.min(size, Math.floor(available / (ordered.length - position)));
    available -= budgets[index];
  });
  return (
    instructions +
    sections
      .map(
        (section, index) =>
          headings[index] + excerpt(section.text, budgets[index], section.keepLatest),
      )
      .join("") +
    ending
  );
}

export function fitChatPrompt(prompt: string): string {
  const bytes = new TextEncoder().encode(prompt);
  if (bytes.length <= CHAT_PROMPT_BYTES) return prompt;
  const decoder = new TextDecoder();
  const marker =
    "\n\n[Earlier context shortened to fit this turn. Ask for a narrower source if evidence is missing.]\n\n";
  const head = decoder.decode(bytes.slice(0, 12_000)).replace(/\uFFFD$/, "");
  const tail = decoder
    .decode(
      bytes.slice(-(CHAT_PROMPT_BYTES - 12_000 - new TextEncoder().encode(marker).length - 8)),
    )
    .replace(/^\uFFFD+/, "");
  return head + marker + tail;
}

export async function chatHttpError(response: Response): Promise<Error> {
  let detail = "";
  // Local CLI routes also return JSON errors without a Content-Type header.
  const reader = response.body?.getReader();
  if (reader) {
    try {
      let raw = "";
      const decoder = new TextDecoder();
      while (raw.length <= 4096) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value.subarray(0, 4097), { stream: true });
      }
      const value = JSON.parse(raw);
      const message = typeof value.error === "string" ? value.error : value.error?.message;
      if (typeof message === "string") detail = message.replace(/[\r\n]+/g, " ").slice(0, 240);
    } catch {
      /* A proxy response can be empty or malformed. */
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return new Error(
    detail ||
      `The selected model could not accept this request (HTTP ${response.status}). Check its connection or choose another model.`,
  );
}
