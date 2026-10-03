import { brainEnabled, sourceOrigin } from "./brain-sources";
import type { ChatAttachment } from "./chat-attachments";
import type { MemorySource } from "./operator";

type ContextTurn = {
  contextReusable?: boolean;
  brainRevision?: number;
  sourceIds?: string[];
  via?: string;
  attachments?: ChatAttachment[];
};
type ContextPolicy = {
  brainRevision?: number;
  brainSources?: Record<string, boolean>;
  sources: Partial<MemorySource>[];
};
/** A stopped/error reply is a transcript record, never reusable evidence. */
export function chatContextEligible(turn: ContextTurn, workspace: ContextPolicy): boolean {
  if (
    turn.contextReusable === false ||
    turn.via === "needs attention" ||
    (turn.brainRevision || 0) !== (workspace.brainRevision || 0)
  )
    return false;
  const active = new Set(
    workspace.sources
      .filter((s) => !s.deletedAt && brainEnabled(workspace, sourceOrigin(s)))
      .map((s) => s.id),
  );
  return (
    !turn.sourceIds?.some((id) => !active.has(id)) &&
    !turn.attachments?.some((file) => !brainEnabled(workspace, file.origin))
  );
}
