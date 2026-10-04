// What Jarvis handed out and what is waiting for your yes. A task Jarvis
// started by voice has no chat of its own, so this is where its Claude Code or
// Codex steps are approved: each one shows the OS's own task card.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentJobKey, useAgentJobs } from "@/components/operator/agent-jobs-panel";
import { PageHeading, Panel } from "@/components/operator/ui";
import { operatorRequest } from "@/lib/operator";
import { AGENT_LABEL, STATUS_LABEL, ago, inboxView, type InboxApproval, type InboxTask } from "@/lib/ceo-inbox";
import { ChatTaskCard } from "./chat-task";
import "./ceo-inbox.css";

const inboxKey = ["operator-ceo-inbox"] as const;
// The task card's own status colours, under the names it knows.
const DOT: Record<InboxTask["status"], string> = { queued: "queued", running: "running", blocked: "needs_input", done: "completed", failed: "failed" };

function Waiting({ item }: { item: InboxApproval }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "approved" | "declined") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operatorRequest("/ceo/approvals/resolve", { id: item.id, decision });
      await qc.invalidateQueries({ queryKey: inboxKey });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ceo-item" role="group" aria-label={item.action}>
      <p className="ceo-say">{item.action}</p>
      {item.detail && <p className="ceo-note">{item.detail}</p>}
      <div className="ceo-actions">
        <button type="button" className="op-button primary" disabled={busy} onClick={() => void decide("approved")}>Approve</button>
        <button type="button" className="op-button" disabled={busy} onClick={() => void decide("declined")}>Decline</button>
      </div>
      <p className="ceo-note">Asked {ago(item.createdAt)}</p>
      {error && <p className="ceo-error">{error}</p>}
    </div>
  );
}

export function CeoInbox() {
  const qc = useQueryClient();
  const inbox = useQuery({
    queryKey: inboxKey,
    // The first request brings the work up to date with the agents; the second reads it with the approvals.
    queryFn: async () => {
      await operatorRequest("/ceo/tasks").catch(() => undefined);
      return operatorRequest("/ceo");
    },
    refetchInterval: 5000,
    retry: false,
  });
  const jobs = useAgentJobs(true);
  const view = inboxView(inbox.data, jobs.data?.jobs);
  // A task Jarvis has just handed to the OS: fetch its job now rather than on the next visit.
  const open = view.tasks.filter((task) => task.job && task.status !== "done" && task.status !== "failed").map((task) => task.job!.id).join(" ");
  useEffect(() => {
    if (open) void qc.invalidateQueries({ queryKey: agentJobKey });
  }, [open, qc]);

  return (
    <div className="op-page ceo-inbox">
      <PageHeading
        eyebrow="Voice · Background work"
        title="Jarvis"
        description={view.needsYou ? `${view.needsYou} ${view.needsYou === 1 ? "thing needs" : "things need"} you.` : "What Jarvis has handed out, and what is waiting for your yes."}
      />
      {inbox.isError && <p className="ceo-error">{(inbox.error as Error).message}</p>}

      <Panel>
        <div className="op-panel-title">
          <div>
            <h2>Waiting for your yes</h2>
            <small>Your answer is recorded. Nothing is sent from here yet.</small>
          </div>
        </div>
        {view.waiting.length ? (
          <div className="ceo-list">{view.waiting.map((item) => <Waiting key={item.id} item={item} />)}</div>
        ) : (
          <p className="ceo-quiet">Nothing is waiting. When Jarvis wants to send, book or pay for something, it asks here and out loud.</p>
        )}
        {view.decided.length > 0 && (
          <ul className="ceo-decided" aria-label="Recent answers">
            {view.decided.map((item) => (
              <li key={item.id}>
                <b>{item.status === "approved" ? "Approved" : "Declined"}</b> {item.by === "voice" ? "by voice" : "with the button"} · {ago(item.resolvedAt ?? item.createdAt)} · {item.action}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <div className="op-panel-title">
          <div>
            <h2>Handed out</h2>
            <small>Claude Code and Codex stop to ask before each step that changes something. Approve or deny it on the task.</small>
          </div>
        </div>
        {view.tasks.length ? (
          <div className="ceo-list">
            {view.tasks.map((task) => (
              <div key={task.id} className="ceo-item">
                <div className="ceo-item-head">
                  <b>{task.title}</b>
                  <small>{AGENT_LABEL[task.agent]} · {ago(task.createdAt)}</small>
                  <span className="ctask-status" data-status={DOT[task.status]}>
                    <i />
                    {STATUS_LABEL[task.status]}
                  </span>
                </div>
                {/* While its task card is live, the card says what is happening; the saved note may be a moment behind. */}
                {task.note && !(task.card && (task.status === "queued" || task.status === "running" || task.status === "blocked")) && <p className="ceo-note ceo-result">{task.note}</p>}
                {task.job && task.card && <ChatTaskCard jobId={task.job.id} agent={task.job.agent} collapsed />}
              </div>
            ))}
          </div>
        ) : (
          <p className="ceo-quiet">{inbox.isLoading ? "Reading the records…" : "Nothing yet. Ask Jarvis to look something up or build something, and it shows here."}</p>
        )}
      </Panel>
    </div>
  );
}
