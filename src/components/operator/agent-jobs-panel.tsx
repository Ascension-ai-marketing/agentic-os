import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { operatorRequest } from "@/lib/operator";
import codexLogo from "@/assets/logo-openai.svg";
import claudeLogo from "@/assets/logo-claude.svg";
import "./agent-jobs.css";

export type JobAgent = "codex" | "claude";
export type AgentTarget = JobAgent | "both";
export type AgentRun = {
  agent: JobAgent;
  role?: "execute" | "review" | "check";
  status: "queued" | "running" | "needs_input" | "completed" | "failed" | "cancelled";
  sessionId?: string;
  text: string;
  events: Array<{ id: string; at: string; label: string }>;
  pending?: {
    id: string;
    kind: "approval" | "question";
    title: string;
    detail: string;
    choices?: string[];
    questions?: Array<{ id: string; question: string; options?: string[] }>;
  };
  error?: string;
};
export type AgentJob = {
  id: string;
  requestId: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  kind?: "task" | "check";
  workflow?: "build" | "improve-os";
  model?: string;
  runs: AgentRun[];
};
export type AgentConnection = {
  id: JobAgent;
  installed: boolean;
  signedIn: boolean;
  detail: string;
  tools: string[];
  checkedAt: string;
  lastCheck?: { status: string; at: string; detail: string };
};
export const agentLabel = (agent: JobAgent) => (agent === "codex" ? "Codex" : "Claude");
export const activeAgentRun = (run: AgentRun) =>
  ["queued", "running", "needs_input"].includes(run.status);
export const agentJobKey = ["operator-agent-jobs"] as const;
export const agentStatusKey = ["operator-agent-job-status"] as const;
const labels: Record<AgentRun["status"], string> = {
  queued: "Queued",
  running: "Working",
  needs_input: "Needs your answer",
  completed: "Finished",
  failed: "Couldn’t finish",
  cancelled: "Stopped",
};

export function jobTargets(target: unknown): JobAgent[] {
  if (target === "both") return ["codex", "claude"];
  if (target === "codex" || target === "claude") return [target];
  throw new Error("Choose Codex, Claude or both.");
}
export function useAgentJobs(enabled = true) {
  return useQuery<{ jobs: AgentJob[] }>({
    queryKey: agentJobKey,
    queryFn: () => operatorRequest("/agent-jobs"),
    enabled,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.jobs?.some((job) => job.runs.some(activeAgentRun)) ? 1500 : false,
  });
}
export async function startAgentJob(
  prompt: unknown,
  target: unknown,
  requestId: string,
  workflow?: unknown,
) {
  if (workflow !== undefined && workflow !== "build" && workflow !== "improve-os")
    throw new Error("Choose a supported workflow.");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 6000)
    throw new Error("Describe the task in up to 6,000 characters.");
  return operatorRequest<{ job: AgentJob }>("/agent-jobs", {
    requestId,
    prompt: prompt.trim(),
    targets: jobTargets(target),
    ...(workflow ? { workflow } : {}),
  });
}
export async function checkAgentConnections(requestId: string) {
  return operatorRequest<{ job: AgentJob }>("/agent-jobs/check", {
    requestId,
    targets: ["codex", "claude"],
  });
}
export function AgentMark({ agent }: { agent: JobAgent }) {
  return (
    <img
      className="jaj-agent-logo"
      data-agent={agent}
      src={agent === "codex" ? codexLogo : claudeLogo}
      alt=""
    />
  );
}

export function AgentJobsPanel({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (job: AgentJob) => void;
}) {
  const qc = useQueryClient();
  const jobs = useAgentJobs();
  const connections = useQuery<{ agents: AgentConnection[] }>({
    queryKey: agentStatusKey,
    queryFn: () => operatorRequest("/agent-jobs/status"),
    retry: false,
    staleTime: 15000,
  });
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<AgentTarget>("both");
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const startingLock = useRef(false),
    checkingLock = useRef(false);
  const submission = useRef<{ requestId: string; fingerprint: string } | null>(null);
  const checkRequest = useRef<string | null>(null);
  const list = jobs.data?.jobs || [];
  const checkStates = list
    .filter((job) => job.kind === "check")
    .map((job) => `${job.id}:${job.runs.map((run) => run.status).join(",")}`)
    .join("|");
  useEffect(() => {
    if (checkStates) void qc.invalidateQueries({ queryKey: agentStatusKey });
  }, [checkStates, qc]);
  const selected = list.find((job) => job.id === selectedId) || list[0];
  async function created(job: AgentJob) {
    setComposing(false);
    qc.setQueryData<{ jobs: AgentJob[] }>(agentJobKey, (prior) => ({
      jobs: [job, ...(prior?.jobs || []).filter((entry) => entry.id !== job.id)],
    }));
    onSelect(job);
    await qc.invalidateQueries({ queryKey: agentJobKey });
    await qc.invalidateQueries({ queryKey: agentStatusKey });
  }
  async function submit() {
    if (startingLock.current || !prompt.trim()) return;
    startingLock.current = true;
    setStarting(true);
    setError("");
    const fingerprint = JSON.stringify([prompt.trim(), target]);
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { requestId: crypto.randomUUID(), fingerprint };
    try {
      const result = await startAgentJob(prompt, target, submission.current!.requestId);
      await created(result.job);
      setPrompt("");
      submission.current = null;
    } catch (error) {
      setError((error as Error).message);
    } finally {
      startingLock.current = false;
      setStarting(false);
    }
  }
  async function checkConnections() {
    if (checkingLock.current) return;
    checkingLock.current = true;
    setChecking(true);
    setError("");
    checkRequest.current ||= crypto.randomUUID();
    try {
      const result = await checkAgentConnections(checkRequest.current);
      await created(result.job);
      checkRequest.current = null;
    } catch (error) {
      setError((error as Error).message);
    } finally {
      checkingLock.current = false;
      setChecking(false);
    }
  }
  return (
    <section className="jarvis-agent-jobs" aria-label="Agent tasks">
      <header className="jaj-header">
        <h2>Work with your agents</h2>
        <button onClick={() => void checkConnections()} disabled={checking}>
          {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}Check
          agents
        </button>
      </header>
      <p className="jaj-intro">Set the task. Follow the work here.</p>
      <div className="jaj-connections">
        {(["codex", "claude"] as const).map((id) => {
          const connection = connections.data?.agents?.find((agent) => agent.id === id);
          const verified =
            connection?.installed &&
            connection.signedIn &&
            connection.lastCheck?.status === "completed";
          return (
            <details className="jaj-connection" key={id} data-ready={verified}>
              <summary>
                <AgentMark agent={id} />
                <strong>{agentLabel(id)}</strong>
                <small>
                  {verified
                    ? "Checked"
                    : !connection
                      ? connections.isPending
                        ? "Checking status…"
                        : "Status unavailable"
                      : !connection.installed
                        ? "Not installed"
                        : connection.signedIn
                          ? "Signed in"
                          : "Sign-in needed"}
                </small>
              </summary>
              <p>
                {connection?.detail ||
                  (connections.error
                    ? "Couldn’t read connection status. Try Check agents."
                    : "Reading installed agents and sign-in status.")}
              </p>
              {connection?.lastCheck && <p>{connection.lastCheck.detail}</p>}
              {!!connection?.tools.length && (
                <p className="jaj-tools">
                  Available tools: {connection.tools.slice(0, 12).join(", ")}
                  {connection.tools.length > 12 ? ` and ${connection.tools.length - 12} more` : ""}
                </p>
              )}
            </details>
          );
        })}
      </div>
      {!selected || composing ? (
        <form
          className="jaj-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="jaj-targets" role="group" aria-label="Choose task agents">
            {(["codex", "claude", "both"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={target === value}
                disabled={starting}
                onClick={() => setTarget(value)}
              >
                {value !== "both" && <AgentMark agent={value} />}
                {value === "both" ? "Both" : agentLabel(value)}
              </button>
            ))}
          </div>
          <textarea
            aria-label="Task for your agents"
            placeholder="What would you like to get done?"
            value={prompt}
            disabled={starting}
            maxLength={6000}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="jaj-compose-footer">
            <small>
              {target === "both"
                ? "Codex acts. Claude reviews. "
                : `${agentLabel(target)} carries out the task. `}
              Only this request is passed on.
            </small>
            <button className="jaj-start" disabled={starting || !prompt.trim()}>
              {starting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUpRight size={14} />
              )}
              {starting
                ? "Starting…"
                : target === "both"
                  ? "Run with both"
                  : `Run in ${agentLabel(target)}`}
            </button>
          </div>
        </form>
      ) : (
        <button className="jaj-new-task" onClick={() => setComposing(true)}>
          <Plus size={14} />
          New task
        </button>
      )}
      {error && (
        <div className="jaj-error" role="alert">
          {error}
        </div>
      )}
      {jobs.error && (
        <div className="jaj-error" role="alert">
          Couldn’t load agent tasks.<button onClick={() => void jobs.refetch()}>Try again</button>
        </div>
      )}
      {list.length > 1 && (
        <>
          <span className="jaj-history-label">RECENT TASKS</span>
          <nav className="jaj-history" aria-label="Recent agent tasks">
            {list.slice(0, 8).map((job) => (
              <button
                key={job.id}
                title={job.prompt}
                aria-pressed={selected?.id === job.id}
                onClick={() => onSelect(job)}
              >
                {job.prompt}
              </button>
            ))}
          </nav>
        </>
      )}
      {selected ? (
        <article className="jaj-task">
          <header>
            <h3>{selected.prompt}</h3>
          </header>
          <div className="jaj-runs" data-agents={selected.runs.length}>
            {selected.runs.map((run) => (
              <AgentRunCard
                key={`${selected.id}:${run.agent}`}
                job={selected}
                run={run}
                onRefresh={() => qc.invalidateQueries({ queryKey: agentJobKey })}
              />
            ))}
          </div>
        </article>
      ) : (
        <p className="jaj-empty">
          {jobs.isPending
            ? "Loading your tasks…"
            : "Your agents’ progress, questions and results will appear here."}
        </p>
      )}
    </section>
  );
}

function AgentRunCard({
  job,
  run,
  onRefresh,
}: {
  job: AgentJob;
  run: AgentRun;
  onRefresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const pending = run.pending;
  const codexSession =
    run.agent === "codex" &&
    run.sessionId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.sessionId)
      ? run.sessionId
      : undefined;
  useEffect(() => {
    setAnswers({});
    setError("");
  }, [pending?.id]);
  const questions = pending?.questions?.length
    ? pending.questions
    : [{ id: "answer", question: pending?.title || "Your answer", options: pending?.choices }];
  async function respond(decision: "approve" | "deny") {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operatorRequest("/agent-jobs/respond", {
        jobId: job.id,
        agent: run.agent,
        requestId: pending.id,
        decision,
        ...(pending.kind === "question" ? { answers } : {}),
      });
      await onRefresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function cancel() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await operatorRequest("/agent-jobs/cancel", { jobId: job.id, agent: run.agent });
      await onRefresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="jaj-run"
      data-status={run.status}
      aria-label={`${agentLabel(run.agent)} task`}
    >
      <header>
        <AgentMark agent={run.agent} />
        <h4>
          {agentLabel(run.agent)}
          {run.role === "review"
            ? " · Review"
            : run.role === "execute"
              ? " · Action"
              : run.role === "check"
                ? " · Check"
                : ""}
        </h4>
        <span className="jaj-run-status" role="status">
          {run.status === "running" || run.status === "queued" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : run.status === "completed" ? (
            <Check size={12} />
          ) : run.status === "needs_input" || run.status === "failed" ? (
            <TriangleAlert size={12} />
          ) : null}
          {labels[run.status]}
        </span>
      </header>
      {!!run.events?.length && (
        <ol className="jaj-events">
          {run.events.slice(-4).map((event) => (
            <li key={event.id}>
              <i />
              {event.label}
            </li>
          ))}
        </ol>
      )}
      {run.text &&
        (run.status === "completed" ? (
          <pre className="jaj-output">{run.text}</pre>
        ) : (
          <details className="jaj-output-details">
            <summary>Read progress</summary>
            <pre className="jaj-output">{run.text}</pre>
          </details>
        ))}
      {run.error && <p className="jaj-run-error">{run.error}</p>}
      {pending && run.status === "needs_input" && (
        <section
          className="jaj-review"
          aria-label={`${agentLabel(run.agent)} ${pending.kind === "approval" ? "approval" : "question"}`}
        >
          <h5>{pending.title}</h5>
          <pre className="jaj-review-detail">{pending.detail}</pre>
          {pending.kind === "question" &&
            questions.map((question) => (
              <div className="jaj-question" key={question.id}>
                {question.question}
                {!!question.options?.length && (
                  <span className="jaj-answer-options">
                    {question.options.map((option) => (
                      <button
                        type="button"
                        key={option}
                        aria-pressed={answers[question.id] === option}
                        disabled={busy}
                        onClick={() =>
                          setAnswers((current) => ({ ...current, [question.id]: option }))
                        }
                      >
                        {option}
                      </button>
                    ))}
                  </span>
                )}
                <textarea
                  aria-label={question.question}
                  maxLength={4000}
                  disabled={busy}
                  value={answers[question.id] || ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              </div>
            ))}
          <div className="jaj-review-actions">
            <button
              disabled={
                busy ||
                (pending.kind === "question" &&
                  questions.some((question) => !answers[question.id]?.trim()))
              }
              onClick={() => void respond("approve")}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {pending.kind === "approval" ? "Approve once" : "Send answer"}
            </button>
            {pending.kind === "approval" && (
              <button disabled={busy} onClick={() => void respond("deny")}>
                <X size={13} />
                Deny
              </button>
            )}
          </div>
        </section>
      )}
      {error && (
        <div className="jaj-error" role="alert">
          {error}
        </div>
      )}
      {(activeAgentRun(run) || codexSession) && (
        <footer>
          {codexSession && (
            <a
              className="jaj-native-link"
              href={`codex://threads/${encodeURIComponent(codexSession)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Codex
              <ArrowUpRight size={12} />
            </a>
          )}
          {activeAgentRun(run) && (
            <button className="jaj-cancel" disabled={busy} onClick={() => void cancel()}>
              <Square size={10} />
              Stop {agentLabel(run.agent)}
            </button>
          )}
        </footer>
      )}
    </section>
  );
}
