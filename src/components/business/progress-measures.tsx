import { useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useOperator, operatorRequest, type WorkspaceGoals } from "@/lib/operator";
import { Modal, Notice } from "@/components/operator/ui";
import "./workspace-overview.css";

export function ProgressMeasures() {
  const { state, refresh } = useOperator();
  const [goalsDraft, setGoalsDraft] = useState<WorkspaceGoals | null>(null);
  const [goalsBusy, setGoalsBusy] = useState(false);
  const [goalsError, setGoalsError] = useState("");
  return (
    <>
      <button
        className="op-button"
        type="button"
        onClick={() => {
          setGoalsError("");
          setGoalsDraft(structuredClone(state.goals));
        }}
      >
        {state.goals.metrics.length ? "Edit measures" : "Add a measure"} <Plus size={13} />
      </button>
      <Modal
        open={goalsDraft !== null}
        onClose={() => setGoalsDraft(null)}
        title="How will you measure progress?"
        description="Choose up to five numbers you can update as your work moves forward."
      >
        {goalsDraft && (
          <form
            className="op-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setGoalsBusy(true);
              setGoalsError("");
              try {
                await operatorRequest("/goals", goalsDraft);
                await refresh();
                setGoalsDraft(null);
              } catch (error) {
                setGoalsError((error as Error).message);
              } finally {
                setGoalsBusy(false);
              }
            }}
          >
            <label>
              This quarter’s goal
              <input
                value={goalsDraft.quarter}
                onChange={(event) => setGoalsDraft({ ...goalsDraft, quarter: event.target.value })}
              />
            </label>
            <label>
              This week’s priority
              <input
                value={goalsDraft.week}
                onChange={(event) => setGoalsDraft({ ...goalsDraft, week: event.target.value })}
              />
            </label>
            <label>
              Long-term ambition
              <input
                value={goalsDraft.longTerm}
                onChange={(event) => setGoalsDraft({ ...goalsDraft, longTerm: event.target.value })}
              />
            </label>
            <div className="biz-measure-list">
              {goalsDraft.metrics.map((metric, index) => {
                const update = (change: Partial<typeof metric>) =>
                  setGoalsDraft({
                    ...goalsDraft,
                    metrics: goalsDraft.metrics.map((row, at) =>
                      at === index ? { ...row, ...change } : row,
                    ),
                  });
                return (
                  <fieldset key={metric.id}>
                    <legend>Measure {index + 1}</legend>
                    <label>
                      Name
                      <input
                        required
                        maxLength={140}
                        value={metric.label}
                        onChange={(event) => update({ label: event.target.value })}
                      />
                    </label>
                    <div className="biz-measure-fields">
                      <label>
                        Type
                        <select
                          value={metric.kind}
                          onChange={(event) =>
                            update({ kind: event.target.value as "leading" | "lagging" })
                          }
                        >
                          <option value="leading">Input you control</option>
                          <option value="lagging">Result you track</option>
                        </select>
                      </label>
                      <label>
                        Current
                        <input
                          type="number"
                          step="any"
                          required
                          value={metric.value}
                          onChange={(event) => update({ value: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Target
                        <input
                          type="number"
                          step="any"
                          min={0.000001}
                          required
                          value={metric.target}
                          onChange={(event) => update({ target: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Unit
                        <input
                          placeholder="videos, members…"
                          value={metric.unit}
                          onChange={(event) => update({ unit: event.target.value })}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="op-text-link"
                      onClick={() =>
                        setGoalsDraft({
                          ...goalsDraft,
                          metrics: goalsDraft.metrics.filter((row) => row.id !== metric.id),
                        })
                      }
                    >
                      <Trash2 size={12} /> Remove measure
                    </button>
                  </fieldset>
                );
              })}
            </div>
            {goalsDraft.metrics.length < 5 && (
              <button
                type="button"
                className="op-button"
                onClick={() =>
                  setGoalsDraft({
                    ...goalsDraft,
                    metrics: [
                      ...goalsDraft.metrics,
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
                <Plus size={13} /> Add measure
              </button>
            )}
            {goalsError && <Notice error>{goalsError}</Notice>}
            <button className="op-button primary" disabled={goalsBusy}>
              {goalsBusy ? "Saving…" : "Save measures"}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}
