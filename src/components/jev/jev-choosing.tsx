// "Jev is choosing": the moment in the chat transcript where Jev weighs the
// options, the odds bars fill, and the winner snaps forward. Two kinds:
//  - executor (every message): quick answer, open a page, Claude Code or
//    Codex. A quick answer settles into one quiet line; real work gets the
//    full card, then its task card appears underneath.
//  - model (Jev · Auto): which model answers this chat.
// Plays once per run id; a row that has already played renders settled (no
// replay when the pending answer moves into the transcript). Click for the
// full Jev card with the raw odds.
import { useEffect, useRef, useState } from "react";
import { BrainCircuit, ChevronDown, PanelTop } from "lucide-react";
import type { JevAnswer, JevDecision } from "@/lib/jev-types";
import { JEV_MODELS, prettyModelName } from "@/lib/jev-models";
import claudeLogo from "@/assets/claude-logo.png";
import codexLogo from "@/assets/logos/codex.png";
import openaiLogo from "@/assets/logos/openai-gpt5.png";
import { fmtMs, fmtUsd, JevCard, JevLogo, JevMark } from "./jev-card";
import { executorOdds, executorPick } from "@/lib/jev-executor";
import "./jev-choosing.css";

export type JevCandidate = { key: string; label: string };
export type ExecutorLane = "reply" | "open" | "memory" | "claude" | "codex" | "continue";
export type JevRun = {
  run: string;
  decision: JevDecision | null;
  /** "executor": who handles the message. Default: which model answers. */
  view?: "executor";
  /** Executor: the lane that was acted on (overrides the decision's own pick). */
  lane?: ExecutorLane;
  /** Executor: the chat's own model, shown on the quick-answer option. */
  chatModel?: string;
  /** Executor: agents that are signed out (dimmed, "Sign in"). */
  signedOut?: string[];
  /** Executor: the second pick under the winner, e.g. the model or the page. */
  sub?: { label: string; p?: number };
  /** The chat's pinned pick, reused from an earlier turn. */
  kept?: boolean;
  sample?: boolean;
  /** Which answer to show for a model view. */
  answerKey?: string;
  /** Trailing note, e.g. the voice that spoke. */
  extra?: string;
};

// Pre-per-model pins and voice options, so old chats still read well.
const FALLBACK_LABELS: Record<string, string> = {
  "tier-1-no-ai": "No AI",
  "small-fast": "Small fast model",
  "claude-sonnet": "Claude Sonnet",
  "claude-opus": "Claude Opus",
  codex: "Codex",
  claude: "Claude Code",
  "tier-1": "No AI",
  "tier-2": "Quick answer",
  "tier-3": "Agent",
};

export const CHAT_CANDIDATES: JevCandidate[] = JEV_MODELS.map((m) => ({
  key: m.key,
  label: m.key === "codex" ? "Codex" : prettyModelName(m.chatIds[0]),
}));
export const VOICE_CANDIDATES: JevCandidate[] = JEV_MODELS.filter((m) => m.openrouterIds.length).map((m) => ({
  key: m.key,
  label: prettyModelName(m.openrouterIds[0]),
}));
const EXECUTOR_KEYS = ["reply", "open", "memory", "claude", "codex"] as const;

/** The brand tile for an option id. */
export function JevOptionLogo({ id, size = 28 }: { id: string; size?: number }) {
  const src = /^(haiku|sonnet|opus|fable|claude|claude-sonnet|claude-opus)$/.test(id)
    ? claudeLogo
    : id === "codex"
      ? codexLogo
      : /^(sol|luna|openai)$/.test(id)
        ? openaiLogo
        : null;
  if (src) return <img className="jc-logo" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  if (id === "memory")
    return (
      <span className="jc-logo jc-logo-page is-memory" style={{ width: size, height: size }} aria-hidden="true">
        <BrainCircuit size={Math.round(size * 0.58)} />
      </span>
    );
  if (id === "open")
    return (
      <span className="jc-logo jc-logo-page" style={{ width: size, height: size }} aria-hidden="true">
        <PanelTop size={Math.round(size * 0.55)} />
      </span>
    );
  return <JevLogo size={size} />;
}

/** Logo id for a model or runtime label, e.g. "Jev · Sonnet 5" or "GPT-6 Astra". */
export function logoIdForLabel(label: string): string {
  if (/haiku|sonnet|opus|fable|claude/i.test(label)) return "claude";
  if (/codex/i.test(label)) return "codex";
  if (/gpt|openai/i.test(label)) return "openai";
  return "jev";
}

const played = new Set<string>();
/** True once a run's reveal has played in this page session. */
export const hasPlayed = (run: string) => played.has(run);
type Phase = "think" | "fill" | "snap";
const FILL_MS = 800;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const choiceOf = (a: JevAnswer | undefined) => (a?.type === "choice" ? a : undefined);

function answerFor(d: JevDecision, key?: string): { key: string; a: Extract<JevAnswer, { type: "choice" }> } | null {
  const order = [key, "model", ...Object.keys(d.answers)].filter(Boolean) as string[];
  for (const k of order) {
    const a = d.answers[k];
    if (a?.type === "choice") return { key: k, a };
  }
  return null;
}

/** The executor lane Jev picked, from its raw answers. */
export function executorLane(d: JevDecision): ExecutorLane {
  const tier = choiceOf(d.answers.tier)?.choice ?? d.picked;
  if (tier === "tier-1") return "open";
  if (tier === "memory") return "memory";
  if (tier === "continue") return "continue";
  if (tier === "tier-3") return choiceOf(d.answers.worker)?.choice === "codex" ? "codex" : "claude";
  return "reply";
}

type View = {
  keys: string[];
  probs: Record<string, number>;
  labels: Record<string, string>;
  logos: Record<string, string>;
  winner: string;
  winLabel: string;
  winP: number;
  sub?: { label: string; p?: number };
};

// The doors for a message. Odds and pick come from one shared rule
// (src/lib/jev-executor.ts), the same one the server acted on, so the
// highlighted tile, headline and % chip always agree.
function executorView(d: JevDecision, run: JevRun): View {
  const odds = executorOdds(d, run.signedOut);
  const probs: Record<string, number> = { ...odds };
  const top = executorPick(odds);
  const continuing = run.lane === "continue";
  const chat = run.chatModel || "the chat model";
  const labels: Record<string, string> = { reply: "Quick answer", open: "Open a page", memory: "Show in Memory", claude: "Claude Code", codex: "Codex" };
  const logos: Record<string, string> = { reply: logoIdForLabel(chat), open: "open", memory: "memory", claude: "claude", codex: "codex" };
  // A follow-up shows the agent it continues; everything else shows the highest tile.
  const winner = continuing ? (/codex/i.test(run.sub?.label ?? "") ? "codex" : "claude") : top.key;
  let sub = run.sub;
  if (!sub && winner === "reply") sub = { label: chat };
  if (!sub && winner === "open") {
    const page = choiceOf(d.answers.page);
    if (page) sub = { label: d.optionLabels?.[`page:${page.choice}`] ?? page.choice, p: page.probabilities[page.choice] };
  }
  return { keys: [...EXECUTOR_KEYS], probs, labels, logos, winner, winLabel: labels[winner] ?? winner, winP: continuing ? odds.continue : top.p, sub };
}

function modelView(d: JevDecision | null, run: JevRun, candidates: JevCandidate[]): View {
  const picked = d ? answerFor(d, run.answerKey) : null;
  const labels = { ...FALLBACK_LABELS, ...Object.fromEntries(candidates.map((c) => [c.key, c.label])), ...(d?.optionLabels ?? {}) };
  const probs = picked?.a.probabilities ?? {};
  // The highest odds win, the same rule the router acts on.
  const winner = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? picked?.a.choice ?? "";
  // Tiles: the candidate order stays put, so the winner snaps forward in place.
  const keys = picked
    ? [
        ...candidates.map((c) => c.key).filter((k) => k in probs),
        ...Object.keys(probs)
          .filter((k) => !candidates.some((c) => c.key === k))
          .sort((x, y) => probs[y] - probs[x]),
      ]
    : candidates.map((c) => c.key);
  return {
    keys,
    probs,
    labels,
    logos: Object.fromEntries(keys.map((k) => [k, k])),
    winner,
    winLabel: winner ? (winner === d?.picked && d?.pickedLabel) || labels[winner] || winner : "",
    winP: winner ? (probs[winner] ?? picked?.a.confidence ?? 0) : 0,
  };
}

export function JevChoosing({
  run,
  candidates,
  minThink = 1000,
  onRevealed,
}: {
  run: JevRun;
  candidates: JevCandidate[];
  minThink?: number;
  onRevealed?: () => void;
}) {
  const { decision: d, kept, sample, extra } = run;
  const executor = run.view === "executor";
  const [phase, setPhase] = useState<Phase>(played.has(run.run) ? "snap" : "think");
  const [progress, setProgress] = useState(played.has(run.run) ? 1 : 0);
  const [open, setOpen] = useState(false);
  // Already played (the pending answer just moved into the transcript): no entrance, no replay.
  const [still] = useState(() => played.has(run.run));
  const startedAt = useRef(performance.now());
  const decidedAt = useRef<number | null>(null);
  if (d && decidedAt.current === null) decidedAt.current = performance.now();
  const revealedRef = useRef(onRevealed);
  revealedRef.current = onRevealed;

  const view = executor && d ? executorView(d, run) : modelView(d, run, candidates);
  // A quick answer or a follow-up needs no big moment: one quiet line.
  // Pages and Memory are quick moves too: never the big card.
  const quiet = executor && !!d && (view.winner === "reply" || view.winner === "open" || view.winner === "memory" || run.lane === "continue");

  useEffect(() => {
    if (!d || phase !== "think") return;
    // Executor rows first show a small "reading" line; the card then searches briefly before the odds land.
    const since = executor ? (decidedAt.current ?? performance.now()) : startedAt.current;
    const wait = quiet ? 0 : Math.max(0, (executor ? 600 : minThink) - (performance.now() - since));
    const t = window.setTimeout(() => setPhase(quiet ? "snap" : "fill"), wait);
    return () => window.clearTimeout(t);
  }, [d, phase, minThink, executor, quiet]);

  useEffect(() => {
    if (phase === "fill") {
      const start = performance.now();
      let raf = requestAnimationFrame(function tick(now) {
        const t = Math.min(1, (now - start) / FILL_MS);
        setProgress(ease(t));
        if (t < 1) raf = requestAnimationFrame(tick);
        else setPhase("snap");
      });
      return () => cancelAnimationFrame(raf);
    }
    if (phase === "snap") {
      played.add(run.run);
      setProgress(1);
      const t = window.setTimeout(() => revealedRef.current?.(), quiet ? 0 : 450);
      return () => window.clearTimeout(t);
    }
  }, [phase, run.run, quiet]);

  const settled = phase === "snap";
  const meta = d ? `${Math.round(view.winP * 100)}% · ${fmtMs(d.ms)} · ${fmtUsd(d.costUsd)}` : "";
  const card = open && d && (
    <div className="jc-card">
      <JevCard decision={d} optionLabels={view.labels} sample={sample} />
    </div>
  );

  // Executor, still reading: one small line with the four doors.
  if (executor && !d) {
    return (
      <div className="jc jc-line is-reading" aria-live="polite">
        <span className="jc-spin is-small">
          <JevLogo size={20} />
        </span>
        <span className="jc-line-text">
          <b>Jev</b> is reading your request
        </span>
        <span className="jc-mini" aria-hidden="true">
          {EXECUTOR_KEYS.map((k, i) => (
            <span key={k} style={{ ["--i" as string]: i }}>
              <JevOptionLogo id={k === "reply" ? logoIdForLabel(run.chatModel ?? "") : k} size={16} />
            </span>
          ))}
        </span>
      </div>
    );
  }

  // Quiet line: a quick answer with the chat's model, a kept model, or continuing the open task.
  if ((quiet || kept) && d && view.winner) {
    const continuing = run.lane === "continue";
    const logo = continuing ? view.winner : quiet ? view.logos[view.winner] : view.winner;
    return (
      <div className="jc jc-kept" data-still={still || undefined} data-open={open || undefined}>
        <button type="button" className="jc-kept-line" onClick={() => setOpen(!open)} aria-expanded={open}>
          <JevOptionLogo id={logo} size={20} />
          <span>
            {continuing ? (
              <>
                Continuing in <b>{view.winLabel}</b>
              </>
            ) : quiet && view.winner !== "reply" ? (
              <>
                {view.winLabel} · <b>{view.sub?.label ?? ""}</b>
              </>
            ) : quiet ? (
              <>
                Quick answer with <b>{view.sub?.label ?? run.chatModel}</b>
              </>
            ) : (
              <>
                Jev kept <b>{view.winLabel}</b> for this chat
              </>
            )}
          </span>
          <span className="jc-kept-note">
            {continuing ? "same task" : quiet ? `Jev ${Math.round(view.winP * 100)}% · ${fmtMs(d.ms)}` : "cache warm"}
          </span>
          {sample && <span className="jc-chip is-sample">Rehearsal</span>}
          <ChevronDown size={13} className="jc-chev" />
        </button>
        {card}
      </div>
    );
  }

  return (
    <div className="jc" data-phase={phase} data-still={still || undefined} data-open={open || undefined} aria-live="polite">
      <span className="jc-beam" aria-hidden="true" />
      <button
        type="button"
        className="jc-head"
        onClick={() => settled && setOpen(!open)}
        aria-expanded={settled ? open : undefined}
        aria-label={settled ? `Jev picked ${view.winLabel}, ${meta}. Show the odds.` : "Jev is choosing"}
      >
        {settled && view.winner ? (
          <>
            <span className="jc-win-logo">
              <JevOptionLogo id={view.logos[view.winner] ?? view.winner} size={30} />
            </span>
            <span className="jc-title">
              <span className="jc-kicker">
                <JevMark size={12} /> Jev picked
              </span>
              <b>
                {view.winLabel}
                {executor && view.sub && <em> · {view.sub.label}</em>}
              </b>
            </span>
            <span className="jc-meta">
              <span className="jc-chip is-odds">{Math.round(view.winP * 100)}%</span>
              {d && <span className="jc-chip">{fmtMs(d.ms)}</span>}
              {d && <span className="jc-chip">{fmtUsd(d.costUsd)}</span>}
              {extra && <span className="jc-chip is-extra">{extra}</span>}
              {sample && <span className="jc-chip is-sample">Rehearsal</span>}
              <ChevronDown size={14} className="jc-chev" />
            </span>
          </>
        ) : (
          <>
            <span className="jc-spin">
              <JevLogo size={30} />
            </span>
            <span className="jc-title">
              <span className="jc-kicker">Jev</span>
              <b>{d ? "Weighing the odds" : executor ? "Choosing who does this" : "Choosing a model"}</b>
            </span>
            <span className="jc-meta">
              <span className="jc-chip is-dim">{view.keys.length} options</span>
            </span>
          </>
        )}
      </button>
      <ol className="jc-grid" style={{ ["--n" as string]: view.keys.length }} data-kind={executor ? "executor" : "model"}>
        {view.keys.map((k, i) => {
          const p = view.probs[k] ?? 0;
          const shown = phase === "think" ? null : p * progress;
          const win = settled && k === view.winner;
          const sub = executor ? (k === "reply" ? run.chatModel : win ? view.sub?.label : undefined) : undefined;
          return (
            <li key={k} className={`jc-tile${win ? " is-win" : settled ? " is-lose" : ""}${run.signedOut?.includes(k) ? " is-off" : ""}`} style={{ ["--i" as string]: i }}>
              <JevOptionLogo id={view.logos[k] ?? k} size={28} />
              <span className="jc-name">{view.labels[k] ?? k}</span>
              {executor && <span className="jc-sub">{run.signedOut?.includes(k) ? "Sign in" : (sub ?? " ")}</span>}
              <span className="jc-bar">
                <i style={shown === null ? undefined : { width: `${Math.max(shown * 100, 2)}%` }} />
              </span>
              <span className="jc-pct">
                {shown === null ? (
                  <span className="jc-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  `${Math.round(shown * 100)}%`
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {card}
    </div>
  );
}
