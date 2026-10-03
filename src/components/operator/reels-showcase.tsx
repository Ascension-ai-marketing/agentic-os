import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, FolderOpen, Plus, Volume2, VolumeX } from "lucide-react";
import { reelFamilies, type ReelFamily, type ReelProject, type ReelSection, type ReelVariant } from "@/lib/jev-reels";
import { useReelMedia } from "./reels-media";
import { JevCard, JevMark, fmtMs, fmtUsd } from "@/components/jev/jev-card";
import { JEV_SAMPLES } from "@/components/jev/jev-samples";
import { REEL_PICK_CRITERIA, simulateReelJevPick, type ReelJevPick } from "@/lib/reel-jev-picks";
import type { ReelFamily as Family } from "@/lib/jev-reels";
import { ReelAudioPipeline, SectionSfxRow, claimSound, useSoundClaim, type SfxItem } from "./reels-audio";
import { suggestSectionSfx } from "@/lib/reel-sfx";
import { jevFetch } from "@/lib/jev-client";
import "./reels-showcase.css";

// The finished reel as one long scroll: the whole reel in each style on top,
// then every section with each take side by side. Top half puts the speaker
// in every frame. Videos load near the viewport, play only while on screen,
// start muted, and only one thing makes sound at a time.

type Layout = "full" | "top";
const familyName = (f: ReelFamily) => reelFamilies.find((x) => x.id === f)?.name ?? f;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

function sectionVariants(s: ReelSection): ReelVariant[] {
  if (s.variants?.length) return s.variants;
  return reelFamilies.flatMap((f) => (s.clips?.[f.id] ? [{ key: f.id, family: f.id, full: s.clips[f.id] }] : []));
}

function InstagramFrame({ caption }: { caption: string }) {
  return (
    <svg className="rsx-ig" viewBox="0 0 1080 1920" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="rsx-ig-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </linearGradient>
      </defs>
      <text x="54" y="138" fill="#fff" fontFamily="Inter, Arial" fontWeight="700" fontSize="60">Reels</text>
      <rect y="1420" width="1080" height="500" fill="url(#rsx-ig-fade)" />
      <g stroke="#fff" strokeWidth="7" fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path transform="translate(1000 1200)" d="M0 30 C-30 8 -46 -8 -46 -26 C-46 -44 -32 -54 -18 -54 C-8 -54 -2 -48 0 -42 C2 -48 8 -54 18 -54 C32 -54 46 -44 46 -26 C46 -8 30 8 0 30 Z" />
        <path transform="translate(1000 1350)" d="M-36 26 L-30 8 C-40 -6 -42 -24 -30 -38 C-16 -54 16 -54 30 -38 C44 -22 42 2 26 14 C12 24 -6 26 -20 20 Z" />
        <path transform="translate(1000 1500)" d="M-40 -34 L40 -34 L6 36 L-2 2 Z M-2 2 L40 -34" />
      </g>
      <circle cx="90" cy="1700" r="36" fill="#D45BB6" />
      <text x="142" y="1714" fill="#fff" fontFamily="Inter, Arial" fontWeight="700" fontSize="38">jackroberts___</text>
      <text x="54" y="1790" fill="#fff" fontFamily="Inter, Arial" fontSize="34">{caption}</text>
    </svg>
  );
}

/** A 9:16 phone that fetches its clip when near the screen and plays only while visible. */
function Phone({
  projectId,
  file,
  label,
  ig,
  caption,
  audible = false,
  restartKey = 0,
  onTime,
  onPause,
  className = "",
}: {
  projectId: string;
  file?: string;
  label: string;
  ig: boolean;
  caption: string;
  audible?: boolean;
  restartKey?: number;
  onTime?: (t: number) => void;
  onPause?: () => void;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const { url, error } = useReelMedia(projectId, file, near);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const load = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "600px 0px" });
    const play = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio > 0.2), { threshold: [0, 0.2, 0.5] });
    load.observe(el);
    play.observe(el);
    return () => {
      load.disconnect();
      play.disconnect();
    };
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = !audible;
    if (visible && !document.hidden) void v.play().catch(() => undefined);
    else v.pause();
  }, [visible, url, audible]);

  useEffect(() => {
    const v = video.current;
    if (!v || !restartKey) return;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  }, [restartKey]);

  return (
    <div ref={holder} className={`rsx-phone ${className}`}>
      {url ? (
        <video
          ref={video}
          src={url}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={label}
          onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
          onPause={onPause}
        />
      ) : (
        <span className="rsx-phone-wait">{error ? "Preview unavailable" : ""}</span>
      )}
      {ig && <InstagramFrame caption={caption} />}
    </div>
  );
}

export function ReelShowcase({
  project,
  savedCount,
  onNew,
  onLibrary,
}: {
  project: ReelProject;
  savedCount: number;
  onNew: () => void;
  onLibrary: () => void;
}) {
  const storeKey = `claude-os.reels.showcase.${project.id}`;
  const hasTop = project.sections.some((s) => sectionVariants(s).some((v) => v.top));
  const [layout, setLayoutState] = useState<Layout>(() => (hasTop ? readStore<Layout>(`${storeKey}.layout`, "top") : "full"));
  const [ig, setIgState] = useState<boolean>(() => readStore(`${storeKey}.ig`, false));
  const [picks, setPicks] = useState<Record<string, string>>(() => readStore(`${storeKey}.picks`, {}));
  const [sound, setSound] = useState<string | null>(null);
  const [restart, setRestart] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    writeStore(`${storeKey}.layout`, l);
  };
  const setIg = (v: boolean) => {
    setIgState(v);
    writeStore(`${storeKey}.ig`, v);
  };
  const togglePick = (sectionId: string, key: string) =>
    setPicks((old) => {
      const next = { ...old };
      if (next[sectionId] === key) delete next[sectionId];
      else next[sectionId] = key;
      writeStore(`${storeKey}.picks`, next);
      return next;
    });

  // Section clips are silent. Their sound is the speaker's own voice, taken
  // from whole reel A and kept in step with the clip being heard.
  const voiceFile = reelFamilies.map((f) => project.outputs[f.id]).find(Boolean);
  const [voiceWanted, setVoiceWanted] = useState(false);
  const voice = useReelMedia(project.id, voiceFile, voiceWanted);
  const voiceEl = useRef<HTMLAudioElement>(null);
  const soundSection = sound?.startsWith("sec:") ? project.sections.find((s) => sound.split(":")[1] === s.id) : undefined;

  // One sound at a time across the page, including the audio pipeline.
  useSoundClaim("showcase", () => setSound(null));
  const toggleSound = (key: string) => {
    if (sound === key) {
      setSound(null);
      return;
    }
    claimSound("showcase");
    if (key.startsWith("sec:")) setVoiceWanted(true);
    setSound(key);
    setRestart((r) => ({ ...r, [key]: (r[key] ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!soundSection) voiceEl.current?.pause();
  }, [soundSection]);
  useEffect(() => () => voiceEl.current?.pause(), []);

  const syncVoice = useCallback(
    (s: ReelSection, t: number) => {
      const a = voiceEl.current;
      if (!a || !voice.url) return;
      if (t > s.t1 - s.t0) {
        a.pause();
        return;
      }
      const target = s.t0 + t;
      if (Math.abs(a.currentTime - target) > 0.25) a.currentTime = target;
      if (a.paused) void a.play().catch(() => undefined);
    },
    [voice.url],
  );

  // The picks bar floats over the page (the app shell scrolls, so sticky
  // cannot hold it). It is centred on this room and shown while the
  // sections are on screen.
  const root = useRef<HTMLDivElement>(null);
  const [footVisible, setFootVisible] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rsx-left", `${r.left + r.width / 2}px`);
      el.style.setProperty("--rsx-width", `${r.width}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const first = el.querySelector(".rsx-sec");
    const io = new IntersectionObserver(() => {
      const r = el.getBoundingClientRect();
      const top = first?.getBoundingClientRect().top ?? 0;
      setFootVisible(top < window.innerHeight * 0.9 && r.bottom > 120);
    }, { threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] });
    io.observe(el);
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const top = first?.getBoundingClientRect().top ?? 0;
      setFootVisible(top < window.innerHeight * 0.9 && r.bottom > 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);
  // Let Jev pick: one decision per section, walked down the page so each
  // pick lands where you can see it. Sample odds until a live call is wired.
  const [jevPicks, setJevPicks] = useState<Record<string, ReelJevPick>>({});
  const [jevAt, setJevAt] = useState<string | null>(null);
  const [jevRunning, setJevRunning] = useState(false);
  const jevCancel = useRef(false);
  useEffect(() => () => { jevCancel.current = true; }, []);
  const letJevPick = async () => {
    if (jevRunning) return;
    jevCancel.current = false;
    setJevRunning(true);
    setJevPicks({});
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const total = project.sections.length;
    let previous: Family | undefined;
    for (const [i, s] of project.sections.entries()) {
      if (jevCancel.current) break;
      setJevAt(s.id);
      document.getElementById(`rsx-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      await wait(650);
      const decision = simulateReelJevPick(s, i, total, sectionVariants(s).map((v) => ({ key: v.key, family: v.family })), previous);
      if (!decision || jevCancel.current) continue;
      previous = decision.family;
      setJevPicks((old) => ({ ...old, [s.id]: decision }));
      setPicks((old) => {
        const next = { ...old, [s.id]: decision.pick };
        writeStore(`${storeKey}.picks`, next);
        return next;
      });
      await wait(700);
    }
    setJevAt(null);
    setJevRunning(false);
  };
  // Voice or chat can press it: "let Jev pick my reels" opens ?jev=pick.
  const pickRef = useRef(letJevPick);
  pickRef.current = letJevPick;
  useEffect(() => {
    let t: number | undefined;
    if (new URLSearchParams(window.location.search).get("jev") === "pick") t = window.setTimeout(() => void pickRef.current(), 900);
    const onPick = () => void pickRef.current();
    window.addEventListener("agentic:reels-pick", onPick);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("agentic:reels-pick", onPick);
    };
  }, []);
  const jevList = Object.values(jevPicks);
  const jevMs = jevList.reduce((n, d) => n + d.ms, 0);
  const jevCost = jevList.reduce((n, d) => n + d.costUsd, 0);
  // A real decision Jev made for this exact line during the build.
  const sfxSample = JEV_SAMPLES.find((d) => d.id === "sample-reels");
  // Sound effects: three or four options per section, the best one on.
  const sfxSuggestions = useMemo(() => project.sections.map((s, i) => suggestSectionSfx(s, i, project.sections.length)), [project.sections]);
  const [sfxToggles, setSfxToggles] = useState<Record<string, boolean>>(() => readStore(`${storeKey}.sfx`, {}));
  const toggleSfx = (key: string, on: boolean) =>
    setSfxToggles((old) => {
      const next = { ...old, [key]: on };
      writeStore(`${storeKey}.sfx`, next);
      return next;
    });
  const [sfxLibrary, setSfxLibrary] = useState<SfxItem[]>([]);
  useEffect(() => {
    void jevFetch("/__reels/audio/sfx").then((r) => r.json()).then((l) => Array.isArray(l) && setSfxLibrary(l)).catch(() => undefined);
  }, []);
  const [audioAutoRun] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("audio") === "run";
    } catch {
      return false;
    }
  });
  const picked = project.sections.filter((s) => picks[s.id]);
  const pickText = project.sections.map((s) => `${s.id}-${picks[s.id] ?? "?"}`).join(", ");
  const caption = useMemo(() => {
    const first = project.sections[0]?.words ?? "";
    return first.length > 34 ? `${first.slice(0, 34).trimEnd()}...` : first;
  }, [project.sections]);

  return (
    <div className="rsx" ref={root}>
      {voice.url && <audio ref={voiceEl} src={voice.url} preload="auto" />}

      <header className="rsx-head">
        <div className="rsx-head-text">
          <p className="rsx-eyebrow">
            Instagram Reel · {project.duration.toFixed(1)} s · {project.sections.length} sections
            {project.simulated && <span className="rsx-chip">Example</span>}
          </p>
          <h2>{project.name}</h2>
          <p className="rsx-lede">
            Three styles of the same reel. Scroll down to pick a style for each section.
          </p>
        </div>
        <div className="rsx-controls">
          {hasTop && (
            <div className="rsx-seg" role="group" aria-label="Layout">
              <button type="button" aria-pressed={layout === "top"} onClick={() => setLayout("top")}>
                Top half
              </button>
              <button type="button" aria-pressed={layout === "full"} onClick={() => setLayout("full")}>
                Full screen
              </button>
            </div>
          )}
          <button type="button" className="rsx-ghost" aria-pressed={ig} onClick={() => setIg(!ig)}>
            Instagram frame
          </button>
          <span className="rsx-divider" />
          <button type="button" className="rsx-ghost" onClick={onNew}>
            <Plus size={14} /> New reel
          </button>
          <button type="button" className="rsx-ghost" onClick={onLibrary}>
            <FolderOpen size={14} /> Your reels <span className="rsx-count">{savedCount}</span>
          </button>
        </div>
      </header>

      <section className="rsx-whole" aria-label="The whole reel in each style">
        <p className="rsx-label">The whole reel in each style</p>
        <div className="rsx-whole-row">
          {reelFamilies.map((f) => {
            const key = `reel:${f.id}`;
            const on = sound === key;
            return (
              <article key={f.id} className={`rsx-whole-card ${on ? "is-sound" : ""}`}>
                <Phone
                  projectId={project.id}
                  file={project.outputs[f.id]}
                  label={`Whole reel, ${f.name}`}
                  ig={ig}
                  caption={caption}
                  audible={on}
                  restartKey={restart[key]}
                />
                <div className="rsx-meta">
                  <div>
                    <b>{f.id}</b>
                    <span>{f.name}</span>
                  </div>
                  <button type="button" className="rsx-sound" aria-pressed={on} disabled={!project.outputs[f.id]} onClick={() => toggleSound(key)}>
                    {on ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    {on ? "Mute" : "Sound"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="rsx-jevband">
          <span className={`rsx-jevband-mark${jevRunning ? " is-busy" : ""}`}><JevMark size={20} /></span>
          <div className="rsx-jevband-text">
            <b>
              {jevRunning
                ? `Jev is picking, section ${Math.max(1, project.sections.findIndex((s) => s.id === jevAt) + 1)} of ${project.sections.length}`
                : jevList.length
                  ? `Jev picked ${jevList.length} sections in ${fmtMs(jevMs)} · ${fmtUsd(jevCost)}`
                  : "Let Jev pick the best take for every section"}
              {jevList.length > 0 && <span className="rsx-jev-sample">Sample</span>}
            </b>
            <span>Jev already works in the build: it confirms Opus for the creative step and places a sound effect on each section.</span>
            <ul className="rsx-criteria" aria-label="What Jev scores every take on">
              {REEL_PICK_CRITERIA.map((c, i) => (
                <li key={c.id} title={c.hint}>
                  <span>{i + 1}</span>
                  <b>{c.label}</b>
                  <small>{c.hint}</small>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="rsx-jevband-go" onClick={() => void letJevPick()} disabled={jevRunning}>
            <JevMark size={14} />
            {jevRunning ? "Picking" : jevList.length ? "Pick again" : "Let Jev pick"}
          </button>
        </div>
        <nav className="rsx-jump" aria-label="Sections">
          {project.sections.map((s, i) => (
            <a key={s.id} href={`#rsx-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`rsx-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {s.name}
              {picks[s.id] && <Check size={12} />}
            </a>
          ))}
        </nav>
      </section>

      <ReelAudioPipeline suggestions={sfxSuggestions} toggles={sfxToggles} library={sfxLibrary} autoRun={audioAutoRun} />

      {project.sections.map((s, i) => {
        const variants = sectionVariants(s).filter((v) => v[layout] ?? v.full);
        return (
          <section key={s.id} id={`rsx-${s.id}`} className="rsx-sec">
            <div className="rsx-sec-text">
              <div className="rsx-tc">
                {String(i + 1).padStart(2, "0")} · {clock(s.t0)} to {clock(s.t1)}
              </div>
              <h3>{s.name}</h3>
              <blockquote>“{s.words}”</blockquote>
              {jevAt === s.id && !jevPicks[s.id] && (
                <div className="rsx-jev is-thinking" role="status">
                  <JevMark size={14} /> Jev is weighing {sectionVariants(s).length} takes
                </div>
              )}
              {jevPicks[s.id] && (
                <div className="rsx-jev">
                  <div className="rsx-jev-head">
                    <JevMark size={13} /> Jev <span>{fmtMs(jevPicks[s.id].ms)} · {fmtUsd(jevPicks[s.id].costUsd)}</span>
                    <span className="rsx-jev-sample">Sample</span>
                  </div>
                  <div className="rsx-jev-win">
                    <b>{jevPicks[s.id].pick} {familyName(jevPicks[s.id].family)}</b>
                    <span className="rsx-jev-odds">
                      {jevPicks[s.id].odds.filter((o) => Math.round(o.p * 100) > 0).map((o) => (
                        <span key={o.key} className={o.key === jevPicks[s.id].pick ? "is-win" : undefined}>
                          {o.key} {Math.round(o.p * 100)}%
                        </span>
                      ))}
                    </span>
                  </div>
                  <ol aria-label="How the picked take scored">
                    {REEL_PICK_CRITERIA.map((c, k) => (
                      <li key={c.id} className="is-win" style={{ ["--k" as string]: k }}>
                        <span className="rsx-jev-label" title={c.label}>{c.short}</span>
                        <span className="rsx-jev-track"><span style={{ ["--p" as string]: `${Math.round(jevPicks[s.id].scores[c.id] * 100)}%` }} /></span>
                        <span className="rsx-jev-p">{Math.round(jevPicks[s.id].scores[c.id] * 100)}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="rsx-jev-why">{jevPicks[s.id].reason}</p>
                </div>
              )}
              {sfxSuggestions[i] && <SectionSfxRow suggestion={sfxSuggestions[i]} toggles={sfxToggles} onToggle={toggleSfx} library={sfxLibrary} />}
              {sfxSample && sfxSample.input.replace(/"/g, "") === s.words && (
                <div className="rsx-jev-sfx" title="A real Jev decision from this reel's build">
                  <span className="rsx-jev-sfx-label">Sound effect Jev chose in the build</span>
                  <JevCard decision={sfxSample} compact sample />
                </div>
              )}
            </div>
            <div className="rsx-grid">
              {variants.map((v) => {
                const key = `sec:${s.id}:${v.key}`;
                const on = sound === key;
                const isPicked = picks[s.id] === v.key;
                return (
                  <article key={v.key} className={`rsx-card ${isPicked ? "is-picked" : ""} ${on ? "is-sound" : ""}`}>
                    <div className="rsx-card-top">
                      <div className="rsx-card-name">
                        <b>{v.key.length > 1 ? v.key : v.family}</b>
                        <span>{familyName(v.family)}</span>
                        {v.key.length > 1 && <span className="rsx-tag">New</span>}
                      </div>
                      <button type="button" className="rsx-icon" aria-pressed={on} aria-label={on ? "Mute" : "Play with sound"} title={on ? "Mute" : "Play with sound"} onClick={() => toggleSound(key)}>
                        {on ? <Volume2 size={14} /> : <VolumeX size={14} />}
                      </button>
                    </div>
                    <Phone
                      projectId={project.id}
                      file={v[layout] ?? v.full}
                      label={`${s.name}, ${familyName(v.family)} ${v.key}`}
                      ig={ig}
                      caption={caption}
                      restartKey={restart[key]}
                      onTime={on ? (t) => syncVoice(s, t) : undefined}
                      onPause={on ? () => voiceEl.current?.pause() : undefined}
                    />
                    <button type="button" className={`rsx-pick${isPicked && jevPicks[s.id]?.pick === v.key ? " is-jev" : ""}`} aria-pressed={isPicked} onClick={() => togglePick(s.id, v.key)}>
                      {isPicked && jevPicks[s.id]?.pick === v.key ? <JevMark size={13} /> : <i />}
                      {isPicked ? (jevPicks[s.id]?.pick === v.key ? "Jev picked" : "Picked") : "Pick"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <footer className="rsx-foot" data-hidden={!footVisible}>
        <span className="rsx-foot-picks">{picked.length ? `Picks: ${pickText}` : "No picks yet"}</span>
        <span className="rsx-foot-hint">
          {picked.length ? `${picked.length} of ${project.sections.length}` : "Tap Pick on the style you want in each section"}
        </span>
        <button
          type="button"
          className="rsx-ghost"
          disabled={!picked.length}
          onClick={() => {
            void navigator.clipboard?.writeText(pickText).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy picks"}
        </button>
      </footer>
    </div>
  );
}
