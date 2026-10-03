/** Transcripts the OS writes about itself are never the user's memory.
 *
 * The agent check (`scripts/agent-jobs-claude.ts` runs and the Claude model
 * probe) sends a fixed sentence and expects a fixed reply; the Chat runtime and
 * the daily brief send their own system prompts through `codex exec`. Those
 * sessions land in the same local folders as real work, so both the import and
 * the search filter them out. Existing records are never deleted here; a match
 * only hides them from recall. */
export const OPERATOR_SELF_MARKERS = [
  "local Operator OS integration test",
  "OPERATOR_READY",
  // Chat runtime system prompt (src/components/floating-oracle.tsx).
  "You are Agentic, the concise thinking partner inside Agentic OS.",
  // Daily brief writer (scripts/business-brief-generation.ts).
  "Write a useful, calm, readable daily business briefing for the workspace owner using ONLY the evidence packet below.",
  // Earlier Chat runtime system prompt, still present in saved transcripts.
  "You are Operator, the concise assistant inside",
  // Chat auto-title side call (vite.config.ts /__chat_title).
  "title (no quotes, no punctuation at the end) that summarizes this conversation",
  // Dream review run through `claude -p` / `codex exec` (scripts/run-dream.ts, vite.config.ts).
  "IMPORTANT: You are being run non-interactively",
  // Calendar draft side call (src/components/floating-oracle.tsx).
  "Propose a calendar event for the user to review before any booking.",
  // Design skill generation suffix (vite.config.ts).
  "Return ONLY the JSON object. No prose. No markdown fence. Start the response with { and end with }.",
];

/** Claude project folders the OS creates for its own runs: agent task workspaces
 * under `.operator-data/agent-tasks/<id>/claude` and the temporary
 * `jarvis-claude-check-*` probe folder. Claude encodes the cwd as one folder name
 * with every non-alphanumeric character replaced by `-`, so
 * `/Users/example/code/os/.operator-data/agent-tasks/<id>/claude` becomes
 * `-Users-example-code-os--operator-data-agent-tasks-<id>-claude` and the Windows cwd
 * `C:\Users\example\code\os\.operator-data\agent-tasks\<id>\claude` becomes
 * `C--Users-example-code-os--operator-data-agent-tasks-<id>-claude`. The raw cwd with
 * `/` or `\` separators is matched as well. */
const SELF_PATH =
  /(?:^|[/\\-])(?:-operator-data-agent-tasks-[^/\\]+-claude|\.operator-data[/\\]agent-tasks[/\\][^/\\]+[/\\]claude)(?:$|[/\\])|jarvis-claude-check-/;

export function isOperatorSelfTranscript(text: string): boolean {
  return OPERATOR_SELF_MARKERS.some((marker) => text.includes(marker));
}

/** True for a source path, an absolute path or a bare project folder name the OS owns. */
export function isOperatorSelfPath(path?: string | null): boolean {
  return !!path && SELF_PATH.test(path);
}
