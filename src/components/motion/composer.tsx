/**
 * The one box. Pick styles (click or drag tiles), drop or paste images,
 * videos, links and logos, set the length, keep Auto-enhance on, choose where
 * the prompt opens, then "Write prompt".
 */
import { Check, Film, Globe2, ImageIcon, Info, Link2, Loader2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Status } from "./api";
import type { Chip, Seconds } from "./library-types";
import { OpenInPicker, type Target } from "./shared";

export const MIME_ITEM = "application/x-motion-item";

export interface ComposerProps {
  text: string;
  setText: (t: string) => void;
  chips: Chip[];
  onRemove: (key: string) => void;
  onToggleLogo: (key: string) => void;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => void;
  onItem: (id: string) => void;
  onOpenChip: (id: string) => void;
  seconds: Seconds;
  setSeconds: (s: Seconds) => void;
  enhance: boolean;
  setEnhance: (on: boolean) => void;
  target: Target;
  setTarget: (t: Target) => void;
  status: Status | null;
  writing: boolean;
  onWrite: () => void;
  docked: boolean;
}

const URL_ONLY = /^\s*(https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?)\s*$/i;

function RiseInfo({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const rows: [string, string][] = [
    ["R", "References"],
    ["I", "Idea"],
    ["S", "Style"],
    ["E", "Examine"],
  ];
  return (
    <div
      className="ml-rise-info"
      ref={box}
      role="dialog"
      aria-label="RISE: References, Idea, Style, Examine"
    >
      {rows.map(([k, label]) => (
        <div key={k} className="ml-rise-letter">
          <b>{k}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function ChipView({
  chip,
  onRemove,
  onToggleLogo,
  onOpen,
}: {
  chip: Chip;
  onRemove: () => void;
  onToggleLogo: () => void;
  onOpen: () => void;
}) {
  const busy =
    ("status" in chip && (chip.status === "uploading" || chip.status === "pulling")) || false;
  let thumb: React.ReactNode = null;
  let label = "";
  let sub = "";
  if (chip.kind === "style") {
    thumb = chip.thumb ? <img src={chip.thumb} alt="" /> : <span className="ml-chip-swatch" />;
    label = chip.name;
    sub = "Style";
  } else if (chip.kind === "logo" || chip.kind === "image") {
    thumb = <img src={chip.dataUrl} alt="" className={chip.kind === "logo" ? "contain" : ""} />;
    label = chip.kind === "logo" ? "Your logo" : chip.name.replace(/-[0-9a-f]{8}(\.\w+)$/, "$1");
    sub =
      chip.status === "uploading"
        ? `Adding ${Math.round((chip.progress ?? 0) * 100)}%`
        : chip.status === "error"
          ? (chip.error ?? "Couldn't add")
          : chip.kind === "logo"
            ? chip.theme
              ? "Brands the wall"
              : "In every prompt"
            : "Reference";
  } else if (chip.kind === "video") {
    thumb = chip.poster ? <img src={chip.poster} alt="" /> : <Film size={15} />;
    label = chip.name.replace(/-[0-9a-f]{8}(\.\w+)$/, "$1");
    sub =
      chip.status === "uploading"
        ? `Adding ${Math.round((chip.progress ?? 0) * 100)}%`
        : chip.status === "error"
          ? (chip.error ?? "Couldn't add")
          : chip.frames?.length
            ? `Video · ${chip.frames.length} key frames`
            : "Video";
  } else if (chip.kind === "url") {
    thumb = chip.brand ? (
      <span className="ml-chip-swatches">
        {[chip.brand.accent, chip.brand.accent2, chip.brand.ink].map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
      </span>
    ) : (
      <Globe2 size={15} />
    );
    label = chip.brand?.name || chip.host;
    sub =
      chip.status === "pulling"
        ? "Reading the brand"
        : chip.status === "brand"
          ? "Brands the wall"
          : chip.status === "error"
            ? (chip.note ?? "Couldn't read it")
            : "Reference";
  }
  return (
    <span className={`ml-chip ml-chip-${chip.kind} ${busy ? "busy" : ""}`}>
      <button
        type="button"
        className="ml-chip-main"
        onClick={chip.kind === "style" ? onOpen : chip.kind === "image" ? onToggleLogo : undefined}
        title={
          chip.kind === "style"
            ? "Preview this style"
            : chip.kind === "image"
              ? "Use as your logo"
              : chip.kind === "logo"
                ? "Your logo brands every style and goes in the prompt"
                : undefined
        }
      >
        <span className="ml-chip-thumb">
          {busy ? <Loader2 size={14} className="animate-spin" /> : thumb}
        </span>
        <span className="ml-chip-text">
          <b>{label}</b>
          <small>{sub}</small>
        </span>
      </button>
      {chip.kind === "logo" && (
        <button
          type="button"
          className="ml-chip-alt"
          onClick={onToggleLogo}
          title="Use as a reference image instead"
        >
          Reference
        </button>
      )}
      <button type="button" className="ml-chip-x" onClick={onRemove} aria-label={`Remove ${label}`}>
        <X size={12} />
      </button>
    </span>
  );
}

export function Composer(p: ComposerProps) {
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [info, setInfo] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuBox.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);

  // Grow the text box with its content (up to a limit).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(p.docked ? 96 : 180, el.scrollHeight)}px`;
  }, [p.text, p.docked]);

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const item = e.dataTransfer.getData(MIME_ITEM);
    if (item) return p.onItem(item);
    const files = [...(e.dataTransfer.files ?? [])];
    if (files.length) return p.onFiles(files);
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (uri && URL_ONLY.test(uri)) return p.onUrl(uri.trim());
    if (uri) p.setText((p.text ? p.text + " " : "") + uri.trim());
  };

  const paste = (e: React.ClipboardEvent) => {
    const files = [...(e.clipboardData.files ?? [])];
    if (files.length) {
      e.preventDefault();
      p.onFiles(files);
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (text && URL_ONLY.test(text) && !p.text.trim()) {
      e.preventDefault();
      p.onUrl(text.trim());
    }
  };

  const canWrite =
    !p.writing && (p.text.trim().length >= 3 || p.chips.some((c) => c.kind === "style"));

  return (
    <div
      className={`ml-composer ${over ? "over" : ""} ${p.docked ? "docked" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={drop}
    >
      <div className="ml-strike-glow" aria-hidden="true" />
      <div className="ml-strike-rim" aria-hidden="true" />
      <div className="ml-composer-inner">
        {p.chips.length > 0 && (
          <div className="ml-chips" aria-label="In this prompt">
            {p.chips.map((c) => (
              <ChipView
                key={c.key}
                chip={c}
                onRemove={() => p.onRemove(c.key)}
                onToggleLogo={() => p.onToggleLogo(c.key)}
                onOpen={() => c.kind === "style" && p.onOpenChip(c.id)}
              />
            ))}
          </div>
        )}
        <label htmlFor="ml-idea" className="sr-only">
          Describe the idea
        </label>
        <textarea
          id="ml-idea"
          ref={area}
          value={p.text}
          rows={p.docked ? 1 : 2}
          onChange={(e) => p.setText(e.target.value)}
          onPaste={paste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canWrite) p.onWrite();
            }
          }}
          placeholder={
            p.chips.some((c) => c.kind === "style")
              ? "Describe the idea, or just press Write prompt"
              : "Describe the idea. Drop in a logo, an image, a video or a link."
          }
        />
        {linkOpen && (
          <form
            className="ml-link-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) p.onUrl(link.trim());
              setLink("");
              setLinkOpen(false);
            }}
          >
            <Link2 size={15} aria-hidden="true" />
            <input
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a website or a video link"
              aria-label="Link"
            />
            <button type="submit" className="ml-btn small">
              Add
            </button>
            <button type="button" className="ml-btn ghost small" onClick={() => setLinkOpen(false)}>
              Cancel
            </button>
          </form>
        )}
        <div className="ml-bar">
          <div className="ml-plus" ref={menuBox}>
            <button
              type="button"
              className="ml-icon-btn"
              onClick={() => setMenu((m) => !m)}
              aria-label="Add a file or a link"
              aria-expanded={menu}
            >
              <Plus size={17} />
            </button>
            {menu && (
              <div className="ml-menu up" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="ml-menu-item"
                  onClick={() => {
                    setMenu(false);
                    file.current?.click();
                  }}
                >
                  <ImageIcon size={16} />
                  <span>
                    <b>Image, video or logo</b>
                    <small>PNG, SVG, JPG, MP4 or MOV</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ml-menu-item"
                  onClick={() => {
                    setMenu(false);
                    setLinkOpen(true);
                  }}
                >
                  <Link2 size={16} />
                  <span>
                    <b>A website or link</b>
                    <small>Its brand re-skins the wall</small>
                  </span>
                </button>
              </div>
            )}
            <input
              ref={file}
              type="file"
              multiple
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/quicktime,video/webm"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) p.onFiles(files);
                e.target.value = "";
              }}
            />
          </div>
          <label className="ml-length" title="Animation length">
            <span className="sr-only">Length in seconds</span>
            <input
              type="range"
              min={3}
              max={60}
              step={1}
              value={p.seconds}
              onChange={(e) => p.setSeconds(Number(e.target.value))}
              style={{ "--ml-fill": `${((p.seconds - 3) / 57) * 100}%` } as React.CSSProperties}
            />
            <output>{p.seconds}s</output>
          </label>
          <div className="ml-enhance">
            <button
              type="button"
              role="switch"
              aria-checked={p.enhance}
              className="ml-switch"
              onClick={() => p.setEnhance(!p.enhance)}
            >
              <i aria-hidden="true" />
              Auto-enhance
            </button>
            <button
              type="button"
              className="ml-info-btn"
              onClick={() => setInfo((v) => !v)}
              aria-label="What Auto-enhance does"
              aria-expanded={info}
            >
              <Info size={14} />
            </button>
            {info && <RiseInfo onClose={() => setInfo(false)} />}
          </div>
          <span className="ml-grow" />
          <OpenInPicker
            value={p.target}
            onChange={p.setTarget}
            status={p.status}
            compact={p.docked}
          />
          <button type="button" className="ml-write" onClick={p.onWrite} disabled={!canWrite}>
            {p.writing ? <Loader2 size={15} className="animate-spin" /> : null}
            {p.writing ? "Writing" : "Write prompt"}
          </button>
        </div>
      </div>
      {over && (
        <div className="ml-drop-hint" aria-hidden="true">
          Drop it in
        </div>
      )}
    </div>
  );
}

/** The quiet three-step hint under the box. */
export function Steps({
  picked,
  described,
  added,
}: {
  picked: boolean;
  described: boolean;
  added: boolean;
}) {
  const steps: [boolean, string][] = [
    [picked, "Pick a style"],
    [described, "Describe the idea"],
    [added, "Add your logo or a reference"],
  ];
  return (
    <ol className="ml-steps" aria-label="How it works">
      {steps.map(([done, label], i) => (
        <li key={label} className={done ? "done" : ""}>
          <b>{done ? <Check size={11} strokeWidth={3} /> : i + 1}</b>
          {label}
        </li>
      ))}
    </ol>
  );
}
