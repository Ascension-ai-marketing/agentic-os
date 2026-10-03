// Memory focus: a small command API so chat and voice can take you to the
// records behind an answer. "When did I chat to Claude about pricing?" becomes
//
//   focusMemory({ source: "claude", query: "pricing" })
//   navigate({ to: "/memory" })
//
// Memory then switches view, isolates the source, highlights the matches, sets
// the timeline to cover them and flies to the best one.
import type { MemNode } from "@/components/memory-graph-3d";
import { memoryTime } from "./brain-relations";

export const MEMORY_FOCUS_EVENT = "agentic:memory-focus";
export type MemoryFocusRange =
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "1y"
  | "all"
  | { start: string | number; end: string | number };
export type MemoryFocusDetail = {
  /** A source id: claude, codex, chatgpt, email, meetings, notion, hermes, obsidian, skills. */
  source?: string;
  /** Words to find in record titles, summaries and previews. All words must match. */
  query?: string;
  /** Exact Memory record ids, when the caller already searched. */
  recordIds?: string[];
  /** Limit to a time range, and set the timeline to it. */
  range?: MemoryFocusRange;
  /** Which view to show. Defaults to timeline when the matches have dates. */
  view?: "rings" | "timeline" | "neural" | "sphere";
  /** Open the best match in the large record panel. */
  open?: boolean;
  /** Also open the record's original (Obsidian, Gmail, Outlook, Notion) on the Mac. */
  openOriginal?: boolean;
};

/** "Open it" / "open that file": opens the record Memory is showing. */
export const MEMORY_OPEN_EVENT = "agentic:memory-open";
export function openCurrentMemory() {
  window.dispatchEvent(new Event(MEMORY_OPEN_EVENT));
}

const DAY = 864e5;
const PRESET: Record<string, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };

/** Call from anywhere. Works before Memory is open: it picks the request up when it mounts. */
export function focusMemory(detail: MemoryFocusDetail) {
  (window as unknown as { __agenticMemoryFocus?: unknown }).__agenticMemoryFocus = { ...detail, at: Date.now() };
  window.dispatchEvent(new CustomEvent(MEMORY_FOCUS_EVENT, { detail }));
}
export function takePendingFocus(): MemoryFocusDetail | undefined {
  const w = window as unknown as { __agenticMemoryFocus?: MemoryFocusDetail & { at: number } };
  const pending = w.__agenticMemoryFocus;
  w.__agenticMemoryFocus = undefined;
  return pending && Date.now() - pending.at < 120000 ? pending : undefined;
}

export function focusWindow(range: MemoryFocusRange | undefined, now = Date.now()) {
  if (!range || range === "all") return undefined;
  if (typeof range === "string") return PRESET[range] ? { start: now - PRESET[range], end: now } : undefined;
  const start = typeof range.start === "number" ? range.start : Date.parse(range.start);
  const end = typeof range.end === "number" ? range.end : Date.parse(range.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : undefined;
}

// Words that say what kind of thing it is, or ask for the newest, not what it is about.
const FILLER = new Set(["the", "my", "a", "an", "that", "this", "it", "one", "up", "me", "show", "open", "find", "pull", "please", "about", "on", "for", "of", "with", "from", "in", "to", "and", "i", "we", "you", "our", "can", "could", "thing", "stuff", "again", "just", "now", "made", "created", "saved", "wrote", "had", "was", "were", "did", "is", "new", "window", "tab"]);
const KIND_WORDS = new Set(["file", "files", "doc", "docs", "document", "documents", "sheet", "sheets", "factsheet", "note", "notes", "pdf", "report", "brief", "deck", "page", "one-pager", "onepager", "record"]);
const RECENT_WORDS = /\b(today|just|latest|newest|recent|last|earlier)\b/;
/** "facts" and "fact", "sheets" and "sheet", "opening" and "open" count as the same word. */
const stem = (w: string) => w.replace(/(?:ies)$/, "y").replace(/(?:ing|es|s)$/, "").replace(/(?<=.{3})e$/, "");
const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ]+/)
    .filter((w) => w.length > 1);

/** Records that answer a focus request, most relevant first, then newest. */
export function matchMemory(nodes: MemNode[], detail: MemoryFocusDetail, now = Date.now()): MemNode[] {
  const ids = detail.recordIds?.length ? new Set(detail.recordIds) : undefined;
  const all = words(detail.query || "");
  const kindAsked = all.some((w) => KIND_WORDS.has(w));
  const recentAsked = RECENT_WORDS.test((detail.query || "").toLowerCase());
  // What it is about: everything except filler, kind words and time words.
  const want = all.filter((w) => !FILLER.has(w) && !KIND_WORDS.has(w) && !RECENT_WORDS.test(w)).map(stem);
  // Words typed with a capital ("Clay", "Notion") are names: an exact-case
  // match counts for more, so the company beats the colour.
  const names = (detail.query || "").split(/[^A-Za-z0-9À-ɏ]+/).filter((w) => w.length > 1 && /^[A-Z]/.test(w));
  const win = focusWindow(detail.range, now);
  const scored: { n: MemNode; score: number; t: number; hit: number }[] = [];
  for (const n of nodes) {
    if (n.kind === "hub" || n.categoryHub || n.kind === "workspace") continue;
    if (ids && !ids.has(n.id)) continue;
    if (detail.source && (n.origin || n.source) !== detail.source) continue;
    const t = memoryTime(n, now);
    if (win && (t == null || t < win.start || t > win.end)) continue;
    let score = 0;
    let hit = 0;
    const title = String(n.name || "");
    if (want.length) {
      const body = `${n.meta || ""} ${n.preview || ""}`;
      const titleStems = words(title.replace(/[_-]+/g, " ")).map(stem);
      const bodyStems = words(body.replace(/[_-]+/g, " ")).map(stem);
      for (const w of want) {
        const inTitle = titleStems.filter((x) => x === w || (w.length > 3 && x.startsWith(w))).length;
        const inBody = bodyStems.filter((x) => x === w || (w.length > 3 && x.startsWith(w))).length;
        if (inTitle || inBody) hit++;
        score += inTitle * 6 + Math.min(inBody, 5) * 2;
      }
      for (const name of names) {
        const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(title)) score += 8;
        else if (re.test(body)) score += 4;
      }
    }
    // A named kind ("fact sheet", "doc") favours saved files; "today" / "latest" favours the newest.
    const isFile = n.kind === "file" || (n.origin || "") === "files";
    if (kindAsked && isFile) score += 3;
    if (kindAsked && want.length === 0 && !isFile) continue;
    if (recentAsked && t != null) score += Math.max(0, 4 - (now - t) / 864e5);
    scored.push({ n, score, t: t ?? 0, hit });
  }
  if (!want.length) return scored.sort((a, b) => b.score - a.score || b.t - a.t).map((x) => x.n);
  // Every word found is best; otherwise the records that match most of the words.
  const bestHit = Math.max(0, ...scored.map((x) => x.hit));
  const needed = bestHit === want.length ? want.length : Math.max(1, Math.ceil(want.length / 2));
  return scored
    .filter((x) => x.hit >= needed && x.hit > 0)
    .sort((a, b) => b.hit - a.hit || b.score - a.score || b.t - a.t)
    .map((x) => x.n);
}

/** The time span that covers the matches, or the asked-for range. */
export function coverWindow(matches: MemNode[], detail: MemoryFocusDetail, now = Date.now()) {
  const asked = focusWindow(detail.range, now);
  if (asked) return asked;
  const times = matches.map((n) => memoryTime(n, now)).filter((t): t is number => t != null);
  if (!times.length) return undefined;
  const start = Math.min(...times),
    end = Math.max(...times);
  return { start: start - DAY / 2, end: Math.min(now, end + DAY / 2) };
}
