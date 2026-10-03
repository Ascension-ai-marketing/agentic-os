import { useState } from "react";
import { Plus, Target, Trash2, ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useOperator, operatorRequest, askOperator, type WorkspaceGoals } from "@/lib/operator";
import { Modal, Notice } from "./ui";
export function GoalsPanel({ compact = false }: { compact?: boolean }) {
  const { state, refresh } = useOperator(),
    goals = state.goals;
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<WorkspaceGoals>(goals),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const edit = () => {
    setDraft(structuredClone(goals));
    setOpen(true);
    setError("");
  };
  return (
    <>
      <section className={`op-panel ar-goals ${compact ? "is-compact" : ""}`}>
        <div className="op-panel-title">
          <div>
            <div className="op-eyebrow">DIRECTION, THEN ACTION</div>
            <h2>{compact ? "Your north star." : "Make the right things happen."}</h2>
          </div>
          <button className="op-button" onClick={edit}>
            <Target size={14} />
            {goals.week || goals.quarter ? "Edit goals" : "Set your goals"}
          </button>
        </div>
        <div className="ar-goal-horizons">
          {(
            [
              ["longTerm", "Long term"],
              ["quarter", "This quarter"],
              ["week", "This week"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <small>{label}</small>
              <p>{goals[key] || "Choose what success looks like."}</p>
            </div>
          ))}
        </div>
        {!compact && goals.metrics.length > 0 && (
          <div className="ar-metrics">
            {goals.metrics.map((m) => (
              <div key={m.id}>
                <span className="op-eyebrow">
                  {m.kind === "leading" ? "INPUT · LEADING" : "OUTCOME · LAGGING"}
                </span>
                <h3>{m.label}</h3>
                <strong>
                  {m.value.toLocaleString()}
                  <small>
                    {" "}
                    / {m.target.toLocaleString()} {m.unit}
                  </small>
                </strong>
                <progress max={m.target} value={Math.max(0, m.value)} />
                <small>Manually tracked</small>
              </div>
            ))}
          </div>
        )}
        <button
          className="op-text-link"
          onClick={() =>
            askOperator(
              "Given my goals, inbox and calendar, what should I prioritise today? Explain why.",
              `USER GOALS AND MANUALLY TRACKED METRICS:\n${JSON.stringify(goals)}`,
              true,
            )
          }
        >
          Build my daily brief <ArrowUpRight size={13} />
        </button>
      </section>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="What are you working towards?"
        description="Set the direction. Choose up to five measures that tell you whether you’re moving."
      >
        <form
          className="op-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await operatorRequest("/goals", draft);
              await refresh();
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {(
            [
              ["longTerm", "Long-term ambition"],
              ["quarter", "Quarterly goal"],
              ["week", "Weekly priority"],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              />
            </label>
          ))}
          <div className="op-panel-title">
            <h3>Five core metrics</h3>
            <button
              type="button"
              className="op-button"
              disabled={draft.metrics.length >= 5}
              onClick={() =>
                setDraft({
                  ...draft,
                  metrics: [
                    ...draft.metrics,
                    {
                      id: crypto.randomUUID(),
                      label: "",
                      kind: "leading",
                      value: 0,
                      target: 1,
                      unit: "",
                    },
                  ],
                })
              }
            >
              <Plus size={13} />
              Add metric
            </button>
          </div>
          <p className="op-form-help">
            Leading: actions you control, such as videos published. Lagging: results, such as
            revenue or closed sponsorships.
          </p>
          {draft.metrics.map((m, i) => (
            <div className="ar-metric-edit" key={m.id}>
              <input
                aria-label={`Metric ${i + 1} name`}
                placeholder="Metric name"
                required
                value={m.label}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    metrics: draft.metrics.map((x, j) =>
                      i === j ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <select
                aria-label={`Metric ${i + 1} type`}
                value={m.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    metrics: draft.metrics.map((x, j) =>
                      i === j ? { ...x, kind: e.target.value as any } : x,
                    ),
                  })
                }
              >
                <option value="leading">Leading input</option>
                <option value="lagging">Lagging outcome</option>
              </select>
              {(["value", "target"] as const).map((k) => (
                <label key={k}>
                  {k === "value" ? "Current" : "Target"}
                  <input
                    type="number"
                    step="any"
                    required
                    min={k === "target" ? 0.000001 : undefined}
                    value={m[k]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        metrics: draft.metrics.map((x, j) =>
                          i === j ? { ...x, [k]: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <button
                className="op-icon-button"
                type="button"
                aria-label={`Remove metric ${i + 1}`}
                onClick={() =>
                  setDraft({ ...draft, metrics: draft.metrics.filter((_, j) => j !== i) })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {error && <Notice error>{error}</Notice>}
          <button className="op-button primary" disabled={busy}>
            Save goals
          </button>
        </form>
      </Modal>
    </>
  );
}
