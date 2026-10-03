/**
 * Checks a drafted reply against the video's own transcript with a small
 * model: does the draft's claim match what the video says? Only comments that
 * ask something are checked; a wrong draft is rewritten to match the video.
 */
export type CheckVerdict = "supported" | "contradicted" | "not_in_video";
export type CheckResult = { verdict: CheckVerdict; evidence?: string; reply?: string };
const QUESTION_START = /^(is|are|does|do|can|could|will|would|how|what|why|where|when|which|who|should|did|has|have|any|anyone|was)\b/i;
const MONEY = /\b(free|cost|price|pricing|pay|paid|subscription|plan|credits?|\$\d)/i;

/** A comment that asks something, or asks about money, gets checked. */
export function isQuestion(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (value.includes("?")) return true;
  if (MONEY.test(value)) return true;
  return value.split(/[.!\n]+/).some(sentence => QUESTION_START.test(sentence.trim()));
}
export function checkPrompt(input: { comment: string; draft: string; videoTitle: string; excerpts: string[] }) {
  const system = "You fact-check a YouTube reply against the video's own transcript. Judge only factual claims (what the video says, shows, costs, requires). Tone and opinion are not your concern. Be strict and brief.";
  const user = [
    `VIDEO: ${input.videoTitle}`,
    "TRANSCRIPT EXCERPTS:",
    ...input.excerpts.map(e => `- ${e}`),
    "",
    `VIEWER COMMENT: ${input.comment.replace(/\s+/g, " ").trim()}`,
    `DRAFT REPLY: ${input.draft.replace(/\s+/g, " ").trim()}`,
    "",
    "Does the draft's factual claim match what the video says?",
    "- supported: the excerpts back the draft.",
    "- contradicted: the excerpts say something different; then rewrite the draft to match the video, same tone, same length, plain text, no em dashes.",
    "- not_in_video: the excerpts do not cover it.",
    "Answer with JSON only: {\"verdict\":\"supported\"|\"contradicted\"|\"not_in_video\",\"evidence\":\"a short quote from the excerpts, or empty\",\"reply\":\"the rewritten draft, only when contradicted\"}",
  ].join("\n");
  return { system, user };
}
export function parseCheck(text: string): CheckResult {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The checking model did not answer clearly.");
  const data = JSON.parse(text.slice(start, end + 1));
  const verdict = data?.verdict;
  if (verdict !== "supported" && verdict !== "contradicted" && verdict !== "not_in_video") throw new Error("The checking model did not answer clearly.");
  const evidence = typeof data.evidence === "string" && data.evidence.trim() ? data.evidence.trim().slice(0, 240) : undefined;
  const reply = verdict === "contradicted" && typeof data.reply === "string" && data.reply.trim() ? data.reply.trim().replace(/—/g, ",").slice(0, 1500) : undefined;
  return { verdict, ...(evidence ? { evidence } : {}), ...(reply ? { reply } : {}) };
}
