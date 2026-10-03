/** Wall tiles: live styles, "Made in this video" pieces and Inspiration cards. */
import type { InspirationItem } from "@/motion/collections/inspiration";
import type { MadeItem } from "@/motion/collections/made";
import type { MotionRunner, TileHandle } from "@/motion/engine/runner";
import type { MotionStyle, Theme } from "@/motion/engine/types";
import { ArrowUpRight, Check, Copy, FileText, Maximize2, Plus, Undo2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { MIME_ITEM } from "./composer";

export function taglineOf(s: MotionStyle): string {
  if (s.tagline) return s.tagline;
  // Fallback for styles without a tagline: the look up to its first pause.
  const first = s.look.split(/[:;,.—–]/)[0].trim();
  return first.length <= 38 ? first : first.split(" ").slice(0, 5).join(" ");
}

/** Snapshot a tile canvas as a small JPEG for its chip. */
export function thumbOf(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas || canvas.width <= 1) return null;
  try {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 54;
    c.getContext("2d")?.drawImage(canvas, 0, 0, 96, 54);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

function TileShell({
  id,
  index,
  name,
  tagline,
  badge,
  selected,
  promptOf,
  onToggle,
  onOpen,
  onCopy,
  children,
}: {
  id: string;
  index: number;
  name: string;
  tagline: string;
  badge?: string;
  selected: boolean;
  promptOf: () => string;
  onToggle: () => void;
  onOpen: () => void;
  onCopy: () => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const copy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (await onCopy()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <article className={`ml-tile ${selected ? "selected" : ""} ${flipped ? "flipped" : ""}`}>
      <div className="ml-flip">
        <div
          className="ml-face ml-front"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(MIME_ITEM, id);
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          <button
            className="ml-frame"
            onClick={onToggle}
            aria-pressed={selected}
            aria-label={`${selected ? "Remove" : "Add"} ${name} ${selected ? "from" : "to"} your prompt`}
            data-item={id}
          >
            {children}
            <span className="ml-pick" aria-hidden="true">
              {selected ? <Check size={14} strokeWidth={3} /> : <Plus size={14} />}
              {selected ? "In your prompt" : "Add to prompt"}
            </span>
          </button>
          <div className="ml-tile-actions">
            <button
              className="ml-glass"
              onClick={() => setFlipped(true)}
              aria-label={`Show the ${name} prompt`}
              title="Show prompt"
            >
              <FileText size={13} /> <span className="ml-lbl">Show prompt</span>
            </button>
            <button
              className="ml-glass"
              onClick={onOpen}
              aria-label={`Preview ${name}`}
              title="Preview"
            >
              <Maximize2 size={13} /> <span className="ml-lbl">Preview</span>
            </button>
            <button
              className={`ml-glass ${copied ? "done" : ""}`}
              onClick={copy}
              aria-label={`Copy the ${name} prompt`}
              title="Copy prompt"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span className="ml-lbl">{copied ? "Copied" : "Copy prompt"}</span>
            </button>
          </div>
        </div>
        <div className="ml-face ml-back" aria-hidden={!flipped}>
          <div className="ml-back-head">
            <b>{name}</b>
            <span className="ml-back-tools">
              <button className="ml-btn small" onClick={copy} tabIndex={flipped ? 0 : -1}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                className="ml-btn small ghost"
                onClick={() => setFlipped(false)}
                tabIndex={flipped ? 0 : -1}
                aria-label="Back to the preview"
              >
                <Undo2 size={13} /> Back
              </button>
            </span>
          </div>
          <pre tabIndex={flipped ? 0 : -1}>{flipped ? promptOf() : ""}</pre>
        </div>
      </div>
      <div className="ml-meta">
        <span className="ml-num">{String(index + 1).padStart(2, "0")}</span>
        <h3>
          {name}
          {badge && <span className="ml-featured">{badge}</span>}
        </h3>
        <p>{tagline}</p>
      </div>
    </article>
  );
}

/** A live style tile (or a live "Made" code piece). */
export const LiveTile = memo(function LiveTile({
  style,
  itemId,
  index,
  theme,
  badge,
  selected,
  promptOf,
  ensureRunner,
  onToggle,
  onOpen,
  onCopy,
}: {
  style: MotionStyle;
  itemId: string;
  index: number;
  theme: Theme;
  badge?: string;
  selected: boolean;
  promptOf: (id: string) => string;
  ensureRunner: () => MotionRunner;
  onToggle: (id: string, thumb: string | null) => void;
  onOpen: (id: string) => void;
  onCopy: (id: string) => Promise<boolean>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<TileHandle | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    handle.current = ensureRunner().attach(canvas.current, {
      style,
      theme,
      maxWidth: 760,
      fps: 30,
    });
    return () => {
      handle.current?.detach();
      handle.current = null;
    };
    // Theme updates are pushed by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, ensureRunner]);
  useEffect(() => {
    handle.current?.update({ theme });
  }, [theme]);
  return (
    <TileShell
      id={itemId}
      index={index}
      name={style.name}
      tagline={taglineOf(style)}
      badge={badge}
      selected={selected}
      promptOf={() => promptOf(itemId)}
      onToggle={() => onToggle(itemId, thumbOf(canvas.current))}
      onOpen={() => onOpen(itemId)}
      onCopy={() => onCopy(itemId)}
    >
      <canvas ref={canvas} aria-hidden="true" />
    </TileShell>
  );
});

/** A muted preview loop that only plays while on screen. */
export function LoopVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!v.src) v.src = src;
          void v.play().catch(() => undefined);
        } else v.pause();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [src]);
  return (
    <video
      ref={ref}
      className={className}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
    />
  );
}

export const MadeVideoTile = memo(function MadeVideoTile({
  item,
  index,
  selected,
  onToggle,
  onOpen,
  onCopy,
}: {
  item: MadeItem;
  index: number;
  selected: boolean;
  onToggle: (id: string, thumb: string | null) => void;
  onOpen: (id: string) => void;
  onCopy: (id: string) => Promise<boolean>;
}) {
  if (item.source.kind !== "video") return null;
  const { src, poster } = item.source;
  const id = `made-${item.id}`;
  return (
    <TileShell
      id={id}
      index={index}
      name={item.name}
      tagline={item.tagline}
      badge={item.group}
      selected={selected}
      promptOf={() => item.prompt}
      onToggle={() => onToggle(id, poster)}
      onOpen={() => onOpen(id)}
      onCopy={() => onCopy(id)}
    >
      <LoopVideo src={src} poster={poster} />
    </TileShell>
  );
});

/** An Inspiration card: credit first, the official embed loaded only on screen. */
export function InspirationCard({ item }: { item: InspirationItem }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState(false);
  const [height, setHeight] = useState(item.platform === "YouTube" ? 0 : 560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setLoad(true), {
      rootMargin: "300px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // X's embed reports its height by postMessage; size the frame to fit.
  useEffect(() => {
    if (item.platform !== "X") return;
    const on = (e: MessageEvent) => {
      if (e.origin !== "https://platform.twitter.com" || e.source !== frame.current?.contentWindow)
        return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const params = data?.["twttr.embed"]?.params?.[0];
        if (data?.["twttr.embed"]?.method === "twttr.private.resize" && params?.height)
          setHeight(Math.min(900, Math.ceil(params.height)));
      } catch {
        /* not an embed message */
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [item.platform]);
  return (
    <article className="ml-insp">
      <div
        className="ml-insp-embed"
        ref={box}
        style={item.platform === "X" ? { height } : undefined}
      >
        {load && item.embed ? (
          <iframe
            ref={frame}
            src={item.embed}
            title={`${item.title} by ${item.author}`}
            loading="lazy"
            referrerPolicy={
              item.platform === "YouTube" ? "strict-origin-when-cross-origin" : "no-referrer"
            }
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            className={item.platform === "YouTube" ? "yt" : "x"}
          />
        ) : (
          <div className="ml-insp-wait">{item.platform}</div>
        )}
      </div>
      <div className="ml-insp-meta">
        <span className="ml-insp-tag">{item.tag}</span>
        <h3>{item.title}</h3>
        <p>{item.blurb}</p>
        <div className="ml-insp-credit">
          <span>
            {item.author} <em>{item.handle}</em>
          </span>
          <span>
            {item.platform} ·{" "}
            {new Date(item.date + "T12:00:00Z").toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <a href={item.url} target="_blank" rel="noreferrer">
            Open <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
    </article>
  );
}
