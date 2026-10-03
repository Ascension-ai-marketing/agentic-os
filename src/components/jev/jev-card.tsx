// The Jev card: the one on-screen moment every Jev feature shares.
// It answers, at a glance: what was asked, what Jev picked, how sure,
// how fast, how cheap, and what the slow model would have cost.
import { useEffect, useId, useState } from "react";
import type { JevAnswer, JevDecision, JevSurface } from "@/lib/jev-types";
import "./jev-card.css";

export type JevCardProps = {
  decision: JevDecision;
  compact?: boolean;
  // Animate the bars in, as if the decision just landed.
  live?: boolean;
  // Friendly names for option ids, e.g. { "tier-2": "Quick answer" }.
  optionLabels?: Record<string, string>;
  // What a text model wrote for the same question. Shows the contrast
  // between a sentence and a set of odds.
  llmSays?: string;
  // Marks the decision as a stored sample rather than a live call.
  sample?: boolean;
};

const SURFACE_LABEL: Record<JevSurface, string> = {
  voice: "Voice",
  router: "Model router",
  inbox: "Inbox",
  "image-search": "Image search",
  reels: "Reels",
  slop: "Slop check",
};

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n === 0) return "$0";
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  // Two significant figures for fractions of a cent: $0.000017, $0.0023.
  const digits = Math.max(2, 1 - Math.floor(Math.log10(n)));
  return `$${n.toFixed(digits)}`;
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function ratio(a: number, b: number): string | null {
  if (!(a > 0) || !(b > 0)) return null;
  const r = a / b;
  if (r < 1.5) return null;
  return r >= 10 ? `${Math.round(r)}x` : `${r.toFixed(1)}x`;
}

function headlineKey(d: JevDecision): string {
  const keys = Object.keys(d.answers);
  const hit = keys.find((k) => {
    const a = d.answers[k];
    return a.type === "choice" && a.choice === d.picked;
  });
  return hit ?? keys[0] ?? "";
}

function legendOf(a: Extract<JevAnswer, { type: "score" }>): Record<string, string> {
  if (!a.legend) return {};
  if (Array.isArray(a.legend)) return Object.fromEntries(a.legend.map((v, i) => [String(i), v]));
  return a.legend;
}

type Row = { id: string; label: string; p: number; win: boolean };

function rowsFor(a: JevAnswer, labels: Record<string, string>): Row[] {
  if (a.type === "noul") {
    return [
      { id: "yes", label: "Yes", p: a.noul, win: a.noul >= 0.5 },
      { id: "no", label: "No", p: 1 - a.noul, win: a.noul < 0.5 },
    ];
  }
  if (a.type === "score") {
    const legend = legendOf(a);
    const top = Math.round(a.score);
    return Object.entries(a.probabilities)
      .sort((x, y) => Number(x[0]) - Number(y[0]))
      .map(([k, p]) => ({ id: k, label: legend[k] ?? `Level ${k}`, p, win: Number(k) === top }));
  }
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .map(([k, p]) => ({ id: k, label: labels[k] ?? k, p, win: k === a.choice }));
}

// The odds shown for the pick. Uses the pick's own probability so the pill
// and the bars always show the same number (Jev's separate `confidence`
// field drives escalation on the server, not the display).
// Long option lists (sound effects, email piles) end in a tail of 0% rows.
// Keep the top four plus anything above 1%, and fold the rest into one line.
function visibleRows(rows: Row[]): { shown: Row[]; hidden: number } {
  if (rows.length <= 4) return { shown: rows, hidden: 0 };
  const shown = rows.filter((r, i) => i < 3 || r.win || r.p >= 0.01);
  return { shown, hidden: rows.length - shown.length };
}

function sureOf(a: JevAnswer): number {
  if (a.type === "noul") return Math.max(a.noul, 1 - a.noul);
  if (a.type === "choice") return a.probabilities[a.choice] ?? a.confidence;
  return a.probabilities[String(Math.round(a.score))] ?? a.confidence;
}

/**
 * The Jev mark: a lowercase j whose dot is a choice. Three options sit in a
 * row; the faint two are the ones Jev weighed, the bright one it picked, and
 * the j runs from the pick. Reads at 14px and at 64px.
 * `gradient` paints it in Jev pink; otherwise it follows currentColor.
 */
export function JevMark({ size = 18, gradient = false }: { size?: number; gradient?: boolean }) {
  const id = useId().replace(/:/g, "");
  const ink = gradient ? `url(#jevg${id})` : "currentColor";
  return (
    <svg className="jev-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {gradient && (
        <defs>
          <linearGradient id={`jevg${id}`} x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F386A1" />
            <stop offset="1" stopColor="#D45BB6" />
          </linearGradient>
        </defs>
      )}
      <path d="M16.6 9v5.6a4.9 4.9 0 0 1-9.8 0" stroke={ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="5.4" cy="4.6" r="1.55" fill={ink} opacity="0.32" />
      <circle cx="11" cy="4.6" r="1.55" fill={ink} opacity="0.55" />
      <circle cx="16.6" cy="4.6" r="2.5" fill={ink} />
    </svg>
  );
}

/** The Jev app tile: dark glass, pink hairline, gradient mark. */
export function JevLogo({ size = 28 }: { size?: number }) {
  return (
    <span className="jev-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }} aria-hidden="true">
      <JevMark size={Math.round(size * 0.68)} gradient />
    </span>
  );
}

function useArmed(live: boolean | undefined, id: string) {
  const [armed, setArmed] = useState(!live);
  useEffect(() => {
    if (!live) return;
    setArmed(false);
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)));
    return () => cancelAnimationFrame(t);
  }, [live, id]);
  return armed;
}

export function JevCard({ decision: d, compact, live, optionLabels = {}, llmSays, sample }: JevCardProps) {
  const armed = useArmed(live, d.id);
  const key = headlineKey(d);
  const head = d.answers[key];
  const others = Object.entries(d.answers).filter(([k]) => k !== key);
  const faster = d.compare ? ratio(d.compare.ms, d.ms) : null;
  const cheaper = d.compare ? ratio(d.compare.costUsd, d.costUsd) : null;
  const picked = d.pickedLabel ?? optionLabels[d.picked] ?? d.picked;
  const vis = head ? visibleRows(rowsFor(head, optionLabels)) : { shown: [], hidden: 0 };

  if (compact) {
    return (
      <span className="jev-pill" data-jev-card={d.surface} title={d.purpose}>
        <JevMark size={13} />
        <b>{picked}</b>
        {head && <span className="jev-pill-sure">{Math.round(sureOf(head) * 100)}%</span>}
        <span className="jev-pill-meta">
          {fmtMs(d.ms)} · {fmtUsd(d.costUsd)}
        </span>
        {d.escalated && <span className="jev-pill-flag">Claude checked</span>}
      </span>
    );
  }

  return (
    <article className={`jev-card${armed ? " is-armed" : ""}`} data-jev-card={d.surface} aria-label={`Jev decision: ${d.purpose}`}>
      <header className="jev-card-top">
        <span className="jev-brand">
          <JevMark />
          Jev
          <span className="jev-surface">{SURFACE_LABEL[d.surface]}</span>
          {sample && <span className="jev-tag">Sample</span>}
        </span>
        <span className="jev-speed">
          <b>{fmtMs(d.ms)}</b>
          <span>{fmtUsd(d.costUsd)}</span>
        </span>
      </header>

      <h3 className="jev-q">{d.purpose}</h3>
      <p className="jev-in">{d.input}</p>

      {d.error ? (
        <p className="jev-error">Jev could not answer: {d.error}</p>
      ) : (
        head && (
          <ol className="jev-rows" aria-label="Odds for each option">
            {vis.shown.map((r, i) => (
              <li key={r.id} className={r.win ? "is-win" : undefined} style={{ ["--i" as string]: i }}>
                <span className="jev-row-label">{r.label}</span>
                <span className="jev-row-track">
                  <span className="jev-row-fill" style={{ width: armed ? `${Math.max(r.p * 100, 0.8)}%` : "0%" }} />
                </span>
                <span className="jev-row-p">{Math.round(r.p * 100)}%</span>
              </li>
            ))}
            {vis.hidden > 0 && (
              <li className="jev-rows-more">+ {vis.hidden} more at 0%</li>
            )}
          </ol>
        )
      )}

      {others.length > 0 && (
        <div className="jev-extra">
          {others.map(([k, a]) => {
            const win = rowsFor(a, optionLabels).find((r) => r.win);
            return (
              <span key={k} className="jev-extra-item">
                <span>{k.replace(/[_-]/g, " ")}</span>
                <b>{win?.label}</b>
                <span>{Math.round(sureOf(a) * 100)}% sure</span>
              </span>
            );
          })}
        </div>
      )}

      {d.escalated && head && (
        <p className="jev-escalated">Jev was only {Math.round(sureOf(head) * 100)}% sure, so Claude made the call.</p>
      )}

      {(llmSays || d.compare) && (
        <div className="jev-vs">
          <span className="jev-vs-label">{d.compare ? `${d.compare.model} on the same question` : "A text model on the same question"}</span>
          {llmSays && <q className="jev-vs-quote">{llmSays}</q>}
          {d.compare && (
            <span className="jev-vs-meta">
              {fmtMs(d.compare.ms)} · {fmtUsd(d.compare.costUsd)}
              {d.compare.kind === "estimated" && <span className="jev-tag">Estimate</span>}
            </span>
          )}
        </div>
      )}

      {(faster || cheaper) && (
        <footer className="jev-win">
          {faster && (
            <span>
              <b>{faster}</b> faster
            </span>
          )}
          {cheaper && (
            <span>
              <b>{cheaper}</b> cheaper
            </span>
          )}
          <span className="jev-win-note">{d.compare?.kind === "measured" ? "measured" : "estimated"}</span>
        </footer>
      )}
    </article>
  );
}
