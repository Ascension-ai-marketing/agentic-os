import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { operatorRequest } from "@/lib/operator";
import {
  AgentMark,
  AgentJobsPanel,
  agentLabel,
  agentJobKey,
  agentStatusKey,
  checkAgentConnections,
  useAgentJobs,
  activeAgentRun,
  type AgentConnection,
  type AgentJob,
} from "./agent-jobs-panel";

/** Read status on open; only the explicit button creates a local verification task. */
export function SetupAgentConnections() {
  const client = useQueryClient();
  const status = useQuery<{ agents: AgentConnection[] }>({
    queryKey: agentStatusKey,
    queryFn: () => operatorRequest("/agent-jobs/status"),
    staleTime: 15000,
    retry: false,
  });
  const [checkId, setCheckId] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<string | null>(null),
    locked = useRef(false);
  const jobs = useAgentJobs();
  const job = checkId
    ? jobs.data?.jobs.find((item) => item.id === checkId)
    : jobs.data?.jobs.find((item) => item.kind === "check" && item.runs.some(activeAgentRun));
  const progress = job?.runs.map((run) => `${run.agent}:${run.status}`).join(",");
  const active = !!job?.runs.some(activeAgentRun);
  useEffect(() => {
    if (progress) void client.invalidateQueries({ queryKey: agentStatusKey });
  }, [progress, client]);
  async function check() {
    if (locked.current || active) return;
    locked.current = true;
    setBusy(true);
    setError("");
    request.current ||= crypto.randomUUID();
    try {
      const result = await checkAgentConnections(request.current);
      client.setQueryData<{ jobs: AgentJob[] }>(agentJobKey, (prior) => ({
        jobs: [result.job, ...(prior?.jobs || []).filter((item) => item.id !== result.job.id)],
      }));
      setCheckId(result.job.id);
      request.current = null;
      await client.invalidateQueries({ queryKey: agentStatusKey });
      await client.invalidateQueries({ queryKey: agentJobKey });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (reviewing)
    return (
      <section className="ws-setup-agents" aria-label="Review agent check">
        <button type="button" onClick={() => setReviewing(false)}>
          Back to connections
        </button>
        <AgentJobsPanel selectedId={job?.id} onSelect={(selected) => setCheckId(selected.id)} />
      </section>
    );
  return (
    <section className="ws-setup-agents" aria-label="Agent connections">
      <p>Jarvis can hand work to Codex and Claude. Your existing sign-ins stay with each app.</p>
      <div className="ws-setup-agent-list">
        {(["codex", "claude"] as const).map((id) => {
          const connection = status.data?.agents.find((agent) => agent.id === id);
          const run = job?.runs.find((run) => run.agent === id);
          const verified =
            connection?.installed &&
            connection.signedIn &&
            connection.lastCheck?.status === "completed";
          return (
            <article className="ws-setup-agent" key={id}>
              <header>
                <AgentMark agent={id} />
                <strong>{agentLabel(id)}</strong>
                <small>
                  {verified ? "Task check passed" : status.isPending ? "Reading status…" : ""}
                </small>
              </header>
              <dl>
                <dt>Installed</dt>
                <dd>{connection ? (connection.installed ? "Yes" : "Not found") : "Not checked"}</dd>
                <dt>Sign-in</dt>
                <dd>
                  {connection
                    ? connection.signedIn
                      ? "Signed in"
                      : "Sign in needed"
                    : "Not checked"}
                </dd>
                <dt>Task check</dt>
                <dd>
                  {run && activeAgentRun(run)
                    ? run.status === "needs_input"
                      ? "Needs your answer"
                      : "Running…"
                    : verified
                      ? "Passed"
                      : connection?.lastCheck?.status === "failed"
                        ? "Needs a retry"
                        : "Not verified"}
                </dd>
              </dl>
              {connection && !connection.signedIn && (
                <p>
                  Sign in through {agentLabel(id)}, then refresh here.
                  {id === "claude" && (
                    <>
                      {" "}
                      In Terminal: <code>claude auth login</code>.
                    </>
                  )}
                </p>
              )}
              {run?.status === "failed" && (
                <p role="status">
                  {run.error ||
                    "The task check did not finish. Refresh your sign-in and try again."}
                </p>
              )}
              {run?.status === "needs_input" && (
                <button type="button" onClick={() => setReviewing(true)}>
                  Review check
                </button>
              )}
            </article>
          );
        })}
      </div>
      <p>
        The check creates a small local test file. Memory imports and app permissions are managed
        separately.
      </p>
      <button
        type="button"
        onClick={() => void check()}
        disabled={busy || active || status.isPending}
      >
        {busy || active ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {busy || active ? "Checking agents…" : "Check agents"}
      </button>
      <button type="button" disabled={status.isFetching} onClick={() => void status.refetch()}>
        Refresh status
      </button>
      {status.isError && (
        <p role="alert" className="ws-error">
          Couldn’t read agent status. Refresh to try again.
        </p>
      )}
      {error && (
        <p role="alert" className="ws-error">
          {error}
        </p>
      )}
    </section>
  );
}
