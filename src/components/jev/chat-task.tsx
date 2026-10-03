// A task Jev handed to Claude Code or Codex, shown inline in Chat: who runs
// it, on which model, and its live terminal (collapsible, with Stop and
// Continue in Terminal). The work runs in the background; nothing navigates.
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { activeAgentRun, agentJobKey, useAgentJobs, type AgentJob } from "@/components/operator/agent-jobs-panel";
import { operatorRequest } from "@/lib/operator";
import { prettyModelName } from "@/lib/jev-models";
import { JevOptionLogo } from "./jev-choosing";
import { TerminalBody } from "./live-page";
import "./live-page.css";
import "./chat-task.css";

const AUTH_ERROR = /\b(oauth|sign(?:ed)? ?(?:in|out)|log ?in|not logged|authenticat|unauthori[sz]ed|401|token (?:expired|invalid)|session expired)/i;
const STATUS: Record<string, string> = { queued: "Starting", running: "Working", needs_input: "Needs you", completed: "Done", failed: "Stopped with an error", cancelled: "Stopped" };

/** The agent is waiting on you: a question (options + your own answer) or an approval. */
function PendingAsk({ job, agent, name, pending, demo }: { job: AgentJob; agent: "claude" | "codex"; name: string; pending: NonNullable<AgentJob["runs"][number]["pending"]>; demo: boolean }) {
  const qc = useQueryClient();
  const questions = pending.questions?.length ? pending.questions : pending.kind === "question" ? [{ id: "answer", question: pending.title || "Your answer", options: pending.choices }] : [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setAnswers({});
    setError("");
  }, [pending.id]);
  const ready = questions.every((q) => answers[q.id]?.trim());
  async function respond(decision: "approve" | "deny") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!demo) await operatorRequest("/agent-jobs/respond", { jobId: job.id, agent, requestId: pending.id, decision, ...(pending.kind === "question" ? { answers } : {}) });
      window.dispatchEvent(new CustomEvent("jev:task-answered", { detail: { jobId: job.id, decision, answers } }));
      await qc.invalidateQueries({ queryKey: agentJobKey });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ctask-ask" role="group" aria-label={`${name} needs your answer`}>
      <b>{name} needs your answer</b>
      {pending.kind === "approval" ? (
        <>
          <p>{pending.title}</p>
          {pending.detail && <pre>{pending.detail.slice(0, 600)}</pre>}
          <div className="ctask-ask-actions">
            <button type="button" className="is-primary" disabled={busy} onClick={() => void respond("approve")}>Approve</button>
            <button type="button" disabled={busy} onClick={() => void respond("deny")}>Deny</button>
          </div>
        </>
      ) : (
        <>
          {questions.map((q) => (
            <div key={q.id} className="ctask-q">
              <p>{q.question}</p>
              {!!q.options?.length && (
                <div className="ctask-ask-actions">
                  {q.options.map((o) => (
                    <button key={o} type="button" aria-pressed={answers[q.id] === o} onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <input value={answers[q.id] ?? ""} placeholder="Or type your answer" onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
            </div>
          ))}
          <div className="ctask-ask-actions">
            <button type="button" className="is-primary" disabled={busy || !ready} onClick={() => void respond("approve")}>Send answer</button>
            <button type="button" disabled={busy} onClick={() => void respond("deny")}>Skip</button>
          </div>
        </>
      )}
      {error && <p className="ctask-fix">{error}</p>}
    </div>
  );
}

export function ChatTaskCard({ jobId, agent, demoJob, collapsed }: { jobId: string; agent: "claude" | "codex"; demoJob?: AgentJob; collapsed?: boolean }) {
  const jobs = useAgentJobs(!demoJob);
  const job = demoJob ?? jobs.data?.jobs.find((j) => j.id === jobId);
  const run = job?.runs.find((r) => r.agent === agent) ?? job?.runs[0];
  const live = !!run && activeAgentRun(run);
  const [open, setOpen] = useState(!collapsed);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  const name = agent === "codex" ? "Codex" : "Claude Code";
  // A sign-in failure gets one plain line with the fix, not the raw error.
  const authFix =
    run?.status === "failed" && AUTH_ERROR.test(`${run.error ?? ""} ${(run.text ?? "").slice(-400)}`)
      ? agent === "codex"
        ? "Codex is signed out. Run codex login in Terminal, then try again."
        : "Claude Code is signed out. Run claude in Terminal and sign in, then try again."
      : "";
  const model = job?.model ? prettyModelName(job.model) : undefined;
  return (
    <section className="ctask" data-agent={agent} data-live={live || undefined} data-open={open || undefined} aria-label={`${name} task`}>
      <button type="button" className="ctask-top" onClick={() => setOpen(!open)} aria-expanded={open}>
        <JevOptionLogo id={agent} size={22} />
        <b>{name}</b>
        {model && <span className="ctask-model">{model}</span>}
        <span className="ctask-prompt">{job ? job.prompt.split("\n").filter(Boolean).pop() : "Starting the task…"}</span>
        <span className="ctask-status" data-status={run?.status ?? "queued"}>
          <i />
          {authFix ? "Signed out" : STATUS[run?.status ?? "queued"]}
        </span>
        <ChevronDown size={14} className="ctask-chev" />
      </button>
      {authFix && <p className="ctask-fix">{authFix}</p>}
      {job && run?.status === "needs_input" && run.pending && <PendingAsk job={job} agent={run.agent} name={name} pending={run.pending} demo={!!demoJob} />}
      {open && job && run && <TerminalBody tab={{ key: `${job.id}:${run.agent}`, job, run: authFix ? { ...run, error: undefined } : run }} now={now} />}
    </section>
  );
}
