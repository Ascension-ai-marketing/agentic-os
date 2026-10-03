import * as Dialog from "@radix-ui/react-dialog";
import type { MotionRunner, TileHandle } from "@/motion/engine/runner";
import type { PromptAsset } from "@/motion/engine/prompt";
import type { MotionStyle, Theme } from "@/motion/engine/types";
import { LOOP } from "@/motion/engine/types";
import { Check, Film, FolderOpen, Loader2, Pause, Play, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ExportJob, type Status } from "./api";
import { OpenActions, RiseView, type Notify, type Target } from "./shared";
import { LoopVideo } from "./tiles";

type Aspect = "16:9" | "9:16" | "1:1";
const RATIO: Record<Aspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

function ExportPanel({
  style,
  theme,
  aspect,
  status,
  notify,
}: {
  style: MotionStyle;
  theme: Theme | null;
  aspect: Aspect;
  status: Status | null;
  notify: Notify;
}) {
  const [size, setSize] = useState<Aspect>(aspect);
  const [seconds, setSeconds] = useState<5 | 10>(5);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSize(aspect), [aspect]);
  useEffect(() => {
    if (!job || ["done", "error", "cancelled"].includes(job.state)) return;
    const timer = setInterval(async () => {
      try {
        setJob(await api.exportStatus(job.id));
      } catch (e) {
        // A 404 means the app lost the job (it restarted); stop and say where to look.
        if (e instanceof ApiError && e.status === 404)
          setJob({
            ...job,
            state: "error",
            error: `Lost track of this export. Check ${status?.home ?? "~/motion-studio-projects"}/exports.`,
          });
      }
    }, 450);
    return () => clearInterval(timer);
  }, [job]);

  const start = async () => {
    setError(null);
    try {
      setJob(await api.exportStart(style.id, theme, size, seconds));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed to start.");
    }
  };
  const busy = job && !["done", "error", "cancelled"].includes(job.state);
  const pct = job
    ? job.state === "encoding" || job.state === "done"
      ? 1
      : job.frames / Math.max(1, job.total)
    : 0;
  const missing = status && (!status.chrome || !status.ffmpeg);
  return (
    <div className="ml-panel" role="region" aria-label="Export mp4">
      <div className="ml-row" style={{ justifyContent: "space-between" }}>
        <div className="ml-seg" role="group" aria-label="Size">
          {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
            <button
              key={a}
              aria-pressed={size === a}
              onClick={() => setSize(a)}
              disabled={Boolean(busy)}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="ml-seg" role="group" aria-label="Length">
          {([5, 10] as const).map((s) => (
            <button
              key={s}
              aria-pressed={seconds === s}
              onClick={() => setSeconds(s)}
              disabled={Boolean(busy)}
            >
              {s} s
            </button>
          ))}
        </div>
      </div>
      <p style={{ margin: "10px 0 0" }}>
        {size === "16:9" ? "3840 × 2160" : size === "9:16" ? "2160 × 3840" : "2160 × 2160"} · 30 fps
        · H.264 · saved to {status?.home ?? "~/motion-studio-projects"}/exports
      </p>
      {missing && (
        <p className="ml-error" style={{ margin: "8px 0 0" }}>
          {!status?.chrome ? "Export needs Google Chrome installed. " : ""}
          {!status?.ffmpeg ? "Export needs ffmpeg (macOS: brew install ffmpeg)." : ""}
        </p>
      )}
      {job && (
        <>
          <div className="ml-progress" aria-label="Export progress">
            <i style={{ transform: `scaleX(${pct})` }} />
          </div>
          <p style={{ margin: 0 }}>
            {job.state === "starting" && "Starting headless Chrome…"}
            {job.state === "rendering" && `Drawing frame ${job.frames} of ${job.total}`}
            {job.state === "encoding" && "Encoding the mp4…"}
            {job.state === "done" &&
              `Saved ${job.display} (${((job.bytes ?? 0) / 1e6).toFixed(1)} MB)`}
            {job.state === "error" && <span className="ml-error">{job.error}</span>}
            {job.state === "cancelled" && "Cancelled."}
          </p>
        </>
      )}
      {error && (
        <p className="ml-error" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      <div className="ml-row" style={{ marginTop: 12 }}>
        {busy ? (
          <button className="ml-btn small" onClick={() => job && api.exportCancel(job.id)}>
            <X size={14} /> Cancel
          </button>
        ) : (
          <button className="ml-btn primary small" onClick={start} disabled={Boolean(missing)}>
            <Film size={14} /> {job?.state === "done" ? "Export again" : "Start export"}
          </button>
        )}
        {busy && <Loader2 size={15} className="animate-spin" />}
        {job?.state === "done" && job.file && (
          <button
            className="ml-btn ghost small"
            onClick={async () => {
              const r = await api.reveal(job.file as string).catch(() => null);
              if (r && !r.revealed)
                notify(r.dryRun ? "Dry run: Finder stays closed." : `Saved at ${job.display}`);
            }}
          >
            <FolderOpen size={14} /> Show in Finder
          </button>
        )}
      </div>
    </div>
  );
}

/** What the detail view shows: a live style, a live "Made" piece, or a video. */
export interface DetailItem {
  id: string;
  kicker: string;
  name: string;
  look: string;
  move?: string;
  rules: string[];
  prompt: string;
  ref?: string;
  style?: MotionStyle;
  video?: { src: string; poster: string };
  exportable: boolean;
  aspects: boolean;
}

export function ItemDetail({
  item,
  theme,
  branded,
  selected,
  onToggle,
  assets,
  target,
  status,
  ensureRunner,
  notify,
  onClose,
}: {
  item: DetailItem;
  theme: Theme;
  branded: boolean;
  selected: boolean;
  onToggle: () => void;
  assets: PromptAsset[];
  target: Target;
  status: Status | null;
  ensureRunner: () => MotionRunner;
  notify: Notify;
  onClose: () => void;
}) {
  // Radix mounts the portal a pass later, so these are state refs: effects run once they exist.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const handle = useRef<TileHandle | null>(null);
  const current = useRef(0);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [paused, setPaused] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const style = item.style;
  const loop = style?.duration ?? LOOP;

  // Size the canvas box to the stage for the chosen aspect.
  useEffect(() => {
    if (!stageEl) return;
    const fit = () => {
      if (!wrap.current) return;
      const r = stageEl.getBoundingClientRect();
      const ratio = RATIO[aspect];
      let w = r.width;
      let h = w / ratio;
      if (h > r.height) {
        h = r.height;
        w = h * ratio;
      }
      wrap.current.style.width = `${Math.floor(w)}px`;
      wrap.current.style.height = `${Math.floor(h)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [aspect, stageEl]);

  useEffect(() => {
    if (!canvasEl || !style) return;
    handle.current = ensureRunner().attach(canvasEl, {
      style,
      theme,
      priority: 1,
      maxWidth: 2400,
      fps: 30,
      aspect: RATIO[aspect],
      offset: 0,
      onFrame: (t) => {
        current.current = t;
        if (bar.current) bar.current.style.transform = `scaleX(${t / loop})`;
        if (time.current) time.current.textContent = `${t.toFixed(2)} s`;
      },
    });
    return () => {
      handle.current?.detach();
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, ensureRunner, canvasEl]);

  useEffect(() => handle.current?.update({ theme }), [theme]);
  useEffect(() => handle.current?.update({ aspect: RATIO[aspect] }), [aspect]);
  useEffect(() => {
    handle.current?.update({ still: scrub !== null ? scrub : paused ? current.current : null });
  }, [paused, scrub]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ml-overlay" />
        <Dialog.Content
          className="ml-detail"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Keep focus in the dialog without lighting up the first button.
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <div className="ml-stage">
            <div className="ml-stage-frame" ref={setStageEl}>
              <div className="ml-canvas-wrap" ref={wrap}>
                {style ? (
                  <canvas ref={setCanvasEl} />
                ) : item.video ? (
                  <LoopVideo
                    src={item.video.src}
                    poster={item.video.poster}
                    className="ml-stage-video"
                  />
                ) : null}
              </div>
            </div>
            {style && (
              <div className="ml-stage-bar">
                <button
                  className="ml-play"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? "Play" : "Pause"}
                >
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                </button>
                <label className="ml-scrub">
                  <i ref={bar} />
                  <input
                    type="range"
                    min={0}
                    max={loop}
                    step={0.01}
                    aria-label="Scrub the loop"
                    onChange={(e) => setScrub(Number(e.target.value))}
                    onPointerUp={() => {
                      setScrub(null);
                      setPaused(true);
                    }}
                    onKeyUp={() => {
                      setScrub(null);
                      setPaused(true);
                    }}
                  />
                </label>
                <span className="ml-time" ref={time}>
                  0.00 s
                </span>
                {item.aspects && (
                  <div className="ml-seg dark" role="group" aria-label="Preview aspect">
                    {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
                      <button key={a} aria-pressed={aspect === a} onClick={() => setAspect(a)}>
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="ml-info">
            <div className="ml-info-top">
              <span>{item.kicker}</span>
              <Dialog.Close className="ml-close" aria-label="Close">
                <X size={15} />
              </Dialog.Close>
            </div>
            <Dialog.Title asChild>
              <h2>{item.name}</h2>
            </Dialog.Title>
            <dl className="ml-dl">
              <div>
                <dt>Looks like</dt>
                <dd>{item.look}</dd>
              </div>
              {item.move && (
                <div>
                  <dt>Moves like</dt>
                  <dd>{item.move}</dd>
                </div>
              )}
            </dl>
            <div className="ml-detail-top">
              <button className={`ml-btn ${selected ? "on" : ""}`} onClick={onToggle}>
                {selected ? <Check size={15} /> : <Plus size={15} />}
                {selected ? "In your prompt" : "Add to prompt"}
              </button>
              {item.exportable && (
                <button
                  className="ml-btn"
                  onClick={() => setExporting((x) => !x)}
                  aria-expanded={exporting}
                >
                  <Film size={15} /> Export mp4
                </button>
              )}
            </div>
            <OpenActions
              name={theme.name && branded ? `${theme.name} ${item.name}` : item.name}
              prompt={item.prompt}
              assets={assets}
              target={target}
              status={status}
              notify={notify}
              size="large"
            />
            {exporting && style && (
              <ExportPanel
                style={style}
                theme={branded ? theme : theme.logo ? theme : null}
                aspect={aspect}
                status={status}
                notify={notify}
              />
            )}
            {item.rules.length > 0 && (
              <>
                <h3 className="ml-h">Rules</h3>
                <ol className="ml-rules">
                  {item.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </>
            )}
            <h3 className="ml-h">Prompt · RISE</h3>
            <RiseView text={item.prompt} />
            {item.ref && (
              <p className="ml-ref">
                Reference:{" "}
                <a href={item.ref} target="_blank" rel="noreferrer">
                  {item.ref.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
                </a>
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
