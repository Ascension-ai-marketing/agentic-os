// Brain record panel: what opens when you click a memory. Source logo, title,
// day, a short preview and a small map of the records it relates to in other
// sources. Every related record is one click away.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Maximize2, MessageSquare, X } from "lucide-react";
import type { MemNode } from "@/components/memory-graph-3d";
import type { Relation } from "./brain-relations";
import { memoryTime } from "./brain-relations";
import { BrainSourceLogo } from "./brain-source";
import "./brain-record-panel.css";

/** Where the record lives, when there is a place to open it. */
export function originalLink(node: MemNode): { href: string; label: string } | undefined {
  const origin = node.origin || node.source || "";
  const title = readableTitle(node.name);
  if (origin === "obsidian" && node.kind !== "workspace")
    return { href: `obsidian://search?query=${encodeURIComponent(title)}`, label: "Open in Obsidian" };
  if (origin === "email" && /gmail/i.test(node.meta || ""))
    return { href: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`subject:"${node.name}"`)}`, label: "Open in Gmail" };
  if (origin === "email" && /outlook/i.test(node.meta || ""))
    return { href: `https://outlook.office.com/mail/search/q=${encodeURIComponent(node.name)}`, label: "Open in Outlook" };
  if (origin === "notion")
    return { href: node.url || `https://www.notion.so/search?q=${encodeURIComponent(title)}`, label: "Open in Notion" };
  if (origin === "meetings" && node.url?.startsWith("https://notes.granola.ai/"))
    return { href: node.url, label: "Open in Granola" };
  if (node.url) return { href: node.url, label: "Open original" };
  return undefined;
}

export type RelatedRecord = { node: MemNode; reasons: string[]; score?: number };

/** "project_fable_routing_pages" reads as "Fable routing pages". */
export function readableTitle(name: string) {
  if (/\s/.test(name.trim()) || !/[_-]/.test(name)) return name;
  const words = name
    .replace(/\.md$/i, "")
    .replace(/^(project|feedback|reference|user)[_-]/i, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

const DAY = 864e5;
export function recordDay(n: MemNode, now = Date.now()) {
  const t = memoryTime(n, now);
  if (t == null) return null;
  const date = new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const days = Math.floor((now - t) / DAY);
  const ago = days < 1 ? "today" : days === 1 ? "yesterday" : days < 45 ? `${days} days ago` : "";
  return ago ? `${date} · ${ago}` : date;
}

const KIND: Record<string, string> = {
  file: "Note",
  decision: "Decision",
  session: "Session",
  skill: "Skill",
  workspace: "Group",
};

function RelationMap({
  center,
  related,
  colorOf,
  labelOf,
  active,
  onHover,
  onSelect,
}: {
  center: MemNode;
  related: RelatedRecord[];
  colorOf: (n: MemNode) => string;
  labelOf: (origin: string) => string;
  active: string | null;
  onHover: (id: string | null) => void;
  onSelect: (n: MemNode) => void;
}) {
  const W = 320,
    H = 172,
    cx = W / 2,
    cy = 50;
  const shown = related.slice(0, 7);
  const n = shown.length;
  const step = n > 1 ? Math.min(0.32, 0.8 / (n - 1)) : 0;
  const spots = shown.map((r, i) => {
    // Related records fan out below the record, nearest first in the middle.
    const ang = Math.PI * (0.5 + (i - (n - 1) / 2) * step);
    return { r, x: cx + Math.cos(ang) * 128, y: cy + Math.sin(ang) * 72 };
  });
  const origin = center.origin || center.source || "";
  // The same brand tile as everywhere else, placed in the map.
  const logo = (o: string, x: number, y: number, size: number, ring: string, on = false) => (
    <>
      <rect
        x={x - size / 2 - 3}
        y={y - size / 2 - 3}
        width={size + 6}
        height={size + 6}
        rx={(size + 6) * 0.3}
        fill="none"
        stroke={ring}
        strokeWidth={on ? 2 : 1.2}
        opacity={on ? 1 : 0.8}
      />
      <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size}>
        <BrainSourceLogo origin={o} size={size} />
      </foreignObject>
    </>
  );
  return (
    <svg
      className="brp-map"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${shown.length} related records`}
    >
      <defs>
        <radialGradient id="brp-glow">
          <stop offset="0" stopColor={colorOf(center)} stopOpacity="0.35" />
          <stop offset="1" stopColor={colorOf(center)} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={44} fill="url(#brp-glow)" />
      {spots.map(({ r, x, y }) => {
        const on = active === r.node.id;
        return (
          <path
            key={`l-${r.node.id}`}
            d={`M${cx},${cy} Q${(cx + x) / 2 + (x - cx) * 0.1},${cy + (y - cy) * 0.15} ${x},${y}`}
            className="brp-map-link"
            data-on={on || undefined}
            stroke={on ? "#F386A1" : colorOf(r.node)}
          />
        );
      })}
      {spots.map(({ r, x, y }) => {
        const o = r.node.origin || r.node.source || "";
        const on = active === r.node.id;
        return (
          <g
            key={r.node.id}
            className="brp-map-node"
            data-on={on || undefined}
            tabIndex={0}
            role="button"
            aria-label={`Open ${readableTitle(r.node.name)}`}
            onMouseEnter={() => onHover(r.node.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(r.node.id)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(r.node)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(r.node);
              }
            }}
          >
            {logo(o, x, y, on ? 24 : 22, on ? "#F386A1" : colorOf(r.node), on)}
            {(n <= 4 || on) && (
              <text x={x} y={y + 28} textAnchor="middle" className="brp-map-label">
                {(() => {
                  const t = readableTitle(r.node.name);
                  return t.length > 15 ? t.slice(0, 14) + "…" : t;
                })()}
              </text>
            )}
          </g>
        );
      })}
      {logo(origin, cx, cy, 32, colorOf(center), true)}
      {!shown.length && (
        <text x={cx} y={cy + 44} textAnchor="middle" className="brp-map-label">
          No links to other sources yet
        </text>
      )}
    </svg>
  );
}

/** A file the OS saved for you, which Memory can show live. */
const livePreview = (href?: string) => (href && /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/__memory_file\/[\w.-]+\.html$/.test(href) ? href : undefined);

/**
 * The top of the record: a live miniature of a saved file you can open, or the
 * source's own tile (logo on its colour) for everything else. No diagrams.
 */
function RecordHero({ node, origin, label, original, related }: { node: MemNode; origin: string; label: string; original?: { href: string; label: string }; related: number }) {
  const live = livePreview(original?.href || node.url);
  // The page renders at desktop size and is scaled down to fit the panel.
  const frameRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.23);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1280);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [live]);
  if (live)
    return (
      <a className="brp-hero is-live" href={live} target="_blank" rel="noreferrer" aria-label="Open in a new window">
        <span className="brp-frame" aria-hidden="true" ref={frameRef}>
          <iframe src={live} title="" tabIndex={-1} sandbox="" loading="lazy" style={{ transform: `scale(${scale})` }} />
        </span>
        <span className="brp-hero-cta">
          <ArrowUpRight size={13} /> Open in new window
        </span>
      </a>
    );
  return (
    <div className="brp-hero is-source" aria-hidden="true">
      <span className="brp-hero-glow" />
      <span className="brp-hero-tile">
        <BrainSourceLogo origin={origin} size={40} />
      </span>
      <span className="brp-hero-meta">
        <b>{label}</b>
        <small>{related ? `Linked to ${related} ${related === 1 ? "record" : "records"} in other sources` : "Saved in your Memory"}</small>
      </span>
    </div>
  );
}

export function BrainRecordPanel({
  node,
  related,
  sameSource,
  text,
  error,
  colorOf,
  labelOf,
  onSelect,
  onClose,
  onChat,
  onOpenSource,
  dashboardLink,
  large = false,
  onExpand,
}: {
  /** The full view: wide, the whole text, every related record. */
  large?: boolean;
  onExpand?: () => void;
  node: MemNode;
  related: RelatedRecord[];
  sameSource: MemNode[];
  text: string;
  error?: string;
  colorOf: (n: MemNode) => string;
  labelOf: (origin: string) => string;
  onSelect: (n: MemNode) => void;
  onClose: () => void;
  onChat: () => void;
  onOpenSource?: () => void;
  dashboardLink?: React.ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const origin = node.origin || node.source || "";
  const color = colorOf(node);
  const day = recordDay(node);
  const title = readableTitle(node.name);
  // Readable text: no image links, no signed file URLs, no front matter fences.
  const preview = (text || node.preview || node.meta || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]*)\)/g, "$1")
    .replace(/https?:\/\/\S{80,}/g, "")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const original = originalLink(node);
  return (
    <aside
      className={`brain-record-panel${large ? " is-large" : ""}`}
      aria-label={`Memory: ${title}`}
      style={{ ["--src" as string]: color }}
    >
      <header className="brp-head">
        <BrainSourceLogo origin={origin} color={color} size={28} />
        <div className="brp-source">
          <b>{labelOf(origin)}</b>
          <span>{node.categoryHub ? "Source" : origin === "files" ? "Document" : KIND[node.kind] || node.kind}</span>
        </div>
        {!large && onExpand && (
          <button className="brp-expand" onClick={onExpand} title="Open the full view">
            <Maximize2 size={13} />
          </button>
        )}
        <button className="brp-close" aria-label="Close memory details" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <h3 className="brp-title">{title}</h3>
      <p className="brp-day">{day || "Date not recorded"}</p>
      {!node.categoryHub && <RecordHero node={node} origin={origin} label={labelOf(origin)} original={original} related={related.length} />}
      {preview && <p className="brp-preview">{preview.slice(0, large ? 20000 : 600)}</p>}
      {error && (
        <p className="brp-error" role="alert">
          {error}
        </p>
      )}
      <div className="brp-actions">
        <button className="op-button primary" onClick={onChat}>
          <MessageSquare size={13} />
          Chat about this
        </button>
        {onOpenSource && (
          <button className="op-button" onClick={onOpenSource}>
            <BookOpen size={13} />
            Open source
          </button>
        )}
        {dashboardLink}
        {original && (
          <a className="op-button" href={original.href} target="_blank" rel="noreferrer">
            <ArrowUpRight size={13} />
            {original.label}
          </a>
        )}
      </div>
      {!!related.length && (
        <section className="brp-list">
          <h4>
            Related in other sources <small>{related.length}</small>
          </h4>
          {related.map((r) => {
            const o = r.node.origin || r.node.source || "";
            const d = recordDay(r.node);
            return (
              <button
                key={r.node.id}
                className="brp-row"
                data-on={active === r.node.id || undefined}
                onMouseEnter={() => setActive(r.node.id)}
                onMouseLeave={() => setActive(null)}
                onClick={() => onSelect(r.node)}
              >
                <BrainSourceLogo origin={o} color={colorOf(r.node)} size={20} />
                <span className="brp-row-text">
                  <b>{readableTitle(r.node.name)}</b>
                  <small>
                    {r.reasons[0]}
                    {d ? ` · ${d.split(" · ")[0]}` : ""}
                  </small>
                </span>
                <ArrowUpRight size={12} />
              </button>
            );
          })}
        </section>
      )}
      {!!sameSource.length && (
        <section className="brp-list">
          <h4>
            Linked in {labelOf(origin)} <small>{sameSource.length}</small>
          </h4>
          {sameSource.slice(0, 6).map((n) => (
            <button key={n.id} className="brp-row is-quiet" onClick={() => onSelect(n)}>
              <i style={{ background: colorOf(n) }} />
              <span className="brp-row-text">
                <b>{readableTitle(n.name)}</b>
              </span>
              <ArrowUpRight size={12} />
            </button>
          ))}
        </section>
      )}
    </aside>
  );
}
