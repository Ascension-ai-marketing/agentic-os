/**
 * ceo-brain.ts
 *
 * The thinking half of the voice. Claude answers each spoken turn and may look
 * things up with small tools before it speaks. Text goes out as it is generated,
 * so ElevenLabs starts talking early; talking over it cancels the request.
 *
 * API contracts verified against the Anthropic TypeScript SDK (streaming manual tool loop).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Reply, Turn } from "./speech-engine";

/** The spoken turn being answered: which conversation, and everything said in it so far. */
export type SpokenTurn = { conversationId: string; transcript: Turn[] };
export type RunTool = (name: string, input: unknown, signal: AbortSignal, turn?: SpokenTurn) => Promise<string>;
type Fetch = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const FILLER = "One moment, sir.";
const REFUSED = "I can't help with that one, sir.";
const UNFINISHED = "I couldn't finish that one, sir. Try me again.";
const OPENING =
  "You opened this conversation with the person's scripted greeting, quoted below. " +
  "It is a set piece they wrote, not a report: check the real state with your tools before speaking about anything it mentions.\n\n";

/**
 * Speech Engine turns as Claude messages. The greeting spoken before the first
 * user turn is returned apart (a conversation must start with the user), and empty
 * turns, which an interrupted reply leaves behind, are dropped.
 */
export function toMessages(transcript: Turn[]) {
  const turns = transcript.filter((turn) => turn.content.trim());
  const roles = turns.map((turn) => turn.role);
  const first = roles.indexOf("user");
  if (first < 0) return { opening: "", messages: [] as Anthropic.MessageParam[] };
  return {
    opening: turns.slice(0, first).map((turn) => turn.content).join(" "),
    messages: turns.slice(first, roles.lastIndexOf("user") + 1).map((turn): Anthropic.MessageParam => ({ role: turn.role === "agent" ? "assistant" : "user", content: turn.content })),
  };
}

type Access = { apiKey: string; model: string; /** For a key that is not tied to one workspace. */ workspaceId?: string; fetcher?: Fetch };
const claude = (access: Access) =>
  new Anthropic({ apiKey: access.apiKey, fetch: access.fetcher, maxRetries: 1, timeout: 60_000, defaultHeaders: access.workspaceId ? { "anthropic-workspace-id": access.workspaceId } : undefined });

/**
 * Why the API turns this key away for this model, in its own words, or "" when it does not.
 * Asked once at start, so a bad key shows up before anyone speaks. An outage is not a
 * verdict on the key: being offline or overloaded for a moment answers "".
 */
export async function claudeProblem(access: Access): Promise<string> {
  try {
    await claude(access).models.retrieve(access.model, undefined, { maxRetries: 0, timeout: 10_000 });
    return "";
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) throw e;
    if (![400, 401, 403, 404].includes(e.status ?? 0)) return "";
    const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    return (detail || e.message).slice(0, 300);
  }
}

/** Streams Claude's reply as plain text chunks, running tools between rounds. Stops when the user interrupts. */
export function anthropicReply(options: Access & {
  /** Stable for the life of the process: it is cached together with the tools. */
  system: string;
  /** What changes between turns (the time, what is waiting). Read once per spoken turn. */
  context?: (turn: SpokenTurn) => string;
  /** The scripted first message, for a transcript that does not carry it. */
  greeting?: string;
  tools?: Anthropic.Tool[]; runTool?: RunTool;
  effort?: "low" | "medium" | "high";
  /** Sonnet 5.5 only: no thinking before the first words, only between tool calls. */
  betweenTools?: boolean;
  maxRounds?: number; log?: (line: string) => void;
}): Reply {
  const client = claude(options);
  const rounds = options.maxRounds ?? 5;
  return async function* (transcript, signal, conversationId = "") {
    const { opening: spoken, messages } = toMessages(transcript);
    if (!messages.length) return;
    const turn: SpokenTurn = { conversationId, transcript };
    const opening = spoken || options.greeting || "";
    // Built once per spoken turn: a system prompt that changed between tool rounds would invalidate that turn's thinking.
    const live = [options.context?.(turn), opening && OPENING + opening].filter(Boolean).join("\n\n");
    const system: Anthropic.TextBlockParam[] = [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }, ...(live ? [{ type: "text" as const, text: live }] : [])];
    const started = Date.now();
    let heard = false, unparsed = 0;
    const closing = (text: string) => (heard ? ` ${text}` : text);
    for (let round = 1; round <= rounds; round++) {
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: 4096,
        thinking: options.betweenTools ? { type: "between_tools" } : { type: "adaptive" },
        output_config: { effort: options.effort ?? "low" },
        system,
        ...(options.tools?.length ? { tools: options.tools } : {}),
        messages,
      }, { signal });
      let said = false;
      let message: Anthropic.Message;
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
            if (!heard) options.log?.(`first words after ${Date.now() - started} ms`);
            yield heard && !said ? ` ${event.delta.text}` : event.delta.text;
            heard = said = true;
          } else if (event.type === "content_block_start" && event.content_block.type === "tool_use" && !heard) {
            // A lookup is coming and nothing has been said yet: fill the silence.
            options.log?.(`filler after ${Date.now() - started} ms (${event.content_block.name})`);
            yield FILLER;
            heard = true;
          }
        }
        message = await stream.finalMessage();
      } catch (e) {
        // Tool input streams unvalidated, so it can arrive as JSON that will not parse: ask again.
        // Anything the API itself raised, an interruption included, is the caller's to handle.
        if (e instanceof Anthropic.APIError || said || ++unparsed > 2) throw e;
        continue;
      }
      const calls = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      const { usage } = message;
      options.log?.(`round ${round}: ${message.stop_reason}, ${usage.input_tokens} in + ${usage.cache_read_input_tokens ?? 0} cached, ${usage.output_tokens} out, ${Date.now() - started} ms`);
      // A refusal or a reply cut off at the limit can leave a tool call half written, so only a clean tool_use stop runs tools.
      if (message.stop_reason !== "tool_use" || !calls.length || !options.runTool || round === rounds) {
        if (message.stop_reason === "refusal") { if (!said) yield closing(REFUSED); }
        else if (!said || calls.length) yield closing(UNFINISHED);
        return;
      }
      const run = options.runTool;
      const results = await Promise.all(calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
        try { return { type: "tool_result", tool_use_id: call.id, content: await run(call.name, call.input, signal, turn) }; }
        catch (e) { return { type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message.slice(0, 400) : "The tool failed." }; }
      }));
      if (signal.aborted) return;
      // The reply goes back exactly as it came, thinking included, and every result in one user message.
      messages.push({ role: "assistant", content: message.content }, { role: "user", content: results });
    }
  };
}
