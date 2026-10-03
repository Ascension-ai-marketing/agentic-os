import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus, Send, Trash2 } from "lucide-react";
import { useBusinessWorkspace, type ProgressGoal } from "@/lib/business-workspace";
import { askOperator } from "@/lib/operator";
import { ProgressMeasures } from "./progress-measures";
import { goalPeriodState } from "@/lib/goal-periods";
import "./progress.css";
import { GoalCalendarArt } from "./goal-calendar-art";

type Horizon = ProgressGoal["horizon"];
const horizons: Array<{ id: Horizon; label: string; prompt: string }> = [
  { id: "week", label: "This week", prompt: "Decide what to finish next." },
  { id: "month", label: "This month", prompt: "Give the bigger task a deadline." },
  {
    id: "quarter",
    label: "This quarter",
    prompt: "Set the outcome to work towards.",
  },
];
export function ProgressPanel() {
  const workspace = useBusinessWorkspace();
  const progress = workspace.data?.progress || { goals: [], updates: [] };
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const update = () => setClock(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const currentGoals = progress.goals.filter((goal) => goalPeriodState(goal, clock) === "current");
  const [titles, setTitles] = useState<Record<Horizon, string>>({
    quarter: "",
    month: "",
    week: "",
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [update, setUpdate] = useState(""),
    [goalLink, setGoalLink] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [index, setIndex] = useState(0);
  const shown = progress.updates[Math.min(index, Math.max(0, progress.updates.length - 1))];
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await workspace.saveProgress(body);
      setIndex(0);
      if ((body as { action?: string }).action === "check-in")
        setNotice("Saved in your update history. Your next brief can use this context.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add(horizon: Horizon) {
    const title = titles[horizon].trim();
    if (title && (await save({ action: "goal", horizon, title })))
      setTitles((previous) => ({ ...previous, [horizon]: "" }));
  }
  function edit(goal: ProgressGoal) {
    setExpanded(expanded === goal.id ? null : goal.id);
    setEditTitle(goal.title);
    setNotes(goal.notes);
  }
  return (
    <section className="progress-workspace" aria-label="Progress workspace">
      <div className="progress-heading">
        <div>
          <span className="biz-overline">GOALS</span>
          <h2>What are you working towards?</h2>
          <p>Choose an outcome, then give it a deadline.</p>
        </div>
        <ProgressMeasures />
      </div>
      <div className="progress-horizons">
        {horizons.map((h) => {
          const goals = currentGoals.filter((g) => g.horizon === h.id);
          const history = progress.goals
            .filter((goal) => goal.horizon === h.id && goalPeriodState(goal, clock) !== "current")
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <section className={`progress-horizon is-${h.id}`} key={h.id} aria-label={h.label}>
              <div className="progress-horizon-cover">
                <GoalCalendarArt scope={h.id} />
                <div className="progress-horizon-caption">
                  <h3>{h.label}</h3>
                  <p>{h.prompt}</p>
                </div>
              </div>
              <div className="progress-horizon-body">
                <div className="progress-goal-list">
                  {goals.map((goal) => (
                    <article key={goal.id} className={goal.status === "done" ? "is-done" : ""}>
                      <div className="progress-goal-row">
                        <button
                          type="button"
                          className="progress-check"
                          role="checkbox"
                          aria-checked={goal.status === "done"}
                          aria-label={`Complete ${goal.title}`}
                          disabled={busy}
                          onClick={() =>
                            void save({
                              action: "goal",
                              id: goal.id,
                              status: goal.status === "done" ? "active" : "done",
                            })
                          }
                        >
                          {goal.status === "done" && <Check size={15} />}
                        </button>
                        <button
                          type="button"
                          className="progress-goal-title"
                          onClick={() => edit(goal)}
                          aria-expanded={expanded === goal.id}
                        >
                          {goal.title}
                          <ChevronDown size={15} />
                        </button>
                      </div>
                      <div className="progress-goal-meta">
                        <select
                          aria-label={`Status for ${goal.title}`}
                          value={goal.status}
                          disabled={busy}
                          onChange={(e) =>
                            void save({ action: "goal", id: goal.id, status: e.target.value })
                          }
                        >
                          <option value="planned">Planned</option>
                          <option value="active">In progress</option>
                          <option value="done">Done</option>
                        </select>
                      </div>
                      {expanded === goal.id && (
                        <form
                          className="progress-goal-detail"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (
                              await save({
                                action: "goal",
                                id: goal.id,
                                title: editTitle.trim(),
                                notes,
                              })
                            )
                              setExpanded(null);
                          }}
                        >
                          <label>
                            Goal
                            <input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              maxLength={300}
                              required
                              aria-label="Edit goal title"
                            />
                          </label>
                          <label>
                            Notes
                            <textarea
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              maxLength={4000}
                              placeholder="Next step, context, or what’s blocking you"
                              rows={3}
                            />
                          </label>
                          <div>
                            <button type="submit" disabled={busy || !editTitle.trim()}>
                              Save changes
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`Remove ${goal.title}`}
                              onClick={async () => {
                                if (await save({ action: "remove-goal", id: goal.id })) {
                                  setExpanded(null);
                                  if (goalLink === goal.id) setGoalLink("");
                                }
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </form>
                      )}
                    </article>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void add(h.id);
                  }}
                  className="progress-add"
                >
                  <input
                    aria-label={`Add ${h.label.toLowerCase()} goal`}
                    value={titles[h.id]}
                    onChange={(e) =>
                      setTitles((previous) => ({ ...previous, [h.id]: e.target.value }))
                    }
                    placeholder={`Add your ${h.id === "quarter" ? "quarterly" : h.id === "month" ? "monthly" : "weekly"} goal`}
                    maxLength={300}
                    required
                  />
                  <button
                    type="submit"
                    disabled={busy || !titles[h.id].trim()}
                    aria-label={`Add goal for ${h.label.toLowerCase()}`}
                  >
                    <Plus size={18} />
                  </button>
                </form>
                {!!history.length && (
                  <details className="progress-period-history">
                    <summary>
                      Goal history
                      <ChevronDown size={14} />
                    </summary>
                    <p>
                      Your history stays here. Carrying a goal forward creates a new commitment.
                    </p>
                    {history.map((goal) => {
                      const state = goalPeriodState(goal, clock),
                        renewed = currentGoals.some((current) => current.renewedFromId === goal.id);
                      return (
                        <article key={goal.id}>
                          <div>
                            <strong>{goal.title}</strong>
                            <small>
                              {state === "undated"
                                ? "No period was recorded"
                                : `${goal.period!.startDate} – ${goal.period!.endDate}${state === "future" ? " · upcoming" : ""}`}
                            </small>
                          </div>
                          <select
                            aria-label={`Status for earlier goal ${goal.title}`}
                            value={goal.status}
                            disabled={busy}
                            onChange={(event) =>
                              void save({ action: "goal", id: goal.id, status: event.target.value })
                            }
                          >
                            <option value="planned">Planned</option>
                            <option value="active">In progress</option>
                            <option value="done">Done</option>
                          </select>
                          {goal.notes && <p>{goal.notes}</p>}
                          {state !== "future" && (
                            <button
                              type="button"
                              disabled={busy || renewed}
                              onClick={() =>
                                void save({
                                  action: "goal",
                                  title: goal.title,
                                  notes: goal.notes,
                                  horizon: goal.horizon,
                                  renewedFromId: goal.id,
                                })
                              }
                            >
                              {renewed ? "Carried forward" : "Carry into this " + goal.horizon}
                              <ArrowRight size={13} />
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </details>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="progress-error">
          {error}
        </p>
      )}
      <div className="progress-review">
        <button
          type="button"
          onClick={() =>
            askOperator(
              "Review my quarter, month and week goals alongside my latest progress updates, inbox, calendar and Dream findings. What should I prioritise next, and what is at risk? Use only enabled sources and distinguish saved updates from current data.",
              "",
              true,
              undefined,
              "business",
            )
          }
        >
          Review my direction
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="progress-updates">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save({ action: "check-in", text: update, goalId: goalLink || undefined }))
              setUpdate("");
          }}
        >
          <span className="biz-overline">PROGRESS NOTES</span>
          <h3>What changed?</h3>
          <p className="progress-note-help">
            Keep a result, decision or next step. Link it to a goal to give future reviews more
            context.
          </p>
          <textarea
            value={update}
            onChange={(e) => setUpdate(e.target.value)}
            rows={3}
            required
            maxLength={4000}
            placeholder="A result or a decision worth keeping."
            aria-label="Progress update"
          />
          <div>
            <select
              value={goalLink}
              onChange={(e) => setGoalLink(e.target.value)}
              aria-label="Link update to goal"
            >
              <option value="">General update</option>
              {progress.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy || !update.trim()}>
              <Send size={14} />
              {busy ? "Saving…" : "Save update"}
            </button>
          </div>
          {notice && (
            <p className="progress-saved-note" role="status">
              <Check size={14} />
              {notice}
            </p>
          )}
        </form>
        <section aria-label="Progress updates">
          <div className="progress-updates-heading">
            <h3>Earlier updates</h3>
            {progress.updates.length > 1 && (
              <div>
                <span>
                  {progress.updates.length ? Math.min(index + 1, progress.updates.length) : 0} /{" "}
                  {progress.updates.length}
                </span>
                <button
                  type="button"
                  aria-label="Newer update"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Older update"
                  disabled={index >= progress.updates.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
          {shown ? (
            <>
              <time>
                {new Date(shown.createdAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <p className="progress-update-body">{shown.text}</p>
              {shown.goalId && (
                <small>
                  {progress.goals.find((g) => g.id === shown.goalId)?.title || "Previous goal"}
                </small>
              )}
            </>
          ) : (
            <p className="progress-update-empty">Your saved updates will appear here.</p>
          )}
          <p className="progress-brief-note">
            These goals and updates inform your daily brief when Business context is enabled in
            Memory.
          </p>
        </section>
      </div>
    </section>
  );
}
