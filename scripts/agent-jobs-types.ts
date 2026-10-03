export type AgentId = "codex" | "claude";
export type AgentQuestion = { id: string; question: string; options?: string[] };
export type AgentPending = {
  id: string;
  kind: "approval" | "question";
  title: string;
  detail: string;
  choices?: string[];
  questions?: AgentQuestion[];
};
export type AgentAdapterEvent =
  | { type: "session"; id: string }
  | { type: "text"; text: string; append?: boolean }
  | { type: "progress"; label: string }
  | ({ type: "input" } & AgentPending)
  | { type: "input_resolved"; id: string }
  | { type: "done" }
  | { type: "error"; message: string };
export type AgentRunInput = {
  cwd: string;
  prompt: string;
  signal: AbortSignal;
  readOnly?: boolean;
  /** Model id for this run, e.g. "claude-sonnet-5" or "gpt-6-astra". Default: the agent's own default. */
  model?: string;
  /** Started from Chat or voice: work without stopping to ask, unless truly blocked. */
  autonomous?: boolean;
  /** Continue this earlier session (a follow-up in the same task) instead of starting fresh. */
  resumeSessionId?: string;
  onEvent: (event: AgentAdapterEvent) => void;
};
export type AgentRunHandle = {
  respond: (id: string, decision: "approve" | "deny", answers?: Record<string, string>) => void;
  done: Promise<void>;
  cancel: () => void;
};
export type AgentRunStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentRun = {
  agent: AgentId;
  role: "execute" | "review" | "check";
  status: AgentRunStatus;
  sessionId?: string;
  text: string;
  /** Output from earlier turns of this task, kept above a follow-up's output. */
  earlier?: string;
  events: Array<{ id: string; at: string; label: string }>;
  pending?: AgentPending;
  error?: string;
};
export type AgentJob = {
  id: string;
  requestId: string;
  prompt: string;
  kind: "task" | "check";
  workflow?: "build" | "improve-os";
  /** Started from Chat or voice: work without stopping to ask. */
  autonomous?: boolean;
  /** Model Jev (or the user) chose for the executing agent. */
  model?: string;
  createdAt: string;
  updatedAt: string;
  runs: AgentRun[];
};
export type AgentStatus = {
  id: AgentId;
  installed: boolean;
  signedIn: boolean;
  detail: string;
  tools: string[];
  checkedAt: string;
  lastCheck?: { status: AgentRunStatus; at: string; detail: string };
};
