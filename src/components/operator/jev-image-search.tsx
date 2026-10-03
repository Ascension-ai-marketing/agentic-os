// Jev on image search: the ranking moment, the ranked line, and a rehearsal
// mode (?jevDemo=1, dev only) that plays the same thing over the real local
// images with simulated odds, so filming never calls OpenRouter.
import { useState } from "react";
import { JevCard, JevMark, fmtMs, fmtUsd } from "@/components/jev/jev-card";
import type { JevDecision } from "@/lib/jev-types";
import "./jev-image-search.css";

export type JevRankStats = {
  count: number;
  ms: number;
  costUsd: number;
  sample: boolean;
  top: Array<{ id: string; name: string; score: number }>;
};

/** Dev-only rehearsal switch. Never on in a production build. */
export function jevDemoEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("jevDemo") === "1";
  } catch {
    return false;
  }
}

// Jev's measured cost for one image-description match (sample-reels and
// sample-image calls on 28 Sep 2026 sat around $0.000019 each).
const SAMPLE_COST_PER_IMAGE = 0.0000186;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/**
 * Simulated odds over real files. Local, free matches (file name, folder,
 * saved description, words in the image) score high; everything else gets a
 * low, stable score. Nothing leaves the machine.
 */
export function simulateJevRanking(
  query: string,
  images: Array<{ id: string; path: string; name: string; project: string }>,
  localHits: Array<{ id: string; path: string; score: number }>,
) {
  const q = query.toLowerCase();
  const terms = q.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const local = new Map(localHits.map((h) => [h.id, h.score]));
  const maxLocal = Math.max(1, ...localHits.map((h) => h.score));
  const pool = new Map<string, { id: string; path: string; name: string }>();
  for (const h of localHits) pool.set(h.id, { id: h.id, path: h.path, name: h.path.split(/[/\\]/).pop() ?? "" });
  for (const m of images) pool.set(m.id, m);
  const ranked = [...pool.values()].slice(0, 200).map((m) => {
    const words = `${m.name} ${(m as { project?: string }).project ?? ""}`.toLowerCase();
    const nameHit = terms.length > 0 && terms.every((t) => words.includes(t));
    const lex = local.get(m.id);
    const jitter = hash(`${q}|${m.id}`);
    let score = 0.02 + jitter * 0.18;
    if (lex !== undefined) score = 0.62 + 0.35 * Math.min(1, lex / maxLocal) - jitter * 0.04;
    else if (nameHit) score = 0.58 + jitter * 0.2;
    return { id: m.id, path: m.path, score: Math.max(0.01, Math.min(0.99, score)) };
  });
  ranked.sort((a, b) => b.score - a.score);
  const hits = ranked.filter((r) => r.score >= 0.5).map((r) => ({ id: r.id, path: r.path, desc: "", why: "meaning", score: r.score }));
  return {
    hits,
    stats: { count: ranked.length, ms: 520 + Math.round(hash(q) * 180), costUsd: ranked.length * SAMPLE_COST_PER_IMAGE },
  };
}

/** Shown while Jev ranks: the mark pulses, a scan ring sweeps, a count ticks. */
export function JevRankingStage({ count, query }: { count: number; query: string }) {
  return (
    <div className="jis-stage" role="status" aria-live="polite">
      <span className="jis-orb" aria-hidden>
        <span className="jis-ring" />
        <span className="jis-ring jis-ring-2" />
        <span className="jis-sweep" />
        <JevMark size={26} />
      </span>
      <span className="jis-stage-text">
        <b>Jev is ranking {count > 0 ? count.toLocaleString() : ""} images</b>
        <span>Odds for “{query}” on every saved description</span>
      </span>
    </div>
  );
}

/** One quiet line after a ranking; opens Jev's odds for the top matches. */
export function JevRankedLine({ stats, query }: { stats: JevRankStats; query: string }) {
  const [open, setOpen] = useState(false);
  const top = stats.top.slice(0, 5);
  const decision: JevDecision | null = top.length
    ? {
        id: `rank-${query}-${stats.count}`,
        at: new Date().toISOString(),
        surface: "image-search",
        purpose: `How well does each image match “${query}”?`,
        input: `${stats.count} saved image descriptions`,
        answers: {
          match: {
            type: "choice",
            choice: top[0].id,
            probabilities: Object.fromEntries(top.map((t) => [t.id, t.score])),
            confidence: top[0].score,
          },
        },
        picked: top[0].id,
        pickedLabel: top[0].name,
        escalated: false,
        ms: stats.ms,
        costUsd: stats.costUsd,
      }
    : null;
  return (
    <div className="jis-line-wrap">
      <button type="button" className="jis-line" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={!decision}>
        <JevMark size={15} />
        <span>
          Jev ranked <b>{stats.count.toLocaleString()}</b> images in <b>{fmtMs(stats.ms)}</b> · {fmtUsd(stats.costUsd)}
        </span>
        {stats.sample && <span className="jis-sample">Sample</span>}
        {decision && <span className="jis-line-more">{open ? "Hide odds" : "See the odds"}</span>}
      </button>
      {open && decision && (
        <div className="jis-card">
          <JevCard
            decision={decision}
            live
            sample={stats.sample}
            optionLabels={Object.fromEntries(top.map((t) => [t.id, t.name]))}
          />
        </div>
      )}
    </div>
  );
}

/** The match chip on a ranked tile. */
export function JevMatchChip({ score, best }: { score: number; best: boolean }) {
  return (
    <span className={`jis-chip${best ? " is-best" : ""}`}>
      {best && <JevMark size={11} />}
      {best ? "Best match · " : ""}
      {Math.round(score * 100)}%
    </span>
  );
}

/**
 * Load the top results before they are revealed and leave out any file that
 * cannot be shown (moved, unreadable, not an image the browser can decode),
 * so Jev never presents an empty tile as a match. Slow files are kept.
 */
export async function dropUnshowable<T extends { id: string; path: string }>(
  hits: T[],
  urlFor: (id: string) => string,
  top = 24,
  capMs = 2500,
): Promise<T[]> {
  if (typeof Image === "undefined") return hits;
  const isVideo = (p: string) => /\.(mp4|mov|webm|m4v)$/i.test(p);
  const probe = (h: T) =>
    new Promise<boolean>((resolve) => {
      if (isVideo(h.path)) return resolve(true);
      let tries = 0;
      const load = () => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => (++tries < 2 ? window.setTimeout(load, 400) : resolve(false));
        img.src = `${urlFor(h.id)}${tries ? `&retry=${tries}` : ""}`;
      };
      load();
      window.setTimeout(() => resolve(true), capMs);
    });
  const head = hits.slice(0, top);
  const ok = await Promise.all(head.map(probe));
  const bad = new Set(head.filter((_, i) => !ok[i]).map((h) => h.id));
  return bad.size ? hits.filter((h) => !bad.has(h.id)) : hits;
}
