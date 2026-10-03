// The Reels audio pipeline on the scroll page: Fish Audio transcribes the
// voice, Jev places sound effects, Fish Audio voices the hook, ffmpeg mixes.
// Everything starts muted; one sound plays at a time across the page.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { jevFetch } from "@/lib/jev-client";
import { FISH_SIGNUP_URL } from "@/lib/fish";
import { JevMark } from "@/components/jev/jev-card";
import { SFX_LABELS, enabledEffects, type SectionSfx, type SfxName } from "@/lib/reel-sfx";
import "./reels-audio.css";

type Step = { id: "transcribe" | "place" | "voice" | "mix"; label: string; state: "pending" | "running" | "done" | "error"; ms?: number; detail?: string };
type Pipeline = {
  running: boolean;
  steps: Step[];
  transcript?: { text: string; segments: Array<{ text: string; start: number; end: number }>; source: string };
  placements?: SectionSfx[];
  voice?: { text: string; file: string };
  mix?: { file: string; effects: number; version: number; placed?: unknown[] };
  error?: string;
};
export type SfxItem = { name: SfxName; label: string; seconds: number; peaks: number[] };

// ── one sound at a time, across the whole Reels page ──────────────────────
export const SOUND_EVENT = "rsx:sound";
export function claimSound(owner: string) {
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: owner }));
}
export function useSoundClaim(owner: string, stop: () => void) {
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== owner) stopRef.current();
    };
    window.addEventListener(SOUND_EVENT, on);
    return () => window.removeEventListener(SOUND_EVENT, on);
  }, [owner]);
}

/** Fetch a pipeline file with the workspace token, as a blob URL. */
function useAudioFile(name: string | undefined, version = 0) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!name) return;
    const ac = new AbortController();
    let made = "";
    void jevFetch(`/__reels/audio/file?name=${encodeURIComponent(name)}&v=${version}`, { signal: ac.signal })
      .then((r) => r.blob())
      .then((b) => {
        if (ac.signal.aborted) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      ac.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [name, version]);
  return url;
}

/** A play button for one short sound. Muted until pressed; stops others. */
export function SfxPlay({ name, label, size = 28 }: { name: SfxName | "hook-voice"; label: string; size?: number }) {
  const [playing, setPlaying] = useState(false);
  const [want, setWant] = useState(false);
  const url = useAudioFile(want ? (name === "hook-voice" ? "hook-voice.mp3" : `sfx/${name}.mp3`) : undefined);
  const el = useRef<HTMLAudioElement>(null);
  const owner = `sfx:${name}`;
  useSoundClaim(owner, () => el.current?.pause());
  useEffect(() => {
    if (!want || !url || !el.current) return;
    claimSound(owner);
    el.current.currentTime = 0;
    void el.current.play().catch(() => undefined);
  }, [url, want, owner]);
  return (
    <>
      <button
        type="button"
        className={`rsa-play${playing ? " is-playing" : ""}`}
        style={{ width: size, height: size }}
        aria-label={playing ? `Stop ${label}` : `Play ${label}`}
        onClick={() => {
          if (playing) {
            el.current?.pause();
            return;
          }
          if (url && el.current) {
            claimSound(owner);
            el.current.currentTime = 0;
            void el.current.play().catch(() => undefined);
          } else setWant(true);
        }}
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      {url && <audio ref={el} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
    </>
  );
}

function Wave({ peaks, active }: { peaks: number[]; active?: boolean }) {
  const w = 96;
  const bar = w / Math.max(1, peaks.length);
  return (
    <svg className={`rsa-wave${active ? " is-on" : ""}`} viewBox={`0 0 ${w} 24`} preserveAspectRatio="none" aria-hidden>
      {peaks.map((p, i) => {
        const h = Math.max(1.2, p * 22);
        return <rect key={i} x={i * bar + 0.3} y={12 - h / 2} width={Math.max(0.8, bar - 0.8)} height={h} rx={0.6} />;
      })}
    </svg>
  );
}

/** The per-section row: three or four effect options, each with play and a switch. */
export function SectionSfxRow({ suggestion, toggles, onToggle, library }: { suggestion: SectionSfx; toggles: Record<string, boolean>; onToggle: (key: string, on: boolean) => void; library: SfxItem[] }) {
  return (
    <div className="rsa-row">
      <div className="rsa-row-head">
        <JevMark size={12} /> Sound effects <span className="rsa-sample">Sample</span>
      </div>
      <ul>
        {suggestion.options.map((o) => {
          const key = `${suggestion.sectionId}:${o.effect}`;
          const on = toggles[key] ?? o.on;
          const item = library.find((l) => l.name === o.effect);
          return (
            <li key={o.effect} className={on ? "is-on" : undefined}>
              <SfxPlay name={o.effect} label={SFX_LABELS[o.effect]} size={24} />
              <span className="rsa-opt">
                <b>{SFX_LABELS[o.effect]}</b>
                <span className="rsa-p">{Math.round(o.p * 100)}%</span>
                <small>{o.reason}</small>
              </span>
              {item && <Wave peaks={item.peaks} active={on} />}
              <button type="button" role="switch" aria-checked={on} aria-label={`${SFX_LABELS[o.effect]} on this section`} className="rsa-switch" onClick={() => onToggle(key, !on)}>
                <span />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const fmtMs = (ms?: number) => (ms === undefined ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export function ReelAudioPipeline({ suggestions, toggles, library, autoRun }: { suggestions: SectionSfx[]; toggles: Record<string, boolean>; library: SfxItem[]; autoRun?: boolean }) {
  const [p, setP] = useState<Pipeline | null>(null);
  // Folded away by default; opens when it runs.
  const [openPanel, setOpenPanel] = useState(!!autoRun);
  const [shownSegments, setShownSegments] = useState(0);
  const root = useRef<HTMLElement>(null);
  const poll = useRef<number | undefined>(undefined);
  const togglesKey = JSON.stringify(enabledEffects(suggestions, toggles));

  const refresh = async () => {
    try {
      const next: Pipeline = await (await jevFetch("/__reels/audio/status")).json();
      setP(next);
      if (!next.running) window.clearInterval(poll.current);
    } catch {
      window.clearInterval(poll.current);
    }
  };
  const startPolling = () => {
    window.clearInterval(poll.current);
    poll.current = window.setInterval(() => void refresh(), 400);
  };
  useEffect(() => {
    void refresh().then(() => undefined);
    return () => window.clearInterval(poll.current);
  }, []);
  useEffect(() => {
    if (p?.running) startPolling();
  }, [p?.running]);

  const run = async (mode: "run" | "mix") => {
    if (mode === "run") setShownSegments(0);
    try {
      const next: Pipeline = await (await jevFetch(`/__reels/audio/${mode}`, { method: "POST", body: JSON.stringify({ toggles }) })).json();
      setP(next);
      startPolling();
    } catch (e) {
      setP((old) => ({ ...(old ?? { running: false, steps: [] }), error: e instanceof Error ? e.message : "The pipeline could not start" }));
    }
  };

  // ?audio=run and the voice command start it once, in view.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const go = () => {
      root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setOpenPanel(true);
      void runRef.current("run");
    };
    let t: number | undefined;
    if (autoRun) t = window.setTimeout(go, 1100);
    window.addEventListener("agentic:reels-audio", go);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("agentic:reels-audio", go);
    };
  }, [autoRun]);

  // Transcript words land one after another once Fish answers.
  const segCount = p?.transcript?.segments.length ?? 0;
  useEffect(() => {
    if (shownSegments >= segCount) return;
    const t = window.setTimeout(() => setShownSegments((n) => n + 1), 55);
    return () => window.clearTimeout(t);
  }, [shownSegments, segCount]);

  const mixUrl = useAudioFile(p?.mix?.file, p?.mix?.version ?? 0);
  const video = useRef<HTMLVideoElement>(null);
  const [mixSound, setMixSound] = useState(false);
  useSoundClaim("mix", () => setMixSound(false));
  useEffect(() => {
    if (video.current) video.current.muted = !mixSound;
  }, [mixSound, mixUrl]);

  const steps = p?.steps?.length ? p.steps : [];
  const core = steps.filter((s) => s.id === "transcribe" || s.id === "place");
  const done = core.length > 0 && core.every((s) => s.state === "done");
  const total = steps.reduce((n, s) => n + (s.ms ?? 0), 0);
  const stale = !!p?.mix?.placed && !p.running && JSON.stringify(p.mix.placed) !== togglesKey;

  return (
    <details ref={root as never} className="rsa" aria-label="Audio pipeline" open={openPanel} onToggle={(e) => setOpenPanel((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="rsa-summary">
        <span>Audio</span> Transcript and optional sound effects
        {done && <em>{fmtMs(total)}</em>}
      </summary>
      <header className="rsa-head">
        <div>
          <p className="rsa-eyebrow">Audio pipeline</p>
          <h3>Transcript and optional sound effects</h3>
          <p className="rsa-honest">Fish Audio transcribes the voice. Sound effects are optional example clips made locally; add them only if you want them.</p>
        </div>
        <div className="rsa-actions">
          <a className="rsa-fish" href={FISH_SIGNUP_URL} target="_blank" rel="noopener noreferrer">
            Fish Audio account <ArrowUpRight size={12} />
          </a>
          {done && (
            <button type="button" className="rsa-ghost" onClick={() => void run("mix")}>
              <RotateCcw size={13} /> {p?.mix ? (stale ? "Mix again with your picks" : "Mix again") : "Add the sound effects"}
            </button>
          )}
          <button type="button" className="rsa-go" disabled={p?.running} onClick={() => void run("run")}>
            {p?.running ? <Loader2 size={14} className="rsa-spin" /> : <Play size={14} />}
            {p?.running ? "Running" : done ? "Run again" : "Transcribe"}
          </button>
        </div>
      </header>

      <ol className="rsa-steps">
        {(steps.length ? steps : [
          { id: "transcribe", label: "Fish Audio transcribes the voice", state: "pending" },
          { id: "place", label: "Jev places a sound effect on each section", state: "pending" },
        ] as Step[]).filter((s) => s.id === "transcribe" || s.id === "place" || (s.id === "mix" && !!p?.mix)).map((s, i) => (
          <li key={s.id} className={`is-${s.state}`}>
            <span className="rsa-dot">{s.state === "done" ? <Check size={13} /> : s.state === "running" ? <Loader2 size={13} className="rsa-spin" /> : i + 1}</span>
            <div className="rsa-step-body">
              <div className="rsa-step-top">
                <b>{s.label}</b>
                <span className="rsa-ms">{s.state === "running" ? "working" : fmtMs(s.ms)}</span>
              </div>
              {s.detail && <small className={s.state === "error" ? "rsa-err" : undefined}>{s.detail}</small>}

              {s.id === "transcribe" && p?.transcript && (
                <div className="rsa-words">
                  {p.transcript.segments.slice(0, shownSegments).map((seg, k) => (
                    <span key={k}>
                      <i>{fmtT(seg.start)}</i>
                      {seg.text}
                    </span>
                  ))}
                </div>
              )}
              {s.id === "place" && p?.placements && (
                <div className="rsa-placed">
                  {p.placements.map((pl) => {
                    const on = enabledEffects([pl], toggles);
                    return (
                      <span key={pl.sectionId}>
                        <i>{pl.sectionId.toUpperCase()}</i>
                        {on.length ? on.map((o) => SFX_LABELS[o.effect]).join(" + ") : "None"}
                        <em>{Math.round((pl.options[0]?.p ?? 0) * 100)}%</em>
                      </span>
                    );
                  })}
                  <span className="rsa-sample">Sample</span>
                </div>
              )}
              {s.id === "voice" && p?.voice && s.state === "done" && (
                <div className="rsa-voice">
                  <SfxPlay name="hook-voice" label="the hook in Jarvis" />
                  <q>{p.voice.text}</q>
                </div>
              )}
              {s.id === "mix" && mixUrl && (
                <div className="rsa-mix">
                  <video ref={video} src={mixUrl} muted loop playsInline autoPlay preload="metadata" aria-label="Reel A with sound effects" />
                  <button
                    type="button"
                    className={`rsa-ghost${mixSound ? " is-on" : ""}`}
                    onClick={() => {
                      if (!mixSound) {
                        claimSound("mix");
                        if (video.current) video.current.currentTime = 0;
                      }
                      setMixSound((v) => !v);
                    }}
                  >
                    {mixSound ? <Pause size={13} /> : <Play size={13} />}
                    {mixSound ? "Mute" : "Play with sound"}
                  </button>
                  <small>
                    Reel A, Night Glow, with {p?.mix?.effects ?? 0} effects mixed under your voice.
                  </small>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {p?.error && <p className="rsa-err">{p.error}</p>}
      {done && <p className="rsa-total">Done in {fmtMs(total)}. Fish Audio made one call; effects are only mixed in when you press Add the sound effects.</p>}

      <div className="rsa-lib">
        <p className="rsa-lib-label">Example sound effects</p>
        <div className="rsa-lib-grid">
          {library.map((item) => (
            <div key={item.name} className="rsa-lib-item">
              <SfxPlay name={item.name} label={item.label} />
              <span>
                <b>{item.label}</b>
                <small>{item.seconds.toFixed(1)} s</small>
              </span>
              <Wave peaks={item.peaks} active />
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
