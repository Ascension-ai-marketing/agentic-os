/**
 * ceo-approval-gate.ts
 *
 * The only way a spoken turn approves an outside action. It is a check on the
 * person's own words, made in code before the model answers; the model has no
 * part in it. An action counts as asked only once code has read it aloud at the
 * end of a reply and the conversation's own record shows the action was spoken,
 * and only the very next thing the person says can answer it: a plain yes, said
 * soon enough, approves; a no declines; anything else leaves it waiting. Text from tools, emails or memory never reaches this check, because
 * it only ever looks at the turns of the conversation itself.
 */
import { CONFIRM_WINDOW_MS, confirmWord } from "../src/lib/voice-confirm";

type Turn = { role: "user" | "agent"; content: string };
export type Verdict = { id: string; action: string; decision: "approved" | "declined" | "unanswered" };
export type ApprovalGate = ReturnType<typeof approvalGate>;

const userTurns = (transcript: Turn[]) => transcript.filter((turn) => turn.role === "user").length;
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The part of the question the person must have heard for their answer to count: the action itself. */
const readBack = (action: string) => `To confirm, sir: ${action.replace(/[\s.!?]+$/, "")}.`;
/** The words an action is read aloud with. */
export const confirmQuestion = (action: string) => `${readBack(action)} Yes or no?`;

/** One gate per conversation. Turns are counted, not timed, so a transcript delivered twice is judged once. */
export function approvalGate(options: { windowMs?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now, windowMs = options.windowMs ?? CONFIRM_WINDOW_MS;
  let waiting: { id: string; action: string; turn: number; askedAt?: number } | undefined;
  let judged: { turn: number; verdict?: Verdict } = { turn: 0 };
  return {
    /** Judges the person's newest turn. Call it for every transcript, before the model answers. */
    heard(transcript: Turn[]): Verdict | undefined {
      const turn = userTurns(transcript);
      if (turn <= judged.turn) return turn === judged.turn ? judged.verdict : undefined;
      const asked = waiting, last = transcript.at(-1), before = transcript.at(-2);
      // Whatever was waiting had this one turn to be answered.
      waiting = undefined;
      judged = { turn };
      if (!asked?.askedAt || last?.role !== "user") return undefined;
      // The transcript holds what was actually spoken: an action cut short by the person talking over it was never heard, so nothing answers it.
      const spoken = before?.role === "agent" && words(before.content).includes(words(readBack(asked.action)));
      const word = spoken && turn === asked.turn + 1 ? confirmWord(last.content) : null;
      const decision = word === "no" ? "declined" : word === "yes" && now() - asked.askedAt <= windowMs ? "approved" : "unanswered";
      return (judged.verdict = { id: asked.id, action: asked.action, decision });
    },
    /** The model filed an action while answering this transcript. One at a time: with another already waiting, this answers with that one's wording and holds nothing new. */
    file(id: string, action: string, transcript: Turn[]): string | undefined {
      if (waiting && waiting.id !== id) return waiting.action;
      waiting = { id, action, turn: userTurns(transcript) };
      return undefined;
    },
    /** The question for an action filed in this reply that still has to be read aloud. */
    unasked: () => (waiting && waiting.askedAt === undefined ? confirmQuestion(waiting.action) : undefined),
    /** The question has just been handed over to be spoken: from now the person's next turn can answer it. */
    asked() { if (waiting) waiting.askedAt = now(); },
  };
}
